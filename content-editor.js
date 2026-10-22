// Native textarea preserves undo, selection and IME; mirror measures logical lines.
export function setupContentEditor(popup, { wrap = true, showWhitespace = true } = {}) {
    const textarea = popup.querySelector('.wb-popup-textarea');
    const gutter = popup.querySelector('.wb-editor-gutter > div');
    const decoration = popup.querySelector('.wb-editor-decoration');
    const status = popup.querySelector('.wb-editor-status');
    const editor = popup.querySelector('.wb-content-editor');
    const original = textarea.value;
    let lines = original.split('\n');
    let changed = lines.map(() => false);
    let activeLine = -1;
    const syncScroll = () => {
        gutter.style.transform = `translateY(${-textarea.scrollTop}px)`;
        decoration.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    };
    const updatePosition = () => {
        const before = textarea.value.slice(0, textarea.selectionStart);
        const row = before.split('\n').length - 1;
        const prefix = before.slice(before.lastIndexOf('\n') + 1);
        const indent = lines[row]?.match(/^[\t ]*/)[0] || '';
        const tabs = (indent.match(/\t/g) || []).length;
        status.textContent = `第 ${row + 1} 行，第 ${visualWidth(prefix) + 1} 列 · 缩进：${indent.length - tabs} 空格，${tabs} Tab · 蓝色：光标行 / 橙色：已修改`;
        if (row !== activeLine) {
            gutter.children[activeLine]?.classList.remove('active');
            decoration.children[activeLine]?.classList.remove('active');
            gutter.children[row]?.classList.add('active');
            decoration.children[row]?.classList.add('active');
            activeLine = row;
        }
        syncScroll();
    };
    const layout = () => {
        decoration.style.width = `${textarea.clientWidth}px`;
        decoration.style.minWidth = '0';
        for (let i = 0; i < lines.length; i++) {
            gutter.children[i].style.height = `${decoration.children[i].offsetHeight}px`;
        }
        syncScroll();
    };
    const render = () => {
        const numbers = document.createDocumentFragment();
        const rows = document.createDocumentFragment();
        for (let i = 0; i < lines.length; i++) {
            const number = document.createElement('div');
            number.textContent = i + 1;
            number.classList.toggle('modified', changed[i]);
            numbers.appendChild(number);
            const row = document.createElement('div');
            row.classList.toggle('modified', changed[i]);
            const measure = document.createElement('span');
            measure.className = 'wb-editor-measure';
            measure.textContent = lines[i] || '\u200b';
            row.appendChild(measure);
            const indent = lines[i].match(/^[\t ]*/)[0];
            const guide = document.createElement('span');
            guide.className = 'wb-editor-indent';
            guide.style.width = `${visualWidth(indent)}ch`;
            let width = 0;
            guide.textContent = Array.from(indent, char => {
                const size = char === '\t' ? 4 - width % 4 : 1;
                width += size;
                return char === '\t' ? '→' + ' '.repeat(size - 1) : '·';
            }).join('');
            row.appendChild(guide);
            rows.appendChild(row);
        }
        gutter.replaceChildren(numbers);
        decoration.replaceChildren(rows);
        editor.style.setProperty('--wb-gutter-width', `${String(lines.length).length + 2}ch`);
        activeLine = -1;
        layout();
        updatePosition();
    };
    const setWrap = value => {
        textarea.wrap = value ? 'soft' : 'off';
        editor.classList.toggle('wb-editor-wrapped', value);
        textarea.scrollLeft = 0;
        render();
    };
    editor.classList.toggle('wb-show-whitespace', showWhitespace);
    textarea.addEventListener('input', () => {
        const next = textarea.value.split('\n');
        const delta = changedLineRange(lines, next);
        const replacement = next.slice(delta.start, delta.start + delta.added).map((line, offset) =>
            offset < delta.removed && line === lines[delta.start + offset] ? changed[delta.start + offset] : true);
        changed.splice(delta.start, delta.removed, ...replacement);
        if (!delta.added && delta.removed) changed[Math.min(delta.start, next.length - 1)] = true;
        if (textarea.value === original) changed = next.map(() => false);
        lines = next;
        render();
    });
    for (const event of ['click', 'keyup', 'select', 'focus']) textarea.addEventListener(event, updatePosition);
    textarea.addEventListener('scroll', syncScroll);
    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(textarea);
    const overlay = popup.parentElement;
    const remove = overlay.remove.bind(overlay);
    overlay.remove = () => { resizeObserver.disconnect(); remove(); };
    setWrap(wrap);
    return { setWrap };
}

export function changedLineRange(previous, next) {
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
    let oldEnd = previous.length;
    let newEnd = next.length;
    while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
    return { start, removed: oldEnd - start, added: newEnd - start };
}

function visualWidth(text) {
    let width = 0;
    for (const char of text) width += char === '\t' ? 4 - width % 4 : 1;
    return width;
}
