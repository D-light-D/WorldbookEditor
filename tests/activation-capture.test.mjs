import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
const listeners = new Map();
let context = { chatId: 'A', characterId: 0 };
let notifications = 0;
const originalFetch = () => {};
const debugCalls = [];
const event_types = Object.fromEntries(['GENERATION_STARTED', 'WORLDINFO_SCAN_DONE', 'WORLD_INFO_ACTIVATED', 'GENERATE_AFTER_DATA', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED'].map(key => [key, key]));
const sandbox = vm.createContext({ Event, console: { debug(...args) { debugCalls.push(args); } }, window: { fetch: originalFetch }, document: { dispatchEvent() { notifications++; } } });
function synthetic(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context: sandbox });
}
const model = new vm.SourceTextModule(await fs.readFile(new URL('../activation-records.js', import.meta.url), 'utf8'), { context: sandbox });
await model.link(() => { throw Error('Unexpected import'); });
const capture = new vm.SourceTextModule(await fs.readFile(new URL('../activation-capture.js', import.meta.url), 'utf8'), { context: sandbox });
await capture.link(specifier => specifier === './activation-records.js' ? model : specifier.endsWith('extensions.js') ? synthetic({ getContext: () => context }) : synthetic({ event_types, eventSource: { on(name, fn) { listeners.set(name, fn); } } }));
await capture.evaluate();
const { initActivationCapture, getLatestActivations } = capture.namespace;
initActivationCapture();
test('native events publish activations without intercepting fetch or reading request content', () => {
    const debug = sandbox.console.debug; initActivationCapture(); assert.equal(sandbox.console.debug, debug);
    assert.equal(sandbox.window.fetch, originalFetch);
    listeners.get('GENERATION_STARTED')('normal', {}, false);
    const entry = { uid: 2, world: 'QA', comment: 'test', content: 'details' };
    sandbox.console.debug('[WI] Entry 2', "from 'QA' processing", entry);
    sandbox.console.debug('[WI] Entry 2', 'activated by primary key match', '灯塔');
    listeners.get('WORLD_INFO_ACTIVATED')([entry]);
    assert.equal(getLatestActivations(), null);
    const unreadablePrompt = new Proxy({}, { get() { throw Error('Must not read context'); } });
    listeners.get('GENERATE_AFTER_DATA')(unreadablePrompt, false);
    assert.equal(getLatestActivations().entries[0].diagnostic.primary, '灯塔');
    assert.equal(notifications, 1); assert.equal(debugCalls.length, 2);
    assert.equal('messages' in getLatestActivations(), false);
});
test('dry runs, empty results, switching chats and cancellation preserve isolation', () => {
    listeners.get('GENERATION_STARTED')('normal', {}, true);
    listeners.get('GENERATE_AFTER_DATA')({}, true);
    assert.equal(getLatestActivations().entries.length, 1);
    listeners.get('GENERATION_STARTED')('normal', {}, false);
    listeners.get('GENERATE_AFTER_DATA')({}, false);
    assert.equal(getLatestActivations().entries.length, 0);
    context = { chatId: 'B', characterId: 0 }; listeners.get('CHAT_CHANGED')(); assert.equal(getLatestActivations(), null);
    listeners.get('GENERATION_STARTED')('normal', {}, false); listeners.get('GENERATION_STOPPED')();
    listeners.get('GENERATE_AFTER_DATA')({}, false); assert.equal(getLatestActivations(), null);
    context = { chatId: 'A', characterId: 0 }; assert.equal(getLatestActivations().entries.length, 0);
});
