// Keep the native textarea (including undo, selection and IME) as the editor.
// Decorations only cover leading whitespace; entry content is never rewritten.
export function setupContentEditor(popup) {
    const textarea = popup.querySelector('.wb-popup-textarea');
    const gutter = popup.querySelector('.wb-editor-gutter > div');
    const decoration = popup.querySelector('.wb-editor-decoration');
    const status = popup.querySelector('.wb-editor-status');
    const toggle = popup.querySelector('.wb-editor-whitespace');
    const editor = popup.querySelector('.wb-content-editor');
    let lines = [];
    let activeLine = -1;

    const syncScroll = () => {
        gutter.style.transform = `translateY(${-textarea.scrollTop}px)`;
        decoration.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    };
    const updatePosition = () => {
        const before = textarea.value.slice(0, textarea.selectionStart);
        const row = before.split('\n').length - 1;
        const prefix = before.slice(before.lastIndexOf('\n') + 1);
        const column = visualWidth(prefix);
        const indent = lines[row]?.match(/^[\t ]*/)[0] || '';
        status.textContent = `第 ${row + 1} 行，第 ${column + 1} 列 · 本行缩进：${indent.length - (indent.match(/\t/g) || []).length} 空格，${(indent.match(/\t/g) || []).length} Tab · Tab 宽度 4 列`;
        if (row !== activeLine) {
            gutter.children[activeLine]?.classList.remove('active');
            decoration.children[activeLine]?.classList.remove('active');
            gutter.children[row]?.classList.add('active');
            decoration.children[row]?.classList.add('active');
            activeLine = row;
        }
        syncScroll();
    };
    const render = () => {
        lines = textarea.value.split('\n');
        const numbers = document.createDocumentFragment();
        const rows = document.createDocumentFragment();
        for (let i = 0; i < lines.length; i++) {
            const number = document.createElement('div');
            number.textContent = i + 1;
            numbers.appendChild(number);
            const row = document.createElement('div');
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
        updatePosition();
    };
    toggle.addEventListener('change', () => {
        editor.classList.toggle('wb-show-whitespace', toggle.checked);
    });
    textarea.addEventListener('input', render);
    for (const event of ['click', 'keyup', 'select', 'focus']) {
        textarea.addEventListener(event, updatePosition);
    }
    textarea.addEventListener('scroll', syncScroll);
    render();
}

function visualWidth(text) {
    let width = 0;
    for (const char of text) width += char === '\t' ? 4 - width % 4 : 1;
    return width;
}
