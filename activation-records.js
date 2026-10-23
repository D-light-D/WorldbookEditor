// Native WI activation evidence only. No chat messages or request payloads.
const clone = value => JSON.parse(JSON.stringify(value));
const entryKey = entry => JSON.stringify([entry.world, entry.uid]);

export function createActivationRecorder() {
    const snapshots = new Map();
    let pending = null;
    let currentDiagnostic = null;
    return {
        start(chatKey, type, dryRun = false) {
            pending = dryRun || chatKey == null ? null : { chatKey, type, diagnostics: new Map(), entries: [], scanned: false };
            currentDiagnostic = null;
        },
        stop() { pending = null; currentDiagnostic = null; },
        debug(args) {
            if (!pending || typeof args[0] !== 'string' || !/^\[WI\] Entry /.test(args[0])) return;
            const [prefix, message, value] = args;
            if (typeof message !== 'string') return;
            if (message.startsWith("from '") && value && typeof value === 'object' && 'uid' in value) {
                const key = entryKey(value);
                const diagnostic = { prefix, primary: null, secondary: [], reason: null };
                pending.diagnostics.set(key, diagnostic);
                currentDiagnostic = diagnostic;
                return;
            }
            if (!currentDiagnostic || currentDiagnostic.prefix !== prefix) return;
            if (message === 'activated by primary key match' || message === 'Entry with primary key match') {
                currentDiagnostic.primary = String(value);
            }
            const reasons = {
                'activated by @@activate decorator': '强制激活（@@activate）',
                'externally activated': '由其他扩展激活',
                'activated because of constant': '常驻条目',
                'activated because active sticky': '黏性延续',
                'activated. (AND ANY) Found match secondary keyword': '辅助条件 AND ANY：命中任一',
                'activated. (NOT ALL) Found not matching secondary keyword': '辅助条件 NOT ALL：存在未命中',
                'activated. (NOT ANY) No secondary keywords found': '辅助条件 NOT ANY：全部未命中',
                'activated. (AND ALL) All secondary keywords found': '辅助条件 AND ALL：全部命中',
            };
            if (reasons[message]) {
                currentDiagnostic.reason = reasons[message];
                if (message.includes('secondary keyword')) {
                    currentDiagnostic.secondary = (Array.isArray(value) ? value : [value]).map(String);
                }
            }
        },
        scanned() { if (pending) pending.scanned = true; },
        activated(entries) {
            if (!pending) return;
            pending.scanned = true;
            // The authoritative event excludes probability/budget failures.
            pending.entries = entries.map(entry => ({
                world: entry.world, uid: entry.uid, title: entry.comment || `条目 ${entry.uid}`,
                content: entry.content || '', position: entry.position,
                diagnostic: clone(pending.diagnostics.get(entryKey(entry)) || {
                    primary: null, secondary: [], reason: entry.constant ? '常驻条目' : '未获取到触发详情',
                }),
            }));
        },
        pendingEntries() { return pending ? clone(pending.entries) : []; },
        capture(chatKey, outputs) {
            if (!pending || pending.chatKey !== chatKey) return null;
            const snapshot = clone({
                timestamp: Date.now(), type: pending.type,
                entries: pending.entries.map((entry, index) => ({ ...entry,
                    content: outputs?.[index]?.content ?? '',
                    outputStatus: outputs?.[index]?.outputStatus ?? 'unresolved',
                })), scanned: pending.scanned,
            });
            snapshots.delete(chatKey);
            snapshots.set(chatKey, snapshot);
            // Bounded session memory; no records written into chat files.
            if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
            return snapshot;
        },
        get(chatKey) { const value = snapshots.get(chatKey); return value ? clone(value) : null; },
        clear(chatKey) { snapshots.delete(chatKey); },
    };
}
