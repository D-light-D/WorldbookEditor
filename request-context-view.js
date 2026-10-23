import { getLatestContext, clearLatestContext } from './request-context-capture.js';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function renderLatestContext() {
    const root = document.getElementById('wb-view-context');
    if (!root) return;
    root.replaceChildren();
    const snapshot = getLatestContext();
    if (!snapshot) {
        root.append(element('div', 'wb-request-empty', '暂无当前聊天的发送记录。启用扩展后发送一条消息，再来这里查看。记录仅保留在本次页面会话中。'));
        return;
    }
    const toolbar = element('div', 'wb-request-toolbar');
    toolbar.append(element('span', '', `${new Date(snapshot.timestamp).toLocaleString()} · ${snapshot.type} · ${snapshot.messages.length} 段消息`));
    const copy = element('button', 'wb-btn', '复制上下文');
    copy.onclick = async () => {
        try {
            await navigator.clipboard.writeText(snapshot.messages.map(message => `[${message.role || 'message'}]\n${text(message.content ?? message)}`).join('\n\n'));
            copy.textContent = '已复制';
        } catch { copy.textContent = '复制失败，请手动选择文本'; }
    };
    const clear = element('button', 'wb-btn', '清除记录');
    clear.onclick = clearLatestContext;
    toolbar.append(copy, clear);
    root.append(toolbar, element('p', 'wb-request-note', '本页显示浏览器最近发出的生成请求；服务端可能继续转换格式。激活列表来自本次世界书扫描，通过扫描的条目仍可能被后续上下文裁剪。'));
    const layout = element('div', 'wb-request-layout');
    const messages = element('section', 'wb-request-messages');
    messages.setAttribute('aria-label', '最近发送的上下文');
    messages.append(element('h3', '', '发送的上下文'));
    snapshot.messages.forEach((message, index) => {
        const card = element('article', 'wb-request-card');
        card.append(element('div', 'wb-request-card-title', `${index + 1} · ${message.role || 'message'}${message.name ? ` · ${message.name}` : ''}`));
        const content = message.content ?? message;
        if (Array.isArray(content)) {
            for (const part of content) {
                // Never render untrusted HTML or load embedded image URLs.
                card.append(element('pre', '', part.type === 'text' ? part.text : `[${part.type || '多模态内容'}]\n${text(part)}`));
            }
        } else card.append(element('pre', '', text(content)));
        messages.append(card);
    });
    const entries = element('section', 'wb-request-entries');
    entries.setAttribute('aria-label', '实际激活的世界书条目');
    entries.append(element('h3', '', `激活条目 · ${snapshot.entries.length}`));
    entries.append(element('p', 'wb-request-note', '关键词取自 SillyTavern 扫描记录，主关键词只显示扫描采用的首个匹配。递归扫描也可能触发条目。'));
    if (!snapshot.entries.length) entries.append(element('p', 'wb-request-note', snapshot.scanned ? '本次未激活世界书条目。' : '本次未获取到世界书扫描记录。'));
    for (const entry of snapshot.entries) {
        const card = element('details', 'wb-request-card');
        card.open = true;
        card.append(element('summary', 'wb-request-card-title', entry.title));
        card.append(element('div', 'wb-request-note', `${entry.world || '未知世界书'} · #${entry.uid}${entry.position === 7 ? ' · Outlet（由对应插槽使用）' : ''}`));
        const diagnostic = entry.diagnostic;
        if (diagnostic.primary !== null) card.append(element('div', 'wb-request-keyword', `主关键词：${diagnostic.primary}`));
        if (diagnostic.reason) card.append(element('div', 'wb-request-reason', diagnostic.reason));
        if (diagnostic.secondary.length) card.append(element('div', 'wb-request-keyword', `辅助条件关键词：${diagnostic.secondary.join('、')}`));
        if (!diagnostic.primary && !diagnostic.reason) card.append(element('div', 'wb-request-note', '未获取到触发详情'));
        const content = element('details', 'wb-request-entry-content');
        content.append(element('summary', '', '查看条目内容'), element('pre', '', entry.content));
        card.append(content);
        entries.append(card);
    }
    layout.append(messages, entries);
    root.append(layout);
}
