// node tests/toolbox-compat.cjs
// Optional real Vue/Sortable render test: BAIBAI_SOURCE=/path/to/ST-BaiBai-Tools
// NODE_PATH=/path/to/jsdom/node_modules node --experimental-vm-modules tests/toolbox-compat.cjs
const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const settle=async()=>{await tick();await tick();};
async function main(){
    const dom=new JSDOM('<select id="settings_preset_openai"><option>A</option><option>B</option></select><div id="completion_prompt_manager"><div class="bai-bai-preset-vue-list-host" data-v-app></div></div>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window,d=w.document,host=d.querySelector('[data-v-app]'),select=d.querySelector('select');
    w.structuredClone=structuredClone;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
    const listeners=new Map(),context={saveSettingsDebounced(){},eventTypes:{OAI_PRESET_CHANGED_BEFORE:'preset-before'},eventSource:{on:(type,fn)=>listeners.set(type,fn),removeListener:(type,fn)=>{assert.equal(listeners.get(type),fn);listeners.delete(type);}}};
    const model={preset_settings_openai:'A',prompts:[],prompt_order:[]},errors=[];
    const pm={serviceSettings:model,activeCharacter:{id:100001},getPromptOrderForCharacter:()=>model.prompt_order,getPromptById:id=>model.prompts.find(p=>p.identifier===id),isPromptToggleAllowed:()=>true};
    const rows=name=>[{identifier:`${name}-visible`,name:`${name} visible`,content:'visible',enabled:true},{identifier:`${name}-virtual`,name:`${name} folded`,content:'needle',enabled:false}];
    let updateView,unmount,vue;
    if(process.env.BAIBAI_SOURCE){
        // Real upstream vendor runtime and draggable component, in a DOM realm.
        const modules=new Map(),runtime=path.resolve(process.env.BAIBAI_SOURCE,'vendor');
        async function load(file){
            if(modules.has(file))return modules.get(file);
            const mod=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context:dom.getInternalVMContext(),identifier:file});modules.set(file,mod);
            await mod.link(spec=>load(path.resolve(path.dirname(file),spec)));return mod;
        }
        const draggable=await load(path.join(runtime,'vue-draggable-next.esm-browser.prod.js'));await draggable.evaluate();
        vue=modules.get(path.join(runtime,'vue.esm-browser.prod.js')).namespace;
        const state=vue.reactive({name:'A',expanded:false}),h=vue.h;
        const app=vue.createApp({render(){const name=state.name;return [h('div',{class:'global-library'},'全局库'),h(draggable.namespace.VueDraggableNext,{tag:'ul',id:'completion_prompt_manager_list',list:[name],sort:false},{default:()=>[
            h('li',{key:`group-${name}`,class:'bai-bai-preset-group'},[h('strong',{},`Group ${name}`),h('div',{class:'bai-bai-preset-group-body'},[h('ul',{},[h('li',{'data-pm-identifier':`${name}-visible`,class:'completion_prompt_manager_prompt'},`${name} visible`)])])]),
            h('li',{key:`fold-${name}`,class:'bai-bai-preset-group'+(state.expanded?'':' bai-bai-preset-group-collapsed'),'data-preset-group-id':'fold-'+name},[h('strong',{},`Folded ${name}`),h('button',{class:'bai-bai-preset-group-toggle',onClick:()=>{state.expanded=true;}},'展开'),h('div',{hidden:!state.expanded,class:'folded-body','aria-hidden':state.expanded?'false':'true'},state.expanded?[h('li',{'data-pm-identifier':name+'-virtual',class:'completion_prompt_manager_prompt'},name+' folded')]:[])])
        ]})];}});app.config.errorHandler=error=>errors.push(error);app.mount(host);
        updateView=async name=>{state.name=name;state.expanded=false;await vue.nextTick();await settle();};unmount=()=>app.unmount();
    }else{
        host.innerHTML='<div class="global-library">全局库</div><ul id="completion_prompt_manager_list"></ul>';
        updateView=async name=>{d.querySelector('#completion_prompt_manager_list').innerHTML=`<li class="bai-bai-preset-group"><strong>Group ${name}</strong><div><ul><li data-pm-identifier="${name}-visible">${name} visible</li></ul></div></li><li class="bai-bai-preset-group"><div class="folded-body" hidden></div></li>`;};unmount=()=>{};
    }
    function loadModel(name){model.preset_settings_openai=name;model.prompts=rows(name);model.prompt_order=model.prompts.map(p=>({identifier:p.identifier,enabled:p.enabled}));}
    loadModel('A');await updateView('A');
    w.openaiModule={promptManager:pm,oai_settings:model};w.presetModule={getPresetManager:()=>({getAllPresets:()=>['A','B']})};
    const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    const script=read('preset-defaults.js').replaceAll('export function ','function ')+'\n'+read('preset-slider-guard.js').replaceAll('export function ','function ')+'\n'+read('switch-profiles.js').replaceAll('export async function ','async function ').replaceAll('export function ','function ')+'\n'+read('prompt-search.js').replaceAll('export function ','function ')+'\n'+read('preset-tools.js').replace(/^import .* from ['\"]\.\/[^'\"]+['\"];\n?/gm,'').replaceAll('export function ','function ').replace("import('../../../openai.js')",'Promise.resolve(window.openaiModule)').replace("import('../../../preset-manager.js')",'Promise.resolve(window.presetModule)');
    w.eval(script+'\nwindow.makeTools=createPresetTools;');
    let tool;tool=w.makeTools({context,settings:{search:true},onRefresh:()=>tool?.refresh()});await settle();tool.refresh();
    const search=()=>d.querySelector('[aria-label="搜索当前预设条目"]');
    function input(query){search().value=query;search().dispatchEvent(new w.Event('input',{bubbles:true}));}
    const originalChildren=[...host.childNodes];
    assert.equal(host.querySelector('.bs-pc-search'),null,'toolbar must be outside the entire Vue mount');
    input('needle');assert.ok(d.querySelector('[data-bs-pc-fallback]'));assert.equal(host.querySelector('[data-bs-pc-fallback]'),null,'virtual results must not become Vue/Sortable children');assert.deepEqual([...host.childNodes],originalChildren);
    const nativeBeforeSearch=host.innerHTML;input('visible');assert.equal(host.innerHTML,nativeBeforeSearch);assert.equal(d.querySelector('.bs-pc-search-results [data-pm-identifier="A-visible"]').dataset.bsPcFallback,'true');input('needle');assert.equal(host.innerHTML,nativeBeforeSearch);
    // Recreating just our toolbar must not keep virtual rows in its detached predecessor.
    d.querySelector('.bs-pc-search').remove();tool.refresh();assert.ok(d.querySelector('[data-bs-pc-fallback]'));assert.equal(host.querySelector('[data-bs-pc-fallback]'),null);
    assert.equal(host.querySelector('[data-pm-identifier="A-visible"]').classList.contains('bs-pc-hidden'),false);
    // Before core updates its model, clear marks and fallback rows synchronously.
    listeners.get('preset-before')();assert.equal(search().value,'');assert.equal(d.querySelector('[data-bs-pc-fallback]'),null);assert.equal(d.querySelector('[data-pm-identifier="A-visible"]').classList.contains('bs-pc-hidden'),false);
    for(const name of ['B','A','B']){
        select.value=name;select.dispatchEvent(new w.Event('change',{bubbles:true}));loadModel(name);tool.refresh();await updateView(name);tool.refresh();
        assert.ok(host.textContent.includes(`Group ${name}`));assert.ok(d.querySelector(`[data-pm-identifier="${name}-visible"]`));assert.equal(d.querySelectorAll('.bs-pc-search').length,1);assert.equal(host.querySelector('.bs-pc-search'),null);assert.equal(host.querySelector('[data-bs-pc-fallback]'),null);assert.equal(search().value,'');assert.equal(d.querySelector('.folded-body').hidden,true);
        input('needle');assert.equal(d.querySelector('[data-bs-pc-fallback]').dataset.pmIdentifier,`${name}-virtual`);
    }
    if(vue){
        // Locate must use a real Vue toggle to mount the matching child; no
        // injected nodes may enter the Vue/Sortable subtree.
        model.extensions={baibaiToolkit:{presetPromptGroups:{groups:[{id:'fold-B'}],prompts:{'B-virtual':{groupId:'fold-B'}}}}};
        const scrolls=[];w.HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this);};
        d.querySelector('.bs-pc-search-results [data-pm-identifier="B-virtual"] .bs-pc-locate').click();await new Promise(resolve=>setTimeout(resolve,240));
        const target=host.querySelector('[data-pm-identifier="B-virtual"]');assert.ok(target);assert.equal(scrolls.at(-1),target);assert.equal(target.classList.contains('bs-pc-locate-highlight'),true);assert.equal(host.querySelector('[data-bs-pc-fallback]'),null);assert.deepEqual(errors,[]);
    }
    // Replacing the whole list with a new managed instance also stays external.
    unmount();host.innerHTML='<div class="global-library">全局库</div><ul id="completion_prompt_manager_list"><li data-pm-identifier="B-visible">B visible</li></ul>';tool.refresh();assert.equal(d.querySelectorAll('.bs-pc-search').length,1);assert.equal(host.querySelector('.bs-pc-search'),null);assert.equal(host.querySelector('[data-bs-pc-fallback]'),null);
    tool.destroy();assert.equal(listeners.size,0);assert.equal(d.querySelectorAll('.bs-pc-search').length,0);assert.equal(host.querySelector('[data-pm-identifier]').classList.contains('bs-pc-hidden'),false);assert.deepEqual(errors,[]);dom.window.close();
    console.log(`PASS: ${vue?'upstream Vue + VueDraggableNext':'managed DOM'} grouping survives active search, folded/virtual results, A/B/A/B switches, before-event cleanup, mount replacement and disable cleanup.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
