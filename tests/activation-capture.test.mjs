import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
const listeners=new Map(); let ctx={chatId:'A',characterId:0}; const sent=[];
const event_types=Object.fromEntries(['GENERATION_STARTED','WORLDINFO_SCAN_DONE','WORLD_INFO_ACTIVATED','GENERATE_AFTER_DATA','GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED'].map(k=>[k,k]));
const sandbox=vm.createContext({URL,Request,Event,crypto:{randomUUID:()=> 'test'},console:{debug(){}},window:{location:{href:'http://localhost/',origin:'http://localhost'},fetch(input,init){sent.push(init);return Promise.resolve('ok');}},document:{dispatchEvent(){}}});
function synthetic(exports){return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context:sandbox});}
const modules=new Map();
async function load(name){if(modules.has(name))return modules.get(name);const m=new vm.SourceTextModule(await fs.readFile(new URL('../'+name,import.meta.url),'utf8'),{context:sandbox});modules.set(name,m);await m.link(s=>s.endsWith('extensions.js')?synthetic({getContext:()=>ctx}):s.endsWith('/script.js')?synthetic({event_types,eventSource:{on(k,f){listeners.set(k,f);}}}):load(s.slice(2)));return m;}
const module=await load('activation-capture.js');await module.evaluate();const {initActivationCapture,getLatestActivations}=module.namespace;initActivationCapture();
test('captures only final processed WI output and sends no tracking tags',async()=>{
 listeners.get('GENERATION_STARTED')('normal',{},false);
 listeners.get('WORLD_INFO_ACTIVATED')([{world:'A',uid:1,content:'<%= 1+1 %>'}]);
 listeners.get('GENERATE_AFTER_DATA')({},false);assert.equal(getLatestActivations(),null);
 const messages=[{role:'system',content:'<%= 1+1 %>'}];
 listeners.get('prompt_template_prepare')({runType:'generate',isDryRun:false,generateData:messages});
 messages[0].content=messages[0].content.replace('<%= 1+1 %>','2');
 await sandbox.window.fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify({messages}),headers:{a:'b'}});
 assert.equal(JSON.parse(sent.at(-1).body).messages[0].content,'2');
 assert.equal(getLatestActivations().entries[0].content,'2');assert.equal(getLatestActivations().entries[0].outputStatus,'sent');
 assert.equal('messages' in getLatestActivations(),false);
});
test('dry runs and chat switches cannot overwrite previous output',()=>{
 listeners.get('GENERATION_STARTED')('normal',{},true);listeners.get('GENERATE_AFTER_DATA')({},true);
 assert.equal(getLatestActivations().entries[0].content,'2');
 ctx={chatId:'B',characterId:0};listeners.get('CHAT_CHANGED')();assert.equal(getLatestActivations(),null);
});
