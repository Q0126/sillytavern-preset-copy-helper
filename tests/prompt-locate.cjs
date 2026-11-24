const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const settle=async()=>{await tick();await tick();};
(async()=>{
    const dom=new JSDOM('<div id="completion_prompt_manager"><div data-v-app><ul id="completion_prompt_manager_list"><li class="completion_prompt_manager_prompt" data-pm-identifier="plain"></li><details><summary>原生折叠组</summary><li class="completion_prompt_manager_prompt" data-pm-identifier="details"></li></details><li class="bai-bai-preset-group bai-bai-preset-group-collapsed" data-preset-group-id="target"><div class="bai-bai-preset-group-header"><button class="bai-bai-preset-group-toggle">展开目标组</button></div><div class="bai-bai-preset-group-body" aria-hidden="true"></div></li><li class="bai-bai-preset-group bai-bai-preset-group-collapsed" data-preset-group-id="unrelated"><button class="bai-bai-preset-group-toggle">其他组</button></li></ul></div></div>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window,d=w.document,list=d.querySelector('ul'),targetGroup=d.querySelector('[data-preset-group-id="target"]');
    let preset='A',groupClicks=0,otherClicks=0,writes=0,scrolled=[],messages=[];
    const manager={serviceSettings:{preset_settings_openai:'A',extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'target',collapsed:true},{id:'unrelated',collapsed:true}],prompts:{virtual:{groupId:'target'}}}}}},isPromptToggleAllowed:()=>true,saveServiceSettings(){writes++;}};
    w.toastr={info:message=>messages.push(message),error:message=>messages.push(message)};w.matchMedia=()=>({matches:true});
    w.HTMLElement.prototype.scrollIntoView=function(options){scrolled.push({row:this,options});};
    const highlights=new Map(),set=w.setTimeout.bind(w),clear=w.clearTimeout.bind(w);let timerID=-100;
    w.setTimeout=(callback,ms,...args)=>ms===1800?(highlights.set(--timerID,callback),timerID):set(callback,ms,...args);
    w.clearTimeout=id=>{if(!highlights.delete(id))clear(id);};
    d.querySelector('[data-preset-group-id="unrelated"] button').onclick=()=>otherClicks++;
    targetGroup.querySelector('button').onclick=()=>{
        groupClicks++;targetGroup.classList.remove('bai-bai-preset-group-collapsed');
        set(()=>{if(preset!=='A')return;const body=targetGroup.querySelector('.bai-bai-preset-group-body');body.setAttribute('aria-hidden','false');const row=d.createElement('li');row.dataset.pmIdentifier='virtual';row.className='completion_prompt_manager_prompt';body.append(row);},8);
    };
    w.eval(fs.readFileSync(path.join(__dirname,'../prompt-search.js'),'utf8').replace('export function ','function ')+'\nwindow.makeSearch=createNativePromptSearch;');
    const search=w.makeSearch({getManager:()=>manager,getPresetName:()=>preset,onRefresh(){}});
    const prompts=['plain','details','virtual'].map(identifier=>({identifier,name:identifier,enabled:true}));
    const before=list.outerHTML;search.filter(list,prompts,true);assert.equal(list.outerHTML,before);
    const button=id=>d.querySelector('.bs-pc-search-results [data-pm-identifier="'+id+'"] .bs-pc-locate');
    assert.equal(button('plain').textContent,'定位');assert.equal(button('plain').getAttribute('aria-label'),'定位 plain');
    button('plain').click();await settle();const plain=list.querySelector('[data-pm-identifier="plain"]');
    assert.equal(scrolled.length,1);assert.equal(scrolled[0].row,plain);assert.equal(scrolled[0].options.block,'center');assert.equal(scrolled[0].options.behavior,'auto');assert.equal(d.activeElement,plain);assert.equal(plain.classList.contains('bs-pc-locate-highlight'),true);assert.equal(plain.getAttribute('tabindex'),'-1');assert.equal(button('plain').textContent,'定位');assert.equal(groupClicks,0);assert.equal(otherClicks,0);
    for(const callback of [...highlights.values()])callback();assert.equal(plain.classList.contains('bs-pc-locate-highlight'),false);assert.equal(plain.hasAttribute('tabindex'),false);
    button('details').click();await new Promise(resolve=>setTimeout(resolve,230));assert.equal(list.querySelector('details').open,true);assert.equal(scrolled.at(-1).row,list.querySelector('[data-pm-identifier="details"]'));assert.equal(groupClicks,0);
    // An unmounted grouped entry is found via current group metadata. Only its
    // actual native toggle is clicked; the unrelated collapsed group is intact.
    button('virtual').click();await new Promise(resolve=>setTimeout(resolve,240));
    const original=list.querySelector('[data-pm-identifier="virtual"]');
    assert.equal(groupClicks,1);assert.equal(otherClicks,0);assert.equal(scrolled.at(-1).row,original);assert.notEqual(scrolled.at(-1).row,d.querySelector('.bs-pc-search-results [data-pm-identifier="virtual"]'));assert.equal(original.classList.contains('bs-pc-locate-highlight'),true);assert.equal(writes,0);
    // Restore focus attributes exactly, even when the native row already had one.
    plain.tabIndex=0;button('plain').click();await settle();search.destroy();assert.equal(plain.getAttribute('tabindex'),'0');assert.equal(plain.classList.contains('bs-pc-locate-highlight'),false);assert.equal(highlights.size,0);
    // A switch/disable cancels pending async expansion and never scrolls to A
    // after B is selected.
    preset='A';targetGroup.classList.add('bai-bai-preset-group-collapsed');targetGroup.querySelector('[data-pm-identifier="virtual"]').remove();targetGroup.querySelector('.bai-bai-preset-group-body').setAttribute('aria-hidden','true');
    search.filter(list,[prompts[2]],true);const count=scrolled.length;button('virtual').click();preset='B';search.destroy();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(scrolled.length,count);assert.equal(d.querySelector('.bs-pc-locate-highlight'),null);assert.equal(messages.length,0);assert.equal(otherClicks,0);assert.equal(writes,0);
    w.close();console.log('PASS: locate buttons jump to native rows, center/focus/highlight and clean up, respect reduced motion, expand details and only the owning BaiBai group through native toggles, wait for unmounted rows, cancel on preset switch/disable, and never edit prompt data.');
})().catch(error=>{console.error(error);process.exitCode=1;});
