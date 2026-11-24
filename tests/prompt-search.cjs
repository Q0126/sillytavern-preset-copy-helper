const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../prompt-search.js'),'utf8');
(async()=>{
    const dom=new JSDOM('<ul id="completion_prompt_manager_list"><section id="fold" class="theme-group" hidden style="display:none;max-height:0"><li data-pm-identifier="a" class="completion_prompt_manager_prompt theme-row"><span class="completion_prompt_manager_prompt_name" data-pm-name="A">A</span><span class="prompt_manager_prompt_controls"><span class="prompt-manager-edit-action fa-solid fa-pencil"></span><span class="prompt-manager-toggle-action fa-solid fa-toggle-on"></span></span><span class="prompt_manager_prompt_tokens" data-pm-tokens="114">114</span></li></section><section id="other"><li data-pm-identifier="b" class="completion_prompt_manager_prompt">B</li></section></ul>',{runScripts:'outside-only'});
    const w=dom.window,d=w.document,list=d.querySelector('ul'),row=list.querySelector('[data-pm-identifier="a"]'),fold=d.querySelector('#fold');
    const edit=row.querySelector('.prompt-manager-edit-action'),toggle=row.querySelector('.prompt-manager-toggle-action'),tokens=row.querySelector('.prompt_manager_prompt_tokens');
    let edits=0,toggles=0;
    edit.addEventListener('click',()=>edits++);toggle.addEventListener('click',()=>toggles++);
    const prompts=[{identifier:'a',name:'A',enabled:true},{identifier:'b',name:'B',enabled:false},{identifier:'virtual',name:'Virtual',enabled:true}];
    const manager={configuration:{prefix:'completion_'},getPromptById:id=>prompts.find(p=>p.identifier===id),isPromptEditAllowed:()=>true,isPromptToggleAllowed:()=>true,isPromptDeletionAllowed:()=>true,tokenHandler:{getCounts:()=>({a:114,virtual:345})},handleEdit(event){assert.equal(event.target.closest('[data-pm-identifier]').dataset.pmIdentifier,'virtual');edits++},handleToggle(event){assert.equal(event.target.closest('[data-pm-identifier]').dataset.pmIdentifier,'virtual');toggles++}};
    function jq(){assert.fail('Searching must never access native sorting');}jq.fn={sortable(){}};w.jQuery=jq;
    w.eval(source.replace('export function ','function ')+'\nwindow.makeSearch=createNativePromptSearch;');
    const search=w.makeSearch({getManager:()=>manager,onRefresh(){}}),before=list.outerHTML;
    const observer=new w.MutationObserver(()=>{});observer.observe(list,{subtree:true,attributes:true,childList:true,characterData:true});
    search.filter(list,[prompts[0]],true);
    assert.equal(list.outerHTML,before);assert.equal(list.querySelector('[data-pm-identifier="a"]'),row);assert.equal(row.parentElement,fold);assert.equal(row.querySelector('.prompt-manager-edit-action'),edit);assert.equal(row.querySelector('.prompt-manager-toggle-action'),toggle);assert.equal(row.querySelector('.prompt_manager_prompt_tokens'),tokens);assert.equal(fold.hidden,true);
    const panel=d.querySelector('.bs-pc-search-results');assert.equal(panel.children.length,1);assert.equal(panel.hidden,false);assert.equal(list.contains(panel),false);assert.notEqual(panel.querySelector('[data-pm-identifier="a"]'),row);assert.equal(panel.getAttribute('aria-label'),'当前预设搜索结果');assert.equal(panel.tabIndex,0);
    edit.click();toggle.click();assert.equal(edits,1);assert.equal(toggles,1);
    search.filter(list,[prompts[0],prompts[2]],true);const virtual=panel.querySelector('[data-pm-identifier="virtual"]');assert.equal(panel.children.length,2);assert.equal(virtual.querySelector('.prompt_manager_prompt_tokens').textContent,'345');virtual.querySelector('.prompt-manager-edit-action').click();virtual.querySelector('.prompt-manager-toggle-action').click();assert.equal(edits,2);assert.equal(toggles,2);
    panel.scrollTop=72;search.filter(list,[prompts[0],prompts[2]],true);assert.equal(panel.querySelector('[data-pm-identifier="virtual"]'),virtual);assert.equal(panel.scrollTop,72);assert.equal(observer.takeRecords().length,0);
    // A native rerender supplies this item too. Its search result remains in the
    // panel and the underlying native node is left exactly as supplied.
    const nativeVirtual=d.createElement('li');nativeVirtual.dataset.pmIdentifier='virtual';nativeVirtual.className='completion_prompt_manager_prompt';list.append(nativeVirtual);observer.takeRecords();const afterRender=list.outerHTML;
    search.filter(list,[prompts[2]],true);assert.equal(panel.children.length,1);assert.equal(panel.querySelector('[data-pm-identifier="virtual"]'),virtual);assert.equal(list.outerHTML,afterRender);assert.equal(observer.takeRecords().length,0);
    search.filter(list,[],true);assert.equal(panel.hidden,false);assert.match(panel.textContent,/没有匹配的条目/);assert.equal(list.outerHTML,afterRender);
    search.restore(list);assert.equal(d.querySelector('.bs-pc-search-results'),null);assert.equal(list.outerHTML,afterRender);assert.equal(observer.takeRecords().length,0);
    // A toolbar-owned panel is emptied/hidden rather than removed.
    const supplied=d.createElement('ul');d.body.insertBefore(supplied,list);search.filter(list,[prompts[0]],true,supplied);search.filter(list,[],false,supplied);assert.equal(supplied.isConnected,true);assert.equal(supplied.hidden,true);assert.equal(supplied.children.length,0);assert.equal(observer.takeRecords().length,0);search.destroy();observer.disconnect();
    assert.equal(row.querySelector('.prompt-manager-edit-action'),edit);dom.window.close();
    console.log('PASS: mounted/folded/virtual matches stay in an independent panel, native subtree has zero search mutations, sorting is untouched, original listeners remain, result actions/identity/scroll position work, native rerenders and clear/disable clean up only owned UI.');
})().catch(error=>{console.error(error);process.exitCode=1});
