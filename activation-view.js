import { getLatestActivations } from './activation-capture.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function icon(name) {
    const node = el('i', `fa-solid fa-${name}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}
function empty(title, description, name = 'book-open') {
    const node = el('div', 'wb-activation-empty');
    const mark = el('div', 'wb-activation-empty-icon');
    mark.append(icon(name));
    node.append(mark, el('h3', '', title), el('p', '', description));
    return node;
}
function triggerLabel(entry) {
    if (entry.diagnostic.primary !== null) return entry.diagnostic.primary;
    const reason = entry.diagnostic.reason;
    return reason === '常驻条目' ? '常驻' : reason === '黏性延续' ? '黏性延续' : reason === '由其他扩展激活' ? '外部激活' : reason?.includes('@@activate') ? '强制激活' : '详情未获取';
}

export function renderActivations() {
    const root = document.getElementById('wb-view-activation');
    if (!root) return;
    root.replaceChildren();
    const snapshot = getLatestActivations();
    const header = el('header', 'wb-activation-header');
    const heading = el('div');
    heading.append(el('h2', '', '激活条目'));
    header.append(heading);
    if (snapshot) {
        const count = el('div', 'wb-activation-count');
        count.append(el('span', '', `${snapshot.entries.length} 条`));
        header.append(count);
    }
    root.append(header);
    if (!snapshot) {
        root.append(empty('还没有激活记录', '发送一条消息后，在这里查看激活的条目与触发关键词。'));
        return;
    }
    const meta = el('div', 'wb-activation-meta');
    meta.append(el('span', '', new Date(snapshot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    meta.title = new Date(snapshot.timestamp).toLocaleString();
    header.append(meta);
    const tools = el('div', 'wb-activation-tools');
    const searchBox = el('div', 'wb-activation-search');
    const search = el('input');
    search.type = 'search';
    search.placeholder = '搜索条目、世界书或关键词';
    search.setAttribute('aria-label', search.placeholder);
    searchBox.append(icon('magnifying-glass'), search);
    const filters = el('div', 'wb-activation-filters');
    filters.setAttribute('aria-label', '按触发方式筛选');
    let selected = 'all';
    const buttons = [];
    for (const [value, label] of [['all', '全部'], ['keyword', '关键词'], ['other', '其他触发']]) {
        const button = el('button', '', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(value === selected));
        button.onclick = () => {
            selected = value;
            buttons.forEach(([key, node]) => node.setAttribute('aria-pressed', String(key === value)));
            renderList();
        };
        buttons.push([value, button]);
        filters.append(button);
    }
    tools.append(searchBox, filters);
    const list = el('div', 'wb-activation-list');
    list.setAttribute('aria-label', '已激活的世界书条目');
    const footer = el('footer', 'wb-activation-footer');
    const resultCount = el('span');
    resultCount.setAttribute('aria-live', 'polite');
    const help = el('details', 'wb-activation-help');
    help.append(el('summary', '', '说明'), el('p', '', '内容取自浏览器发出的生成请求。表达式只由原扩展执行一次；无法准确归属的片段不会以条目原文代替。服务端仍可能继续处理请求。记录刷新后清除。'));
    footer.append(resultCount, help);
    root.append(tools, list, footer);
    function renderList() {
        list.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        const visible = snapshot.entries.filter(entry => {
            const keyword = entry.diagnostic.primary !== null;
            if (selected === 'keyword' && !keyword || selected === 'other' && keyword) return false;
            return [entry.title, entry.world, entry.uid, entry.diagnostic.primary, entry.diagnostic.reason, ...entry.diagnostic.secondary].join(' ').toLocaleLowerCase().includes(query);
        });
        resultCount.textContent = `显示 ${visible.length} / ${snapshot.entries.length} 条`;
        if (!visible.length) {
            list.append(empty(snapshot.entries.length ? '没有找到匹配条目' : '本次没有激活条目', snapshot.entries.length ? '试试其他关键词，或切换触发方式。' : '下次生成后，这里的记录会自动更新。', snapshot.entries.length ? 'magnifying-glass' : 'check'));
            return;
        }
        const groups = new Map();
        for (const entry of visible) {
            const world = entry.world || '未知世界书';
            if (!groups.has(world)) groups.set(world, []);
            groups.get(world).push(entry);
        }
        for (const [world, entries] of groups) {
            const group = el('section', 'wb-activation-group');
            const title = el('h3', 'wb-activation-book');
            title.append(icon('book'), el('span', '', world), el('span', 'wb-activation-book-count', `${entries.length} 条`));
            group.append(title);
            for (const entry of entries) {
                const row = el('details', 'wb-activation-row');
                const summary = el('summary');
                const identity = el('div', 'wb-activation-identity');
                identity.append(el('span', 'wb-activation-entry-title', entry.title), el('span', 'wb-activation-uid', `#${entry.uid}`));
                if (entry.outputStatus === 'empty') identity.append(el('span', 'wb-activation-uid', '无输出'));
                const triggered = entry.diagnostic.primary !== null;
                const badge = el('span', `wb-activation-trigger${triggered ? ' is-keyword' : ''}`);
                badge.title = triggered ? `首个命中的主关键词：${entry.diagnostic.primary}` : entry.diagnostic.reason || '未获取到触发详情';
                badge.append(icon(triggered ? 'key' : 'bolt'), el('span', '', triggerLabel(entry)));
                const chevron = icon('chevron-down');
                chevron.classList.add('wb-activation-chevron');
                summary.append(identity, badge, chevron);
                row.append(summary);
                const body = el('div', 'wb-activation-body');
                if (triggered) body.append(el('div', 'wb-activation-condition', `主关键词：${entry.diagnostic.primary}`));
                if (entry.diagnostic.reason) body.append(el('div', 'wb-activation-condition', entry.diagnostic.reason));
                if (entry.diagnostic.secondary.length) body.append(el('div', 'wb-activation-condition', `辅助条件关键词：${entry.diagnostic.secondary.join('、')}`));
                if (entry.position === 7) body.append(el('div', 'wb-activation-condition', 'Outlet 条目 · 由对应插槽使用'));
                body.append(el('div', 'wb-activation-content-label', '发送内容'));
                if (entry.outputStatus === 'sent') body.append(el('pre', '', entry.content));
                else body.append(el('p', 'wb-activation-output-note', entry.outputStatus === 'empty' ? '本条目执行后无文本输出。' : '未能从最终请求中准确定位此条目的内容。'));
                row.append(body);
                group.append(row);
            }
            list.append(group);
        }
    }
    search.oninput = renderList;
    renderList();
}
