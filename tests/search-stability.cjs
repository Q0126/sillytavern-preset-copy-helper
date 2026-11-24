const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
(async()=>{
    const dom=new JSDOM('<div><select id="settings_preset_openai"><option>A</option></select></div><div id="completion_prompt_manager"><div data-v-app><ul id="completion_prompt_manager_list"><li>native list</li></ul></div></div><div class="range-block"><div class="range-block-title">温度</div><div class="range-block-range"><input id="temp_openai" type="range" min="0" max="2" step=".01"></div><div class="range-block-counter"><input id="temp_counter_openai" type="number"></div></div>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window,d=w.document;w.structuredClone=structuredClone;
    const frames=new Map();let frameID=0;
    w.requestAnimationFrame=callback=>{frames.set(++frameID,callback);return frameID;};w.cancelAnimationFrame=id=>frames.delete(id);
    const flush=()=>{let safety=0;while(frames.size){assert.ok(safety++<30);const [id,callback]=frames.entries().next().value;frames.delete(id);callback();}};
    const counts={};let contentReads=0,normalizations=0,catalogReads=0,sliderScans=0;
    const normalize=w.String.prototype.normalize;w.String.prototype.normalize=function(...args){normalizations++;return normalize.apply(this,args);};
    const queryAll=d.querySelectorAll.bind(d);d.querySelectorAll=function(selector){if(selector==='input[data-for]')sliderScans++;return queryAll(selector);};
    const prompts=Array.from({length:180},(_,i)=>{const content='长正文'.repeat(1000)+' needle '+(i===0?'first-only':'');return {identifier:'a-'+i,name:'条目 '+i,get content(){contentReads++;return content;},system_prompt:false};});
    const order=prompts.map(prompt=>({identifier:prompt.identifier,enabled:true}));
    const model={temp_openai:.8,preset_settings_openai:'A',prompts,prompt_order:[{character_id:100001,order}]};
    const pm={serviceSettings:model,activeCharacter:{id:100001},getPromptOrderForCharacter:()=>order,getPromptById:id=>prompts.find(prompt=>prompt.identifier===id),isPromptEditAllowed:()=>true,isPromptToggleAllowed:()=>true,isPromptDeletionAllowed:()=>true,tokenHandler:{getCounts:()=>counts}};
    w.openaiModule={promptManager:pm,oai_settings:model};w.presetModule={getPresetManager:()=>({getCompletionPresetByName:()=>({temperature:.8}),getPresetList(){catalogReads++;return {preset_names:{A:0},presets:[{temperature:.8}]};}})};
    const modules=['preset-defaults.js','preset-slider-guard.js','switch-profiles.js','prompt-search.js','preset-tools.js'].map(file=>read(file).replace(/^import .*$/gm,'').replaceAll('export async function ','async function ').replaceAll('export function ','function ').replace("import('../../../openai.js')",'Promise.resolve(window.openaiModule)').replace("import('../../../preset-manager.js')",'Promise.resolve(window.presetModule)')).join('\n');
    w.eval(modules+'\nwindow.makeTools=createPresetTools;');
    let tool;tool=w.makeTools({context:{saveSettingsDebounced(){}},settings:{search:true},onRefresh:()=>tool?.refresh()});await tick();await tick();tool.refresh();
    const input=d.querySelector('[aria-label="搜索当前预设条目"]'),panel=d.querySelector('.bs-pc-search-results'),bar=d.querySelector('.bs-pc-search'),nativeBefore=d.querySelector('[data-v-app]').innerHTML;
    assert.ok(contentReads>=180);assert.ok(normalizations>=180);assert.ok(sliderScans>0);
    let position=0,writes=0;Object.defineProperty(panel,'scrollTop',{configurable:true,get:()=>position,set:value=>{writes++;position=value;}});
    const search=value=>{input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
    contentReads=normalizations=catalogReads=sliderScans=0;
    search('needle');
    assert.equal(panel.querySelectorAll('.bs-pc-result').length,40);assert.match(d.querySelector('.bs-pc-count').textContent,/找到 180 \/ 180/);
    assert.equal(contentReads,0);assert.equal(normalizations,1);assert.equal(catalogReads,0);assert.equal(sliderScans,0);assert.equal(writes,0);assert.ok(frames.size);
    position=160;panel.dispatchEvent(new w.Event('scroll'));
    const first=panel.querySelector('[data-pm-identifier="a-0"]'),button=first.querySelector('.prompt-manager-toggle-action');
    // A token refresh must patch a row, never replace it or write scrollTop.
    counts['a-0']=55;order[0].enabled=false;tool.refresh();
    assert.equal(panel.querySelector('[data-pm-identifier="a-0"]'),first);assert.equal(first.querySelector('.prompt-manager-toggle-action'),button);assert.equal(first.querySelector('.bs-pc-result-tokens').textContent,'55');assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(writes,0);assert.equal(position,160);
    // Native list rebuilds must not replace our toolbar, results or scroll node,
    // including while deferred result batches are still pending.
    const oldList=d.querySelector('#completion_prompt_manager_list'),next=oldList.cloneNode(true);oldList.replaceWith(next);tool.refresh();assert.equal(d.querySelector('.bs-pc-search'),bar);assert.equal(d.querySelector('.bs-pc-search-results'),panel);assert.equal(d.querySelector('[aria-label="搜索当前预设条目"]'),input);assert.equal(writes,0);assert.equal(position,160);
    flush();assert.equal(panel.querySelectorAll('.bs-pc-result').length,180);assert.equal(writes,0);assert.equal(position,160);assert.equal(d.querySelector('[data-v-app]').innerHTML,nativeBefore);
    // Async native renders can leave no list for an entire refresh/frame.
    const parent=next.parentElement;next.remove();tool.refresh();assert.equal(d.querySelector('.bs-pc-search-results'),panel);assert.equal(panel.isConnected,true);assert.equal(position,160);assert.equal(writes,0);parent.append(next);tool.refresh();assert.equal(d.querySelector('.bs-pc-search-results'),panel);assert.equal(writes,0);
    // Duplicate input events / routine refreshes must leave momentum alone.
    search('needle');tool.refresh();assert.equal(writes,0);assert.equal(position,160);
    // A genuinely detached toolbar has a one-off position restore on remount.
    bar.remove();position=0;tool.refresh();assert.equal(d.querySelector('.bs-pc-search-results'),panel);assert.equal(position,160);assert.equal(writes,1);
    writes=0;contentReads=normalizations=catalogReads=sliderScans=0;
    search('missing');assert.equal(position,0);assert.equal(writes,1);assert.match(panel.textContent,/没有匹配的条目/);assert.equal(contentReads,0);assert.equal(normalizations,1);assert.equal(sliderScans,0);assert.equal(catalogReads,0);
    search('needle');assert.equal(panel.querySelectorAll('.bs-pc-result').length,40);assert.ok(frames.size);search('first-only');flush();assert.equal(panel.querySelectorAll('.bs-pc-result').length,1);assert.equal(panel.querySelector('.bs-pc-result').dataset.pmIdentifier,'a-0');
    // Invalidating an edited prompt updates only that cached search record.
    prompts[1].name='edited-only';tool.refresh();search('edited-only');assert.equal(panel.querySelectorAll('.bs-pc-result').length,1);assert.equal(panel.querySelector('.bs-pc-result').dataset.pmIdentifier,'a-1');
    search('needle');assert.ok(frames.size);tool.destroy();assert.equal(frames.size,0);assert.equal(d.querySelector('.bs-pc-search'),null);assert.equal(d.querySelector('[data-v-app]').innerHTML,nativeBefore);w.close();
    console.log('PASS: warm first search performs one query normalization and no body/catalog/slider rescans; 180 results render in bounded frames; scrolling has zero writes during token updates, duplicate input, native-list rebuilds and batch appends; stable nodes, one-off remount restore, cancelled stale batches and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
