import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
const src = await fs.readFile(new URL('../activation-output.js', import.meta.url), 'utf8');
const { createOutputTrace } = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
test('extracts processed output, including empty branches, and strips every provenance tag', () => {
    const entries = [{content:'<% if (true) { %>visible<% } %>'}, {content:'<% if (false) { %>hidden<% } %>'}];
    const trace = createOutputTrace(entries, 'test');
    const data = { messages: [{role:'system', content:entries.map(e=>e.content).join('\n')}] };
    trace.tag(data.messages);
    data.messages[0].content = data.messages[0].content.replace(entries[0].content, 'visible').replace(entries[1].content, '');
    const result = trace.finish(data);
    assert.deepEqual(result, [{content:'visible',outputStatus:'sent'}, {content:'',outputStatus:'empty'}]);
    assert.equal(data.messages[0].content,'visible\n');
});
test('ambiguous duplicates, nested sources, and unmatched expressions never fall back to raw template', () => {
    const trace = createOutputTrace([{content:'repeat'}, {content:'<%= secret %>'}], 'test');
    const data={prompt:'repeat repeat generated'};
    trace.tag(data);
    assert.equal(data.prompt,'repeat repeat generated');
    assert.ok(trace.finish(data).every(e=>e.outputStatus==='unresolved' && e.content===''));
});
test('literal multimodal text verified against final request while attachment and role stay unchanged', () => {
    const trace=createOutputTrace([{content:'plain text'}], 'test');
    const data={messages:[{role:'user',content:[{type:'image_url',image_url:{url:'x'}},{type:'text',text:'plain text'}]}]};
    const before=structuredClone(data);
    assert.equal(trace.finish(data)[0].content,'plain text');
    assert.deepEqual(data,before);
});
test('removed or partial markers produce unknown and remaining markers are always cleaned', () => {
    const trace=createOutputTrace([{content:'template'}], 'test');
    const data={prompt:'template'}; trace.tag(data);
    data.prompt=data.prompt.replace(/\uE000WB:test:0:E\uE001/g,'');
    assert.equal(trace.finish(data)[0].outputStatus,'unresolved');
    assert.equal(data.prompt,'template');
});
