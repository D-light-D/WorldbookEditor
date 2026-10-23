import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
const source = await fs.readFile(new URL('../activation-records.js', import.meta.url), 'utf8');
const { createActivationRecorder } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const entry = (world = 'A', uid = 0) => ({ world, uid, comment: '测试', content: '<script>literal</script>' });
function header(r, value) { r.debug([`[WI] Entry ${value.uid}`, `from '${value.world}' processing`, value]); }

test('retains only final activations, isolates duplicate UIDs across books and snapshots immutably', () => {
    const r = createActivationRecorder(); r.start('chat', 'normal');
    header(r, entry()); r.debug(['[WI] Entry 0', 'activated by primary key match', '/hello/i']);
    header(r, entry('discarded')); r.debug(['[WI] Entry 0', 'activated by primary key match', 'budget failure']);
    const input = entry(); r.activated([input]); input.content = 'changed';
    r.capture('chat');
    const result = r.get('chat');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].diagnostic.primary, '/hello/i');
    assert.equal(result.entries[0].content, '<script>literal</script>');
    assert.deepEqual(Object.keys(result).sort(), ['entries', 'scanned', 'timestamp', 'type']);
    result.entries.length = 0; assert.equal(r.get('chat').entries.length, 1);
});
test('secondary absence conditions remain distinct from matches and constants', () => {
    const r = createActivationRecorder(); r.start('chat', 'normal');
    header(r, entry('A')); r.debug(['[WI] Entry 0', 'Entry with primary key match', '{{user}}']);
    r.debug(['[WI] Entry 0', 'activated. (NOT ALL) Found not matching secondary keyword', 'absent']);
    header(r, entry('B')); r.debug(['[WI] Entry 0', 'activated because of constant']);
    r.activated([entry('A'), entry('B')]); r.capture('chat');
    const [a, b] = r.get('chat').entries;
    assert.equal(a.diagnostic.primary, '{{user}}'); assert.match(a.diagnostic.reason, /未命中/);
    assert.deepEqual(a.diagnostic.secondary, ['absent']); assert.equal(b.diagnostic.reason, '常驻条目');
    assert.equal(b.diagnostic.primary, null);
});
test('zero activations replace old records; dry runs never overwrite them', () => {
    const r = createActivationRecorder(); r.start('chat', 'normal'); r.activated([entry()]); r.capture('chat');
    r.start('chat', 'normal', true); r.activated([entry('dry')]);
    assert.equal(r.capture('chat'), null); assert.equal(r.get('chat').entries[0].world, 'A');
    r.start('chat', 'swipe'); r.scanned(); r.capture('chat');
    assert.deepEqual(r.get('chat').entries, []); assert.equal(r.get('chat').scanned, true);
});
test('chat switches and cancellations cannot leak pending activations', () => {
    const r = createActivationRecorder(); r.start('A', 'normal'); r.activated([entry()]);
    assert.equal(r.capture('B'), null); r.stop(); assert.equal(r.capture('A'), null);
    r.start('B', 'quiet'); r.capture('B'); assert.equal(r.get('A'), null); assert.equal(r.get('B').entries.length, 0);
});
test('missing diagnostics stay unknown and retention is bounded', () => {
    const r = createActivationRecorder(); r.start(null, 'normal'); assert.equal(r.capture(null), null);
    for (let i = 0; i < 9; i++) {
        r.start(String(i), 'normal'); r.debug(['random', {}]); r.activated([entry()]); r.capture(String(i));
    }
    assert.equal(r.get('0'), null); assert.equal(r.get('8').entries[0].diagnostic.primary, null);
});
