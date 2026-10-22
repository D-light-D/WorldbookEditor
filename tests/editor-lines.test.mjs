import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../content-editor.js', import.meta.url), 'utf8');
const { changedLineRange } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('typing changes only the affected logical line', () => {
    assert.deepEqual(changedLineRange(['a', 'b', 'c'], ['a', 'edited', 'c']), { start: 1, removed: 1, added: 1 });
});
test('inserting a newline leaves the unchanged suffix intact', () => {
    assert.deepEqual(changedLineRange(['a', 'b', 'c'], ['a', 'b', '', 'c']), { start: 2, removed: 0, added: 1 });
});
test('deleting lines preserves following logical line identities', () => {
    assert.deepEqual(changedLineRange(['a', 'b', 'c', 'd'], ['a', 'd']), { start: 1, removed: 2, added: 0 });
});
test('empty and unchanged content has no changed range', () => {
    assert.deepEqual(changedLineRange([''], ['']), { start: 1, removed: 0, added: 0 });
});
