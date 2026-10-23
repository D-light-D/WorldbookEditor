// Temporary provenance tags travel through the *existing* template evaluation.
// They are removed before transport. Templates are never evaluated a second time.
export function textSlots(payload) {
    const slots = [];
    const messages = Array.isArray(payload) ? payload : payload.messages ?? payload.prompt ?? payload.input;
    if (typeof messages === 'string') {
        const key = typeof payload.prompt === 'string' ? 'prompt' : 'input';
        slots.push({ object: payload, key });
    } else if (Array.isArray(messages)) {
        for (const message of messages) {
            if (typeof message.content === 'string') slots.push({ object: message, key: 'content' });
            else if (Array.isArray(message.content)) {
                for (const part of message.content) if (part.type === 'text' && typeof part.text === 'string') slots.push({ object: part, key: 'text' });
            }
        }
    }
    return slots;
}

export function createOutputTrace(entries, nonce) {
    const tracked = entries.map((entry, index) => ({
        ...entry, start: `\uE000WB:${nonce}:${index}:S\uE001`, end: `\uE000WB:${nonce}:${index}:E\uE001`, tagged: false,
    }));
    function clean(text) {
        for (const entry of tracked) text = text.split(entry.start).join('').split(entry.end).join('');
        return text;
    }
    return {
        tag(payload) {
            const slots = textSlots(payload);
            const ranges = [];
            for (const entry of tracked) {
                // EJS whitespace-slurping tags depend on adjacent text. Adding
                // boundaries there could change output, so leave them untraced.
                if (entry.tagged || !entry.content || /<%_|[-_]%>/.test(entry.content)) continue;
                const hits = [];
                for (const slot of slots) {
                    const value = slot.object[slot.key];
                    let at = value.indexOf(entry.content);
                    while (at !== -1) {
                        hits.push({ slot, from: at, to: at + entry.content.length, entry });
                        at = value.indexOf(entry.content, at + 1);
                    }
                }
                // Duplicate/nested source cannot be attributed safely.
                if (hits.length === 1) ranges.push(hits[0]);
            }
            const safe = ranges.filter(range => !ranges.some(other => other !== range && other.slot === range.slot && other.from < range.to && range.from < other.to));
            safe.sort((a, b) => b.from - a.from);
            for (const { slot, from, to, entry } of safe) {
                const value = slot.object[slot.key];
                slot.object[slot.key] = value.slice(0, from) + entry.start + value.slice(from, to) + entry.end + value.slice(to);
                entry.tagged = true;
            }
        },
        finish(payload) {
            const slots = textSlots(payload);
            const texts = slots.map(slot => slot.object[slot.key]);
            const outputs = tracked.map(entry => {
                const matches = [];
                for (const text of texts) {
                    let from = text.indexOf(entry.start);
                    while (from !== -1) {
                        const to = text.indexOf(entry.end, from + entry.start.length);
                        if (to !== -1) matches.push(clean(text.slice(from + entry.start.length, to)));
                        from = text.indexOf(entry.start, from + entry.start.length);
                    }
                }
                if (matches.length === 1) return { content: matches[0], outputStatus: matches[0].trim() ? 'sent' : 'empty' };
                // Literal entries can be verified directly against the final payload.
                if (!entry.tagged && entry.content && !/<%|\{\{/.test(entry.content)) {
                    const count = texts.reduce((sum, value) => sum + value.split(entry.content).length - 1, 0);
                    if (count === 1) return { content: entry.content, outputStatus: 'sent' };
                }
                return { content: '', outputStatus: 'unresolved' };
            });
            // Clean every string, including copies made by other prompt processors.
            const scrub = value => {
                if (typeof value === 'string') return clean(value);
                if (Array.isArray(value)) return value.map(scrub);
                if (value && typeof value === 'object') for (const key of Object.keys(value)) value[key] = scrub(value[key]);
                return value;
            };
            scrub(payload);
            return outputs;
        },
    };
}
