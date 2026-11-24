// Regression: cached manager remains on A while the live selector changes to B.
const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const settle=async()=>{await tick();await tick();};
(async()=>{
    const dom=new JSDOM('<div id="preset-row"><select id="settings_preset_openai"><option value="0">Preset A</option><option value="1">Preset B</option><option value="2">Preset C</option></select></div><div id="completion_prompt_manager"><ul id="completion_prompt_manager_list"></ul></div>',{runScripts:'outside-only'});
    const w=dom.window,d=w.document;
    w.structuredClone=structuredClone;w.confirm=()=>true;
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
    const statesA=[{identifier:'common-a',enabled:true},{identifier:'common-b',enabled:false}],statesB=[{identifier:'common-a',enabled:false},{identifier:'common-b',enabled:true}];
    let pending=Promise.resolve(),writes=0,delegate;
    const orderA=structuredClone(statesA);
    const model={preset_settings_openai:'Preset A',prompts:[{identifier:'common-a',name:'Common A',content:'original'},{identifier:'common-b',name:'Common B',content:'original'}],prompt_order:[{character_id:100001,order:orderA}]};
    const pm={serviceSettings:model,activeCharacter:{id:100001},getPromptById:id=>model.prompts.find(p=>p.identifier===id),getPromptOrderForCharacter:()=>model.prompt_order[0].order,isPromptToggleAllowed:()=>true,async saveServiceSettings(){writes++},render(){}};
    // Simulate a third-party extension retaining the old cached manager/select.
    const cachedSelect=d.querySelector('select');
    const presetManager={select:[cachedSelect],getSelectedPresetName:()=> 'Preset A'};
    w.openaiModule={promptManager:pm,oai_settings:model,getPresetApplicationPromise:()=>pending};w.presetModule={getPresetManager:()=>presetManager};
    const jqDocument={on(type,selector,handler){assert.equal(type,'change.bsPcPresetTools');delegate=handler;},off(type,selector,handler){assert.equal(handler,delegate);delegate=null;}};
    function jq(target){assert.equal(target,d);return jqDocument;}jq.fn={on(){}};w.jQuery=jq;
    const script=read('preset-defaults.js').replaceAll('export function ','function ')+'\n'+read('preset-slider-guard.js').replaceAll('export function ','function ')+'\n'+read('switch-profiles.js').replaceAll('export async function ','async function ').replaceAll('export function ','function ')+'\n'+read('prompt-search.js').replaceAll('export function ','function ')+'\n'+read('preset-tools.js').replace(/^import .* from ['\"]\.\/[^'\"]+['\"];\n?/gm,'').replaceAll('export function ','function ').replace("import('../../../openai.js')",'Promise.resolve(window.openaiModule)').replace("import('../../../preset-manager.js')",'Promise.resolve(window.presetModule)');
    w.eval(script+'\nwindow.createTool=createPresetTools;');
    const settings={search:true,switchProfiles:[{id:'A',presetName:'Preset A',name:'A-only role',states:structuredClone(statesA)},{id:'B',presetName:'Preset B',name:'B-only role',states:structuredClone(statesB)}]};
    let tool;tool=w.createTool({context:{saveSettingsDebounced(){}},settings,onRefresh:()=>tool?.refresh()});await settle();
    const names=()=>[...d.querySelectorAll('.bs-switch-name')].map(node=>node.textContent);
    const schemeButton=()=>d.querySelector('.bs-preset-switcher > button');
    const open=async()=>{schemeButton().click();await settle();};
    const close=()=>[...d.querySelectorAll('.bs-switch-modal .bs-theme-header button')].find(node=>node.textContent==='关闭').click();
    const roleButton=()=>d.querySelector('.bs-switch-choose');
    const choose=value=>{const select=d.querySelector('select');select.value=value;delegate({target:select});};
    assert.equal(d.querySelector('.bs-preset-switcher').textContent,'角色方案');await open();assert.deepEqual(names(),['A-only role']);const staleA=roleButton();
    // jQuery synthetic change: deliberately do NOT dispatch a native DOM event.
    choose('1');assert.equal(d.querySelector('.bs-switch-modal'),null);assert.equal(presetManager.getSelectedPresetName(),'Preset A');
    staleA.click();await settle();assert.equal(writes,0);await open();assert.deepEqual(names(),['B-only role']);close();assert.equal(settings.switchProfiles.length,2);
    choose('2');await open();assert.deepEqual(names(),[]);close();choose('0');await open();assert.deepEqual(names(),['A-only role']);close();
    // A DOM replacement also leaves the core manager's cached reference stale.
    const replacement=cachedSelect.cloneNode(true);replacement.value='1';cachedSelect.replaceWith(replacement);delegate({target:replacement});await open();assert.deepEqual(names(),['B-only role']);assert.notEqual(presetManager.select[0],d.querySelector('select'));
    // B's scheme must wait until B's settings are actually loaded. A and B use
    // identical identifiers here, so identifier overlap cannot hide a bad write.
    let finishB;pending=new Promise(resolve=>{finishB=resolve;});choose('1');roleButton().click();await settle();assert.equal(writes,0);assert.deepEqual(orderA,statesA);
    const orderB=structuredClone(statesA);model.prompt_order=[{character_id:100001,order:orderB}];model.preset_settings_openai='Preset B';finishB();await settle();assert.deepEqual(orderB,statesB);assert.deepEqual(orderA,statesA);assert.equal(writes,1);assert.equal(d.querySelector('.bs-switch-modal'),null);
    choose('0');assert.equal(d.querySelector('.bs-preset-switcher').textContent,'角色方案');
    // Switching presets closes a scheme editor instead of leaving A's list on B.
    await open();assert.ok(d.querySelector('.bs-switch-modal'));choose('1');assert.equal(d.querySelector('.bs-switch-modal'),null);await open();assert.deepEqual(names(),['B-only role']);close();assert.equal(settings.switchProfiles.length,2);
    // Cancelling an in-flight A apply by selecting B cannot write into B.
    choose('0');await open();let finishA;pending=new Promise(resolve=>{finishA=resolve;});roleButton().click();await settle();const before=JSON.stringify(orderB),beforeWrites=writes;choose('1');finishA();await settle();assert.equal(writes,beforeWrites);assert.equal(JSON.stringify(orderB),before);await open();assert.deepEqual(names(),['B-only role']);close();
    tool.destroy();assert.equal(delegate,null);
    // Reloading on B still uses B, despite stale persisted/cached A metadata.
    pending=Promise.resolve();model.preset_settings_openai='Preset A';tool=w.createTool({context:{saveSettingsDebounced(){}},settings,onRefresh:()=>tool?.refresh()});await settle();await open();assert.deepEqual(names(),['B-only role']);assert.equal(settings.switchProfiles.length,2);tool.destroy();
    // Older managers expose only getPresetList; ownership repair still needs
    // their saved catalog, rather than silently accepting an empty catalog.
    const uniqueA=[{identifier:'unique-a',enabled:true}],uniqueB=[{identifier:'unique-b',enabled:true}];
    presetManager.getPresetList=()=>({presets:[{prompts:uniqueA},{prompts:uniqueB}],preset_names:{'Preset A':0,'Preset B':1}});
    settings.switchProfiles=[{id:'legacy',name:'Actually A',presetName:'Preset B',states:structuredClone(uniqueA)}];
    tool=w.createTool({context:{saveSettingsDebounced(){}},settings,onRefresh:()=>tool?.refresh()});await settle();await open();assert.deepEqual(names(),[]);assert.equal(settings.switchProfiles[0].presetName,'Preset A');close();
    choose('0');await open();assert.deepEqual(names(),['Actually A']);tool.destroy();
    dom.window.close();console.log('PASS: live A/B scope, jQuery-only changes, stale manager/select, DOM replacement, unknown preset, old-chip guard, load barrier, cancelled apply, dialog/status cleanup, persistence, legacy catalog fallback and listener cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
