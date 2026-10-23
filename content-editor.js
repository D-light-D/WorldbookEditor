// Native textarea preserves undo, selection and IME; mirror measures logical lines.
export function setupContentEditor(popup, { wrap = true, showWhitespace = true } = {}) {
    const textarea = popup.querySelector('.wb-popup-textarea');
    const gutter = popup.querySelector('.wb-editor-gutter > div');
    const decoration = popup.querySelector('.wb-editor-decoration');
    const status = popup.querySelector('.wb-editor-status');
    const editor = popup.querySelector('.wb-content-editor');
    const original = textarea.value;
    let lines = [];
    let changed = [];
    const numbers = [];
    const rows = [];
    let activeRow = null;
    let activeNumber = null;
    let frame = 0;
    let disposed = false;
    let fullLayout = true;
    let measuredWidth = -1;
    let gutterDigits = 0;
    let renderedValue = null;
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
        const label = `第 ${row + 1} 行，第 ${visualWidth(prefix) + 1} 列 · 缩进：${indent.length - tabs} 空格，${tabs} Tab · 蓝色：光标行 / 橙色：已修改`;
        if (status.textContent !== label) status.textContent = label;
        if (rows[row] !== activeRow || numbers[row] !== activeNumber) {
            activeRow?.classList.remove('active');
            activeNumber?.classList.remove('active');
            activeRow = rows[row];
            activeNumber = numbers[row];
            activeRow?.classList.add('active');
            activeNumber?.classList.add('active');
        }
        syncScroll();
    };
    const updateRow = (row, text) => {
        row.children[0].textContent = text || '\u200b';
        const indent = text.match(/^[\t ]*/)[0];
        const guide = row.children[1];
        guide.style.width = `${visualWidth(indent)}ch`;
        let width = 0;
        guide.textContent = Array.from(indent, char => {
            const size = char === '\t' ? 4 - width % 4 : 1;
            width += size;
            return char === '\t' ? '→' + ' '.repeat(size - 1) : '·';
        }).join('');
    };
    const render = () => {
        frame = 0;
        if (disposed) return;
        let measureStart = 0;
        let measureEnd = 0;
        if (renderedValue !== textarea.value) {
            const value = textarea.value;
            const next = value.split('\n');
            const delta = changedLineRange(lines, next);
            const replacement = next.slice(delta.start, delta.start + delta.added).map((line, offset) =>
                offset < delta.removed && line === lines[delta.start + offset] ? changed[delta.start + offset] : true);
            changed.splice(delta.start, delta.removed, ...replacement);
            if (!delta.added && delta.removed) changed[Math.min(delta.start, next.length - 1)] = true;
            const reset = value === original;
            if (reset) changed = next.map(() => false);
            const reused = Math.min(delta.removed, delta.added);
            for (let i = delta.start + reused; i < delta.start + delta.removed; i++) {
                rows[i].remove();
                numbers[i].remove();
            }
            rows.splice(delta.start + reused, delta.removed - reused);
            numbers.splice(delta.start + reused, delta.removed - reused);
            const newRows = [];
            const newNumbers = [];
            const rowFragment = document.createDocumentFragment();
            const numberFragment = document.createDocumentFragment();
            for (let i = reused; i < delta.added; i++) {
                const row = document.createElement('div');
                const measure = document.createElement('span');
                measure.className = 'wb-editor-measure';
                const guide = document.createElement('span');
                guide.className = 'wb-editor-indent';
                row.append(measure, guide);
                const number = document.createElement('div');
                newRows.push(row);
                newNumbers.push(number);
                rowFragment.appendChild(row);
                numberFragment.appendChild(number);
            }
            decoration.insertBefore(rowFragment, rows[delta.start + reused] || null);
            gutter.insertBefore(numberFragment, numbers[delta.start + reused] || null);
            rows.splice(delta.start + reused, 0, ...newRows);
            numbers.splice(delta.start + reused, 0, ...newNumbers);
            for (let i = delta.start; i < delta.start + delta.added; i++) updateRow(rows[i], next[i]);
            // Renumber the suffix only when line count changes. Ordinary typing
            // touches one row, with no replacement of unaffected DOM nodes.
            if (delta.added !== delta.removed) {
                for (let i = delta.start; i < next.length; i++) numbers[i].textContent = i + 1;
            }
            const classStart = reset ? 0 : Math.min(delta.start, next.length - 1);
            const classEnd = reset ? next.length : Math.min(next.length, delta.start + Math.max(delta.added, 1));
            for (let i = classStart; i < classEnd; i++) {
                rows[i].classList.toggle('modified', changed[i]);
                numbers[i].classList.toggle('modified', changed[i]);
            }
            lines = next;
            renderedValue = value;
            measureStart = delta.start;
            measureEnd = delta.start + delta.added;
            const digits = String(lines.length).length;
            if (digits !== gutterDigits) {
                gutterDigits = digits;
                editor.style.setProperty('--wb-gutter-width', `${digits + 2}ch`);
                fullLayout = true;
            }
        }
        const width = textarea.clientWidth;
        if (width !== measuredWidth) {
            measuredWidth = width;
            decoration.style.width = `${width}px`;
            decoration.style.minWidth = '0';
            fullLayout = true;
        }
        if (fullLayout) { measureStart = 0; measureEnd = rows.length; }
        // Batch all layout reads BEFORE any height writes: no per-line reflow.
        const heights = [];
        for (let i = measureStart; i < measureEnd; i++) heights.push(rows[i].offsetHeight);
        for (let i = measureStart; i < measureEnd; i++) {
            const height = `${heights[i - measureStart]}px`;
            if (numbers[i].style.height !== height) numbers[i].style.height = height;
        }
        fullLayout = false;
        updatePosition();
    };
    const schedule = () => {
        if (!disposed && !frame) frame = requestAnimationFrame(render);
    };
    const setWrap = value => {
        textarea.wrap = value ? 'soft' : 'off';
        editor.classList.toggle('wb-editor-wrapped', value);
        textarea.scrollLeft = 0;
        fullLayout = true;
        schedule();
    };
    editor.classList.toggle('wb-show-whitespace', showWhitespace);
    textarea.addEventListener('input', schedule);
    for (const event of ['click', 'keyup', 'select', 'focus']) textarea.addEventListener(event, schedule);
    textarea.addEventListener('scroll', syncScroll);
    const resizeObserver = new ResizeObserver(() => { fullLayout = true; schedule(); });
    resizeObserver.observe(textarea);
    const overlay = popup.parentElement;
    const remove = overlay.remove.bind(overlay);
    overlay.remove = () => {
        disposed = true;
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        remove();
    };
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
