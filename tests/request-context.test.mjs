import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

const source = await fs.readFile(new URL('../request-context.js', import.meta.url), 'utf8');
const { createContextRecorder, generationEndpoint } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const entry = (world = 'A', uid = 0) => ({ world, uid, comment: '测试', content: '<script>literal</script>' });
function header(recorder, value) { recorder.debug([`[WI] Entry ${value.uid}`, `from '${value.world}' processing`, value]); }
const payload = { messages: [{ role: 'user', content: 'hello' }], api_key: 'must not retain' };

test('captures immutable content only and reconciles diagnostics with final activated entries', () => {
    const r = createContextRecorder();
    r.start('chat', 'normal');
    header(r, entry());
    r.debug(['[WI] Entry 0', 'activated by primary key match', '/hello/i']);
    header(r, entry('discarded'));
    r.debug(['[WI] Entry 0', 'activated by primary key match', 'budget failure']);
    r.activated([entry()]);
    const input = structuredClone(payload);
    r.capture('chat', input, '/generate');
    input.messages[0].content = 'mutated';
    const result = r.get('chat');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].diagnostic.primary, '/hello/i');
    assert.equal(result.messages[0].content, 'hello');
    assert.ok(!JSON.stringify(result).includes('must not retain'));
    result.messages.length = 0;
    assert.equal(r.get('chat').messages.length, 1);
});

test('secondary absence conditions are distinguished from matching keywords; same UID across books stays isolated', () => {
    const r = createContextRecorder(); r.start('chat', 'normal');
    header(r, entry('A'));
    r.debug(['[WI] Entry 0', 'Entry with primary key match', '{{user}}']);
    r.debug(['[WI] Entry 0', 'activated. (NOT ALL) Found not matching secondary keyword', 'absent']);
    header(r, entry('B'));
    r.debug(['[WI] Entry 0', 'activated because of constant']);
    r.activated([entry('A'), entry('B')]);
    r.capture('chat', payload, '/generate');
    const [a, b] = r.get('chat').entries;
    assert.equal(a.diagnostic.primary, '{{user}}');
    assert.match(a.diagnostic.reason, /未命中/);
    assert.deepEqual(a.diagnostic.secondary, ['absent']);
    assert.equal(b.diagnostic.reason, '常驻条目');
    assert.equal(b.diagnostic.primary, null);
});

test('zero activations reset between real generations and dry runs never overwrite a sent request', () => {
    const r = createContextRecorder(); r.start('chat', 'normal');
    r.activated([entry()]); r.capture('chat', payload, '/generate');
    r.start('chat', 'normal', true);
    r.activated([entry('dry')]);
    assert.equal(r.capture('chat', { prompt: 'preview' }, '/generate'), null);
    assert.equal(r.get('chat').entries[0].world, 'A');
    r.start('chat', 'swipe'); r.scanned(); r.capture('chat', { prompt: 'new' }, '/generate');
    assert.deepEqual(r.get('chat').entries, []);
    assert.equal(r.get('chat').scanned, true);
    assert.equal(r.get('chat').messages[0].content, 'new');
});

test('chat changes, aborted generations and missing scan records cannot inherit another chat activation', () => {
    const r = createContextRecorder(); r.start('A', 'normal'); r.activated([entry()]);
    assert.equal(r.capture('B', payload, '/generate'), null);
    r.stop(); assert.equal(r.capture('A', payload, '/generate'), null);
    r.start('B', 'quiet'); r.capture('B', payload, '/generate');
    assert.equal(r.get('A'), null);
    assert.equal(r.get('B').scanned, false);
    r.clear('B'); assert.equal(r.get('B'), null);
});

test('unsupported bodies, no-chat generation, and non-WI logs are ignored', () => {
    const r = createContextRecorder(); r.start(null, 'normal');
    assert.equal(r.capture(null, payload, '/generate'), null);
    r.start('chat', 'normal');
    r.debug(['random', { secret: true }]);
    r.debug(['[WI] Entry 0', 'activated by primary key match', 'unassociated']);
    r.activated([entry()]);
    assert.equal(r.capture('chat', {}, '/generate'), null);
    r.capture('chat', payload, '/generate');
    assert.equal(r.get('chat').entries[0].diagnostic.primary, null);
});

test('multimodal content is retained and snapshot cache is bounded to eight chats', () => {
    const r = createContextRecorder();
    const multimodal = { messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }] };
    for (let i = 0; i < 9; i++) { r.start(String(i), 'normal'); r.capture(String(i), multimodal, '/generate'); }
    assert.equal(r.get('0'), null);
    assert.deepEqual(r.get('8').messages, multimodal.messages);
});

test('only same-origin native language-generation URLs are eligible', () => {
    const base = 'http://localhost:6099/';
    assert.equal(generationEndpoint('/api/backends/chat-completions/generate', base), '/api/backends/chat-completions/generate');
    assert.equal(generationEndpoint(new Request(base + 'api/novelai/generate'), base), '/api/novelai/generate');
    assert.equal(generationEndpoint('/api/sd/generate', base), null);
    assert.equal(generationEndpoint('/api/settings/save', base), null);
    assert.equal(generationEndpoint('https://other.example/api/novelai/generate', base), null);
});
