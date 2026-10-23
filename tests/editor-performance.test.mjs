import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

function harness(count = 5000) {
    let reads = 0, creates = 0;
    const operations = [];
    const frames = new Map(); let nextFrame = 1;
    class Element {
        constructor(fragment = false) {
            this.fragment = fragment; this.children = []; this.parent = null; this.textContent = '';
            const classes = new Set();
            this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } };
            this.style = new Proxy({ setProperty() {} }, { set(target, key, value) { if (key === 'height') operations.push('write'); target[key] = value; return true; } });
            this.listeners = new Map();
        }
        append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
        appendChild(node) { this.append(node); }
        insertBefore(node, reference) {
            if (node.fragment) { for (const child of [...node.children]) this.insertBefore(child, reference); return; }
            node.remove(); const index = reference ? this.children.indexOf(reference) : this.children.length;
            this.children.splice(index, 0, node); node.parent = this;
        }
        remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
        get offsetHeight() { reads++; operations.push('read'); return this.children[0]?.textContent.length > 50 ? 48 : 24; }
        addEventListener(name, callback) { this.listeners.set(name, callback); }
    }
    const textarea = new Element(); textarea.value = Array.from({length:count}, (_, i) => `  line ${i}`).join('\n');
    textarea.selectionStart = 0; textarea.clientWidth = 600; textarea.scrollLeft = 0; textarea.scrollTop = 0;
    const gutter = new Element(), decoration = new Element(), status = new Element(), editor = new Element(), overlay = new Element();
    const selectors = { '.wb-popup-textarea': textarea, '.wb-editor-gutter > div': gutter, '.wb-editor-decoration': decoration, '.wb-editor-status': status, '.wb-content-editor': editor };
    let resize;
    const context = vm.createContext({
        document: { createElement() { creates++; return new Element(); }, createDocumentFragment: () => new Element(true) },
        requestAnimationFrame(callback) { const id=nextFrame++; frames.set(id,callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
        ResizeObserver: class { constructor(callback) { resize=callback; } observe() {} disconnect() {} },
    });
    return { context, textarea, gutter, decoration, overlay,
        popup: { querySelector: s => selectors[s], parentElement: overlay },
        flush() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
        edit(value) { textarea.value=value; textarea.listeners.get('input')(); },
        resize: () => resize(), pending: () => frames.size,
        reset() { reads=creates=0; operations.length=0; }, stats: () => ({ reads, creates, operations }),
    };
}
const source=await readFile(new URL('../content-editor.js',import.meta.url),'utf8');
async function setup(count) { const h=harness(count); const module=new vm.SourceTextModule(source,{context:h.context}); await module.link(()=>{}); await module.evaluate(); h.api=module.namespace.setupContentEditor(h.popup); h.flush(); h.reset(); return h; }

test('typing in 5000 lines reuses nodes and measures only the edited row', async () => {
    const h=await setup(5000); const first=h.decoration.children[0], last=h.decoration.children[4999];
    h.edit(h.textarea.value.replace('line 2000','line 2000x'));
    h.textarea.listeners.get('keyup')(); h.textarea.listeners.get('select')();
    assert.equal(h.pending(),1); assert.equal(h.stats().reads,0);
    h.flush(); assert.equal(h.stats().creates,0); assert.equal(h.stats().reads,1);
    assert.equal(h.decoration.children[0],first); assert.equal(h.decoration.children[4999],last);
    assert.equal(h.decoration.children[2000].classList.contains('modified'),true);
});
test('newline insertion/deletion preserves suffix nodes, line numbers and undo highlights', async () => {
    const h=await setup(3); const original=h.textarea.value; const suffix=h.decoration.children[2];
    h.edit(original.replace('line 1','line 1\nnew')); h.flush();
    assert.equal(h.decoration.children[3],suffix); assert.equal(h.gutter.children[3].textContent,4);
    h.edit(original); h.flush(); assert.equal(h.decoration.children[2],suffix);
    assert.ok(h.decoration.children.every(row=>!row.classList.contains('modified')));
    assert.equal(h.gutter.children.length,3);
});
test('resize reads all heights before writing any, and close cancels queued rendering', async () => {
    const h=await setup(100); h.textarea.clientWidth=300; h.resize(); h.flush();
    const ops=h.stats().operations; const firstWrite=ops.indexOf('write');
    assert.equal(h.stats().reads,100); assert.ok(firstWrite===-1 || ops.slice(firstWrite).every(x=>x==='write'));
    h.edit('closed'); assert.equal(h.pending(),1); h.overlay.remove(); assert.equal(h.pending(),0);
});
test('rapid input/composition updates coalesce and wrapped height tracks long lines', async () => {
    const h=await setup(2); const original=h.textarea.value;
    h.edit(original.replace('line 0','中')); h.edit(original.replace('line 0','中文'.repeat(40))); h.flush();
    assert.equal(h.stats().reads,1); assert.equal(h.gutter.children[0].style.height,'48px');
    h.api.setWrap(false); h.flush(); assert.equal(h.textarea.wrap,'off');
});
