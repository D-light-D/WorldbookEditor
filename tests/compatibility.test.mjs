import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

// Run with: node --experimental-vm-modules --test tests/compatibility.test.mjs
// Mock only the ST boundary; execute the extension's actual API and state modules.
const files = new Map();
const calls = [];
const worldInfo = { charLore: [] };
const names = ['A', 'B', 'QA,特殊名称'];
const selected = [];
const selector = { options: names.map((_, index) => ({ value: String(index), selected: false })) };
const characterSelector = { value: '' };
let context;
const sandbox = vm.createContext({
    console, structuredClone, Date, setTimeout, clearTimeout,
    document: {
        getElementById: id => id === 'world_info' ? selector : id === 'character_world' ? characterSelector : null,
        createElement: () => ({ style: {}, remove() {} }),
        body: { appendChild() {} },
    },
});
function synthetic(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context: sandbox });
}
const boundaries = {
    '../../../extensions.js': synthetic({ getContext: () => context }),
    '../../../utils.js': synthetic({ getCharaFilename: (_, options) => options.manualAvatarKey.replace(/\.png$/, '') }),
    '../../../world-info.js': synthetic({
        world_info: worldInfo, world_names: names, selected_world_info: selected,
        charUpdatePrimaryWorld: async name => { calls.push(['primary', name]); },
        charSetAuxWorlds: (file, books) => { calls.push(['aux', file, books]); },
        onWorldInfoChange: () => {
            selected.splice(0, selected.length, ...selector.options.filter(o => o.selected).map(o => names[Number(o.value)]));
        },
        deleteWorldInfo: async name => { calls.push(['delete', name]); files.delete(name); return true; },
    }),
};
const modules = new Map();
async function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = new vm.SourceTextModule(await fs.readFile(new URL(file, import.meta.url), 'utf8'), { context: sandbox });
    modules.set(file, module);
    await module.link(specifier => boundaries[specifier] || load('../' + specifier.replace('./', '')));
    return module;
}
const module = await load('../api.js');
await module.evaluate();
const { API, setCharBindings, charSetAuxWorlds } = module.namespace;
const { STATE } = modules.get('../state.js').namespace;
context = {
    characterId: 0, characters: [{ avatar: 'test.png', name: '测试角色', data: { extensions: { world: 'A' } } }],
    groups: [], chatId: 'chat', chatMetadata: {}, extensionSettings: {}, powerUserSettings: {},
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, async saveMetadata() {},
    async loadWorldInfo(name) { return structuredClone(files.get(name)); },
    async saveWorldInfo(name, data, immediately) { calls.push(['save', name, immediately]); files.set(name, structuredClone(data)); },
};

test('primary and auxiliary links use the native ST persistence functions', async () => {
    await setCharBindings('primary', 'B', true);
    charSetAuxWorlds('test', ['A']);
    assert.ok(calls.some(call => call[0] === 'primary' && call[1] === 'B'));
    assert.ok(calls.some(call => call[0] === 'aux' && call[1] === 'test'));
});

test('global names containing commas are selected literally and enabling is idempotent', async () => {
    await setCharBindings('global', 'QA,特殊名称', true);
    await setCharBindings('global', 'QA,特殊名称', true);
    assert.deepEqual(selected, ['QA,特殊名称']);
    await setCharBindings('global', 'QA,特殊名称', false);
    assert.deepEqual(selected, []);
});

test('group chat with numeric ID can bind and unbind without a selected character', async () => {
    context.characterId = undefined;
    context.groupId = 'g1'; context.groups = [{ id: 'g1', name: '测试群聊' }]; context.chatId = 123456;
    await setCharBindings('chat', 'B', true);
    assert.equal(context.chatMetadata.world_info, 'B');
    await setCharBindings('chat', 'B', false);
    assert.equal(context.chatMetadata.world_info, undefined);
    context.groupId = undefined; context.characterId = 0;
});

test('cross-book writes are immediate and retain unknown ST/extension fields', async () => {
    files.set('A', { extensionData: 'keep', entries: { 0: { uid: 0, content: 'old', outletName: 'out', custom: true } } });
    files.set('B', { entries: {} });
    await API.saveBookEntries('A', [{ uid: 0, content: 'new', position: 7 }]);
    await API.saveBookEntries('B', [{ uid: 1, content: 'second' }]);
    assert.equal(files.get('A').extensionData, 'keep');
    assert.equal(files.get('A').entries[0].outletName, 'out');
    assert.equal(files.get('A').entries[0].custom, true);
    assert.equal(files.get('B').entries[1].content, 'second');
    assert.ok(calls.filter(call => call[0] === 'save').every(call => call[2] === true));
    assert.equal(STATE.lastSelfSave.name, 'B');
});

test('rename migrates all character, persona, chat, global, auxiliary and editor metadata links', async () => {
    context.characters = [0, 1].map(i => ({ avatar: `${i}.png`, data: { extensions: { world: 'A' } } }));
    context.writeExtensionFieldBulk = async (avatars, key, value) => {
        assert.equal(key, 'world'); assert.equal(value, 'Renamed');
        return { updated: avatars, failed: [], skipped: [] };
    };
    context.powerUserSettings = { persona_description_lorebook: 'A', persona_descriptions: { one: { lorebook: 'A' } } };
    context.chatMetadata.world_info = 'A';
    worldInfo.charLore = [{ name: '0', extraBooks: ['A'] }];
    selected.push('A');
    context.extensionSettings.WorldbookEditor_Metadata = { A: { pinned: true } };
    await API.renameWorldbook('A', 'Renamed');
    assert.equal(characterSelector.value, 'Renamed');
    assert.equal(context.powerUserSettings.persona_description_lorebook, 'Renamed');
    assert.equal(context.powerUserSettings.persona_descriptions.one.lorebook, 'Renamed');
    assert.equal(context.chatMetadata.world_info, 'Renamed');
    assert.deepEqual(selected, ['Renamed']);
    assert.equal(worldInfo.charLore[0].extraBooks[0], 'Renamed');
    assert.ok(context.extensionSettings.WorldbookEditor_Metadata.Renamed.pinned);
    assert.equal(files.has('A'), false);
});

test('failed character migration preserves the old book and reports failure', async () => {
    files.set('A', { entries: {} });
    context.writeExtensionFieldBulk = async () => ({ updated: [], failed: ['0.png'], skipped: [] });
    await assert.rejects(API.renameWorldbook('A', 'FailedRename'), /保留原世界书/);
    assert.equal(files.has('A'), true);
});
