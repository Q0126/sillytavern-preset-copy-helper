// Install jsdom in your test environment, then run: node tests/switch-profiles.cjs
const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../switch-profiles.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function main(){
    const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
    w.confirm=()=>true;
    w.eval(source.replaceAll('export async function ','async function ').replaceAll('export function ','function ')+'\nwindow.testAPI={captureSwitches,applySwitches,createSwitchProfiles};');
    const {captureSwitches,applySwitches,createSwitchProfiles}=w.testAPI;
    const prompts=[{identifier:'a',name:'A',content:'same content A'},{identifier:'b',name:'B',content:'same content B'},{identifier:'system',name:'protected'}];
    const order=[{identifier:'a',enabled:true},{identifier:'b',enabled:false},{identifier:'system',enabled:true}];
    let writes=0,fail=false,presetName='Shared',settingsWrites=0;
    const manager={activeCharacter:{id:100001},getPromptOrderForCharacter:()=>order,getPromptById:id=>prompts.find(p=>p.identifier===id),isPromptToggleAllowed:p=>p.identifier!=='system',async saveServiceSettings(){writes++;if(fail)throw Error('failed save')},render(){},tokenHandler:{getCounts:()=>({})}};
    const snapshotA=captureSwitches(manager);assert.equal(snapshotA.length,2);assert.deepEqual(JSON.parse(JSON.stringify(snapshotA)),[{identifier:'a',enabled:true},{identifier:'b',enabled:false}]);
    order[0].enabled=false;order[1].enabled=true;const snapshotB=captureSwitches(manager),body=JSON.stringify(prompts),ids=order.map(p=>p.identifier).join(',');
    let result=await applySwitches(manager,snapshotA);assert.equal(result.changed,2);assert.equal(writes,1);assert.equal(order[0].enabled,true);assert.equal(order[1].enabled,false);assert.equal(order[2].enabled,true);assert.equal(JSON.stringify(prompts),body);assert.equal(order.map(p=>p.identifier).join(','),ids);
    await applySwitches(manager,snapshotB);assert.equal(order[0].enabled,false);assert.equal(order[1].enabled,true);assert.equal(writes,2);await applySwitches(manager,snapshotB);assert.equal(writes,2);
    fail=true;await assert.rejects(applySwitches(manager,snapshotA),/failed save/);assert.equal(order[0].enabled,false);assert.equal(order[1].enabled,true);fail=false;
    prompts.push({identifier:'new',content:'new content'});order.push({identifier:'new',enabled:true});result=await applySwitches(manager,[...snapshotA,{identifier:'removed',enabled:true},{identifier:'system',enabled:false}]);assert.equal(result.added,1);assert.equal(result.missing,2);assert.equal(order[3].enabled,true);assert.equal(order[2].enabled,true);
    await assert.rejects(applySwitches(manager,[{identifier:'gone',enabled:true}]),/不存在/);
    const settings={},context={saveSettingsDebounced(){settingsWrites++;}},factory=()=>createSwitchProfiles({context,settings,getManager:()=>manager,getPresetName:()=>presetName,onRefresh(){}});
    let controller=factory();controller.mount(d.querySelector('#host'));
    const btn=(name,scope=d)=>{const item=[...scope.querySelectorAll('button')].find(item=>item.textContent===name);assert.ok(item,`button ${name}`);return item;};
    const run=async name=>{btn(name).click();await tick();await tick();};
    await run('角色方案');d.querySelector('[aria-label="角色 / 方案名字"]').value='角色 A';await run('保存当前开关');assert.equal(settings.switchProfiles.length,1);assert.equal(settings.switchProfiles[0].name,'角色 A');assert.equal(JSON.stringify(settings).includes('new content'),false);
    order[0].enabled=false;order[1].enabled=true;d.querySelector('[aria-label="角色 / 方案名字"]').value='角色 B';await run('保存当前开关');assert.equal(settings.switchProfiles.length,2);assert.ok(settingsWrites>=2);
    btn('关闭').click();await run('角色 A');assert.equal(order[0].enabled,true);assert.equal(order[1].enabled,false);await run('角色 B');assert.equal(order[0].enabled,false);assert.equal(order[1].enabled,true);
    // Removing and remounting preserves profiles stored in extension settings.
    controller.destroy();const next=d.createElement('div');d.body.append(next);controller=factory();controller.mount(next);assert.ok(btn('角色 A'));assert.equal(btn('角色 B').getAttribute('aria-pressed'),'true');
    presetName='Other';controller.refresh();assert.equal([...next.querySelectorAll('button')].some(n=>n.textContent==='角色 A'),false);
    controller.renamePreset('Shared','Renamed');presetName='Renamed';controller.refresh();assert.ok(btn('角色 A'));assert.equal(settings.switchProfiles[0].presetName,'Renamed');
    await run('角色方案');presetName='Changed while open';d.querySelector('[aria-label="角色 / 方案名字"]').value='Should not save';await run('保存当前开关');assert.equal(settings.switchProfiles.length,2);assert.equal(d.querySelector('.bs-switch-modal'),null);
    presetName='Renamed';controller.refresh();
    await run('角色方案');w.confirm=()=>false;await run('删除方案');assert.equal(settings.switchProfiles.length,2);w.confirm=()=>true;
    // Updating a scheme never appends a duplicate and uses fresh current switches.
    order[0].enabled=true;await run('更新为当前开关');assert.equal(settings.switchProfiles.length,2);assert.equal(settings.switchProfiles[0].states[0].enabled,true);
    await run('删除方案');assert.equal(settings.switchProfiles.length,1);controller.deletePreset('Renamed');assert.equal(settings.switchProfiles.length,0);controller.destroy();assert.equal(d.querySelector('.bs-switch-modal'),null);
    dom.window.close();console.log('PASS: switch capture, A/B roundtrip, single save, no prompt/order changes, protected switches, new/missing entries, failure rollback, UI scheme save/update/delete, persistence, per-preset isolation, rename migration, stale dialog guard, confirmation and cleanup.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
