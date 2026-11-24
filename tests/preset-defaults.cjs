const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const w=new JSDOM('',{runScripts:'outside-only'}).window;
w.eval(fs.readFileSync(path.join(__dirname,'../preset-defaults.js'),'utf8').replace('export function ','function ')+'\nwindow.createDefaults=createPresetDefaults;');
let settings={},writes=0;
const options=()=>({settings,onSave:()=>writes++});
let tracker=w.createDefaults(options());
const a={temperature:.98,frequency_penalty:0,presence_penalty:-.5,top_p:.95,top_k:40,top_a:.001,min_p:'0.005',repetition_penalty:1.1,openai_max_context:2000000,name:'A',stream_openai:true,prompts:[{content:'Private'}],api_key:'secret'};
tracker.capture([{name:'A',preset:a},{name:'B',preset:{temperature:.7}}]);
assert.equal(writes,1);assert.deepEqual(JSON.parse(JSON.stringify(tracker.get('A'))),{temperature:.98,frequency_penalty:0,presence_penalty:-.5,top_p:.95,top_k:40,top_a:.001,min_p:.005,repetition_penalty:1.1,openai_max_context:2000000});
// Native saves mutate or replace the preset object; neither may change defaults.
a.temperature=.2;a.top_p=.1;tracker.capture([{name:'A',preset:a},{name:'A',preset:{temperature:1.8}},{name:'B',preset:{temperature:1.5}}]);assert.equal(writes,1);assert.equal(tracker.get('A').temperature,.98);assert.equal(tracker.get('A').top_p,.95);assert.equal(tracker.get('B').temperature,.7);
// JSON storage/reload, disabled feature, same-name imports all preserve baselines.
settings=JSON.parse(JSON.stringify(settings));tracker=w.createDefaults(options());tracker.capture([{name:'A',preset:{temperature:1.5}},{name:'New import',preset:{temperature:1.2}}]);assert.equal(tracker.get('A').temperature,.98);assert.equal(tracker.get('New import').temperature,1.2);
tracker.capture([{name:'New import',preset:{temperature:.3}}]);assert.equal(tracker.get('New import').temperature,1.2);
// Renaming follows the original even if a temporary destination was observed.
tracker.capture([{name:'Renamed A',preset:{temperature:.2}}]);tracker.rename('A','Renamed A');assert.equal(tracker.get('A'),undefined);assert.equal(tracker.get('Renamed A').temperature,.98);
tracker.rename('missing','Renamed A');assert.equal(tracker.get('Renamed A').temperature,.98);
tracker.remove('Renamed A');assert.equal(tracker.get('Renamed A'),undefined);tracker.capture([{name:'Renamed A',preset:{temperature:.4}}]);assert.equal(tracker.get('Renamed A').temperature,.4);
// Empty/unavailable presets must never permanently snapshot current UI values.
tracker.capture([{name:'Unavailable',preset:undefined},{name:'Partial',preset:{prompts:[],temperature:null}},{name:'__proto__',preset:{temperature:0}}]);assert.equal(tracker.get('Unavailable'),undefined);assert.equal(tracker.get('Partial'),undefined);assert.equal(tracker.get('__proto__').temperature,0);tracker.capture([{name:'Partial',preset:{temperature:1}}]);assert.equal(tracker.get('Partial').temperature,1);
w.close();console.log('PASS: persistent first-import numeric defaults survive native saves, JSON reloads, same-name imports, per-preset switching and renames; unavailable presets do not snapshot live edits, deletion clears ownership and prompt/credential data is excluded.');
