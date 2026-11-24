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
    w.SillyTavern={getContext:()=>({extensionSettings:{baishui_preset_copy:{search:true,protect:false,worldBooks:false,themeGallery:false}},saveSettingsDebounced(){}})};
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
    entry.namespace.onDisable();assert.equal(d.querySelector('#bs-pc-settings'),null);assert.equal(range.hasAttribute('inert'),false);
    entry.namespace.onEnable();for(let i=0;i<3;i++)await new Promise(resolve=>w.requestAnimationFrame(resolve));assert.equal(d.querySelectorAll('#bs-pc-settings').length,1);assert.equal(d.querySelectorAll('.bs-preset-default').length,1);assert.equal(number.value,'0.83');assert.equal(d.querySelector('.bs-preset-default').textContent,'默认 0.70');assert.ok([...coreLoads.values()].every(count=>count===1));
    entry.namespace.onDisable();dom.window.close();
    console.log('PASS: new release bypasses cached entry/dependencies/styles, canonical ST modules stay shared, stale settings panel is replaced, defaults/track protection/numeric saves and lifecycle hooks work through the actual module graph.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
