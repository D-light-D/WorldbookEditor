import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const listeners = new Map();
const calls = [];
const response = Promise.resolve({ ok: true });
let context = { chatId: 'A', characterId: 0 };
const eventTypes = Object.fromEntries(['GENERATION_STARTED', 'WORLDINFO_SCAN_DONE', 'WORLD_INFO_ACTIVATED', 'GENERATE_AFTER_DATA', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED'].map(key => [key, key]));
const host = { event_types: eventTypes, eventSource: { on(name, fn) { listeners.set(name, fn); } } };
const browserWindow = { location: { href: 'http://localhost:8767/' }, fetch(...args) { calls.push({ self: this, args }); return response; } };
const sandbox = vm.createContext({ URL, Request, Event, console: { debug() {} }, window: browserWindow, document: { dispatchEvent() {} } });
function synthetic(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context: sandbox });
}
const recorderModule = new vm.SourceTextModule(await fs.readFile(new URL('../request-context.js', import.meta.url), 'utf8'), { context: sandbox });
await recorderModule.link(() => { throw Error('Unexpected import'); });
const captureModule = new vm.SourceTextModule(await fs.readFile(new URL('../request-context-capture.js', import.meta.url), 'utf8'), { context: sandbox });
await captureModule.link(specifier => specifier === './request-context.js' ? recorderModule : specifier.endsWith('extensions.js') ? synthetic({ getContext: () => context }) : synthetic(host));
await captureModule.evaluate();
const { initContextCapture, getLatestContext } = captureModule.namespace;
initContextCapture();

test('adapter initializes once, forwards original request/response, and observes native activation diagnostics', () => {
    const wrapper = browserWindow.fetch; initContextCapture(); assert.equal(browserWindow.fetch, wrapper);
    listeners.get('GENERATION_STARTED')('normal', {}, false);
    listeners.get('GENERATE_AFTER_DATA')({}, false);
    const entry = { uid: 2, world: 'QA', comment: 'test', content: 'details' };
    sandbox.console.debug('[WI] Entry 2', "from 'QA' processing", entry);
    sandbox.console.debug('[WI] Entry 2', 'activated by primary key match', '灯塔');
    listeners.get('WORLD_INFO_ACTIVATED')([entry]);
    const init = { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: '灯塔' }] }), headers: { private: 'not captured' } };
    const returned = browserWindow.fetch('/api/backends/chat-completions/generate', init);
    assert.equal(returned, response);
    assert.equal(calls.at(-1).args[1], init);
    assert.equal(calls.at(-1).self, browserWindow);
    assert.equal(getLatestContext().entries[0].diagnostic.primary, '灯塔');
    listeners.get('GENERATION_ENDED')();
});

test('Request objects are read using a clone and retain original body, headers and abort signal', async () => {
    listeners.get('GENERATION_STARTED')('normal', {}, false);
    listeners.get('GENERATE_AFTER_DATA')({}, false);
    const request = new Request('http://localhost:8767/api/backends/text-completions/generate', { method: 'POST', body: JSON.stringify({ prompt: 'native text' }) });
    await browserWindow.fetch(request);
    assert.equal(request.bodyUsed, false);
    assert.equal(calls.at(-1).args[0], request);
    assert.equal(getLatestContext().messages[0].content, 'native text');
    assert.equal(getLatestContext().scanned, true);
    assert.equal(getLatestContext().entries.length, 0);
});

test('chat switching and dry runs cannot capture a preview or leak the previous snapshot', () => {
    context = { chatId: 'B', characterId: 0 };
    listeners.get('CHAT_CHANGED')();
    assert.equal(getLatestContext(), null);
    listeners.get('GENERATION_STARTED')('normal', {}, true);
    browserWindow.fetch('/api/backends/chat-completions/generate', { body: JSON.stringify({ prompt: 'preview' }) });
    assert.equal(getLatestContext(), null);
    context = { chatId: 'A', characterId: 0 };
    assert.equal(getLatestContext().messages[0].content, 'native text');
});

test('unrelated fetches and unavailable context never break original transport', () => {
    context = null;
    assert.equal(browserWindow.fetch('/api/settings/get'), response);
    assert.equal(browserWindow.fetch('/api/backends/chat-completions/generate', { body: '{}' }), response);
});
