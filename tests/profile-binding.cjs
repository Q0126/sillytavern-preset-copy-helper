// Legacy metadata may say B while the stored snapshot contains only A's IDs.
const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const settle=async()=>{await tick();await tick()};
(async()=>{
    const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
    w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
    w.eval(fs.readFileSync(path.join(__dirname,'../switch-profiles.js'),'utf8').replaceAll('export async function ','async function ').replaceAll('export function ','function ')+'\nwindow.api={repairSwitchProfileBindings,createSwitchProfiles};');
    const a=[{identifier:'main',enabled:true},{identifier:'a-one',enabled:true},{identifier:'a-two',enabled:false},{identifier:'a-three',enabled:true}];
    const b=[{identifier:'main',enabled:true},{identifier:'b-one',enabled:true},{identifier:'b-two',enabled:true}];
    let catalog=[{name:'Preset A',prompts:a},{name:'Preset B',prompts:b}];
    const original=JSON.stringify(a),legacy={id:'legacy',name:'Old A role',presetName:'Preset B',states:structuredClone(a)};
    const repaired=structuredClone(legacy);assert.equal(w.api.repairSwitchProfileBindings([repaired],catalog),true);assert.equal(repaired.presetName,'Preset A');assert.equal(repaired.previousPresetName,'Preset B');assert.equal(repaired.bindingVersion,2);assert.equal(JSON.stringify(repaired.states),original);assert.equal(w.api.repairSwitchProfileBindings([repaired],catalog),false);
    const ambiguous={...structuredClone(legacy),presetName:'Preset A copy'};const sameIds=[catalog[0],{name:'Preset A copy',prompts:a}];w.api.repairSwitchProfileBindings([ambiguous],sameIds);assert.equal(ambiguous.presetName,'Preset A copy');
    const coreOnly={id:'core',presetName:'Preset B',states:[{identifier:'main',enabled:true}]};w.api.repairSwitchProfileBindings([coreOnly],catalog);assert.equal(coreOnly.presetName,'Preset B');
    let presetName='Preset B',writes=0,saves=0;const settings={switchProfiles:[legacy]};
    const model={prompts:a.map(p=>({...p,content:'A source'})),order:structuredClone(a)};
    const manager={activeCharacter:{id:100001},getPromptOrderForCharacter:()=>model.order,getPromptById:id=>model.prompts.find(p=>p.identifier===id),isPromptToggleAllowed:()=>true,async saveServiceSettings(){writes++},render(){}};
    const controller=w.api.createSwitchProfiles({context:{saveSettingsDebounced(){saves++}},settings,getManager:()=>manager,getPresetName:()=>presetName,getPresetCatalog:()=>catalog,onRefresh(){}});controller.mount(d.querySelector('#host'));
    const button=(text,scope=d)=>{const found=[...scope.querySelectorAll('button')].find(n=>n.textContent===text);assert.ok(found,text);return found};
    const open=async()=>{button('角色方案').click();await settle()};const close=()=>button('关闭').click();
    await open();assert.equal(d.querySelectorAll('.bs-switch-choose').length,0);assert.equal(legacy.presetName,'Preset A');assert.equal(JSON.stringify(legacy.states),original);assert.equal(writes,0);assert.ok(saves>0);
    // The old wait hook may be absent: reject saving A's still-loaded data as B.
    d.querySelector('[aria-label="角色 / 方案名字"]').value='Must not bind A as B';button('保存当前开关').click();await settle();assert.equal(settings.switchProfiles.length,1);assert.match(d.querySelector('.bs-switch-modal [role=status]').textContent,/不一致/);close();
    presetName='Preset A';controller.refresh();await open();assert.equal(d.querySelector('.bs-switch-name').textContent,'Old A role');
    // Explicit ownership edits are available when identical copies are ambiguous.
    close();catalog=[...catalog,{name:'Preset A copy',prompts:a}];await open();const owner=d.querySelector('[aria-label="所属预设 Old A role"]');assert.ok(owner);owner.value='Preset A copy';button('保存归属').click();await settle();assert.equal(legacy.presetName,'Preset A copy');assert.equal(JSON.stringify(legacy.states),original);assert.equal(d.querySelectorAll('.bs-switch-choose').length,0);close();
    presetName='Preset A copy';controller.refresh();await open();assert.equal(d.querySelector('.bs-switch-name').textContent,'Old A role');close();
    // Keep unresolved legacy records recoverable, never offer their switches on B.
    settings.switchProfiles.push({id:'unknown',name:'Unknown old role',presetName:'Preset B',states:[{identifier:'gone-id',enabled:true}]});presetName='Preset B';controller.refresh();model.prompts=b;model.order=structuredClone(b);await open();assert.equal(d.querySelectorAll('.bs-switch-choose').length,0);assert.ok(d.querySelector('.bs-switch-recovery'));assert.ok(d.querySelector('[aria-label="修复归属 Unknown old role"]'));assert.equal(settings.switchProfiles.length,2);assert.equal(writes,0);
    controller.destroy();dom.window.close();console.log('PASS: legacy B label/A snapshot repair, state preservation, idempotence, shared-built-in exclusion, ambiguous copies, wrong-loaded-source save guard, explicit ownership editing and non-destructive recovery.');
})().catch(error=>{console.error(error);process.exitCode=1});
