// NODE_PATH=../test-deps/node_modules node --experimental-vm-modules tests/release-loading.cjs
// Exercise real module URLs and the actual entry point with cached old modules.
const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const manifest=JSON.parse(read('manifest.json'));
const base=new URL('https://tavern.test/scripts/extensions/third-party/baishui/');
async function main(){
    const dom=new JSDOM('<div id="extensions_settings2"><div id="bs-pc-settings">预设搜索、批量管理与角色方案</div></div><div id="preset-row"><select id="settings_preset_openai"><option>A</option></select></div><div id="range_block_openai"><div class="range-block"><div class="range-block-title">温度</div><div class="range-block-range"><input type="range" id="temp_openai" min="0" max="2" step=".01" value=".98"></div><div class="range-block-counter"><input type="number" id="temp_counter_openai" data-for="temp_openai" value=".98"></div></div></div>',{runScripts:'outside-only',url:base.href,pretendToBeVisual:true});
    const w=dom.window,d=w.document,realm=dom.getInternalVMContext();
    w.structuredClone=structuredClone;
    const saved={temperature:.7,prompts:[]},settings={temp_openai:.7,preset_settings_openai:'A',prompts:[],prompt_order:[]};
    let saves=0;
    const extensionSettings={baishui_preset_copy:{search:true,protect:false,worldBooks:false,themeGallery:false}},handlers=new Map();
    const context={extensionSettings,saveSettingsDebounced(){},eventTypes:{PRESET_RENAMED:'renamed',PRESET_DELETED:'deleted'},eventSource:{on(type,fn){handlers.set(type,fn);},removeListener(type,fn){assert.equal(handlers.get(type),fn);handlers.delete(type);}}};
    w.SillyTavern={getContext:()=>context};
    w.openai={oai_settings:settings,settingsToUpdate:{temperature:['#temp_openai','temp_openai']}};
    w.presetManager={getCompletionPresetByName:name=>name==='A'?saved:undefined};
    d.querySelector('#temp_openai').addEventListener('input',event=>{settings.temp_openai=Number(event.target.value);saves++;});
    const cache=new Map(),coreLoads=new Map();
    // A previous release's bare URLs must never be reused by the new graph.
    for(const name of fs.readdirSync(root).filter(name=>name.endsWith('.js'))){const url=new URL(name,base).href;cache.set(url,new vm.SourceTextModule('throw new Error("cached previous release")',{context:realm,identifier:url}));}
    async function load(url){
        if(cache.has(url))return cache.get(url);
        const resolved=new URL(url),isPlugin=resolved.href.startsWith(base.href);
        let source;
        if(isPlugin){
            assert.equal(resolved.searchParams.get('v'),manifest.version,`Unversioned plugin dependency: ${url}`);
            source=read(path.basename(resolved.pathname));
        }else{
            assert.equal(resolved.search,'','Core ST state must retain its canonical module URL');
            coreLoads.set(url,(coreLoads.get(url)||0)+1);
            const coreName=path.basename(resolved.pathname);
            source=coreName==='openai.js'?'export const oai_settings=window.openai.oai_settings; export const settingsToUpdate=window.openai.settingsToUpdate;':coreName==='preset-manager.js'?'export const getPresetManager=()=>window.presetManager;':coreName==='world-info.js'?'export const world_names=[];':assert.fail(`Unexpected core import: ${url}`);
        }
        const module=new vm.SourceTextModule(source,{context:realm,identifier:url,importModuleDynamically:async(specifier,reference)=>{const dependency=await load(new URL(specifier,reference.identifier).href);if(dependency.status==='unlinked')await dependency.link(link);if(dependency.status==='linked')await dependency.evaluate();return dependency;}});
        cache.set(url,module);return module;
    }
    const link=(specifier,reference)=>load(new URL(specifier,reference.identifier).href);
    assert.equal(new URL(manifest.js,base).searchParams.get('v'),manifest.version);
    const cssUrl=new URL(manifest.css,base);assert.equal(cssUrl.searchParams.get('v'),manifest.version);
    const style=d.createElement('style');style.textContent=read(path.basename(cssUrl.pathname));d.head.append(style);
    const entry=await load(new URL(manifest.js,base).href);await entry.link(link);await entry.evaluate();
    d.dispatchEvent(new w.Event('DOMContentLoaded'));
    for(let i=0;i<3;i++)await new Promise(resolve=>w.requestAnimationFrame(resolve));
    const panel=d.querySelector('#bs-pc-settings');
    assert.equal(d.querySelectorAll('#bs-pc-settings').length,1);assert.equal(panel.dataset.version,manifest.version);
    assert.equal(panel.querySelector('.bs-pc-version').textContent,`v${manifest.version}`);
    assert.match(panel.textContent,/预设管理与滑条防误触/);assert.doesNotMatch(panel.textContent,/预设搜索、批量管理与角色方案/);
    const range=d.querySelector('#temp_openai'),number=d.querySelector('#temp_counter_openai');
    assert.equal(d.querySelector('.bs-preset-default').textContent,'默认 0.70');assert.equal(number.value,'0.70');assert.equal(range.hasAttribute('inert'),true);assert.equal(w.getComputedStyle(range).pointerEvents,'none');
    number.value='.83';number.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(settings.temp_openai,.83);assert.equal(saves,1);assert.equal(saved.temperature,.7);
    // Lifecycle hooks import exactly the same manifest URL as the script loader.
    assert.equal(await load(new URL(manifest.js,base).href),entry);
    // Saving current edits into the preset, then reloading persisted extension
    // settings, must never rewrite the first-import default.
    saved.temperature=.83;
    entry.namespace.onDisable();assert.equal(d.querySelector('#bs-pc-settings'),null);assert.equal(range.hasAttribute('inert'),false);assert.equal(handlers.size,0);
    extensionSettings.baishui_preset_copy=JSON.parse(JSON.stringify(extensionSettings.baishui_preset_copy));
    entry.namespace.onEnable();for(let i=0;i<3;i++)await new Promise(resolve=>w.requestAnimationFrame(resolve));assert.equal(d.querySelectorAll('#bs-pc-settings').length,1);assert.equal(d.querySelectorAll('.bs-preset-default').length,1);assert.equal(number.value,'0.83');assert.equal(d.querySelector('.bs-preset-default').textContent,'默认 0.70');assert.ok([...coreLoads.values()].every(count=>count===1));
    // Rename from native UI and import/re-import use the same immutable records.
    const option=d.querySelector('option');option.textContent='Renamed A';settings.preset_settings_openai='Renamed A';
    w.presetManager.getCompletionPresetByName=name=>name==='Renamed A'?saved:undefined;
    handlers.get('renamed')({apiId:'openai',oldName:'A',newName:'Renamed A'});
    for(let i=0;i<2;i++)await new Promise(resolve=>w.requestAnimationFrame(resolve));
    assert.equal(d.querySelector('.bs-preset-default').textContent,'默认 0.70');assert.equal(number.value,'0.83');
    const imported={temperature:1.2,prompts:[]};
    const newOption=d.createElement('option');newOption.text='New import';newOption.value='1';d.querySelector('select').append(newOption);
    w.presetManager.getCompletionPresetByName=name=>name==='Renamed A'?saved:name==='New import'?imported:undefined;
    const select=d.querySelector('select');select.value='1';settings.temp_openai=1.2;select.dispatchEvent(new w.Event('change',{bubbles:true}));
    for(let i=0;i<2;i++)await new Promise(resolve=>w.requestAnimationFrame(resolve));
    assert.equal(d.querySelector('.bs-preset-default').textContent,'默认 1.20');
    imported.temperature=.5;settings.temp_openai=.5;select.dispatchEvent(new w.Event('change',{bubbles:true}));
    for(let i=0;i<2;i++)await new Promise(resolve=>w.requestAnimationFrame(resolve));
    assert.equal(d.querySelector('.bs-preset-default').textContent,'默认 1.20');assert.equal(number.value,'0.50');
    newOption.remove();select.value='0';handlers.get('deleted')({apiId:'openai',name:'New import'});
    assert.equal(extensionSettings.baishui_preset_copy.presetOriginalDefaults.some(item=>item.name==='New import'),false);
    entry.namespace.onDisable();assert.equal(handlers.size,0);dom.window.close();
    console.log('PASS: actual versioned module graph bypasses cache, shares core modules, replaces stale settings; initial defaults survive native saves, persisted-settings reload, rename and same-name re-import; new imports/deletion, numeric saves, track protection and hook cleanup work.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
