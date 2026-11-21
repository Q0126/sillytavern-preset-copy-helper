const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../prompt-search.js'),'utf8');
(async()=>{
    const dom=new JSDOM('<ul id="completion_prompt_manager_list"><section id="fold" class="theme-group" hidden style="display:none;max-height:0"><li data-pm-identifier="a" class="completion_prompt_manager_prompt theme-row"><span class="completion_prompt_manager_prompt_name" data-pm-name="A">A</span><span class="prompt_manager_prompt_controls"><span class="prompt-manager-edit-action fa-solid fa-pencil"></span><span class="prompt-manager-toggle-action fa-solid fa-toggle-on"></span></span><span class="prompt_manager_prompt_tokens" data-pm-tokens="114">114</span></li></section><section id="other"><li data-pm-identifier="b" class="completion_prompt_manager_prompt">B</li></section></ul>',{runScripts:'outside-only'});
    const w=dom.window,d=w.document,list=d.querySelector('ul'),row=d.querySelector('[data-pm-identifier="a"]'),fold=d.querySelector('#fold');
    const edit=row.querySelector('.prompt-manager-edit-action'),toggle=row.querySelector('.prompt-manager-toggle-action'),tokens=row.querySelector('.prompt_manager_prompt_tokens');
    let edits=0,toggles=0,sortDisabled=false;
    edit.addEventListener('click',()=>edits++);toggle.addEventListener('click',()=>toggles++);
    const prompts=[{identifier:'a',name:'A',enabled:true},{identifier:'b',name:'B',enabled:false},{identifier:'virtual',name:'Virtual',enabled:true}];
    const manager={configuration:{prefix:'completion_'},getPromptById:id=>prompts.find(p=>p.identifier===id),isPromptEditAllowed:()=>true,isPromptToggleAllowed:()=>true,isPromptDeletionAllowed:()=>true,tokenHandler:{getCounts:()=>({virtual:345})},handleEdit(event){assert.equal(event.target.closest('[data-pm-identifier]').dataset.pmIdentifier,'virtual');edits++},handleToggle(event){assert.equal(event.target.closest('[data-pm-identifier]').dataset.pmIdentifier,'virtual');toggles++}};
    function jq(){return {hasClass:()=>true,sortable(...args){if(args.length===2)return sortDisabled;sortDisabled=args[2]}}}jq.fn={sortable(){}};w.jQuery=jq;
    w.eval(source.replace('export function ','function ')+'\nwindow.makeSearch=createNativePromptSearch;');
    const search=w.makeSearch({getManager:()=>manager,onRefresh(){}});
    search.filter(list,[prompts[0]],true);
    assert.equal(d.querySelector('[data-pm-identifier="a"]'),row);assert.equal(row.parentElement,fold);assert.equal(row.querySelector('.prompt-manager-edit-action'),edit);assert.equal(row.querySelector('.prompt-manager-toggle-action'),toggle);assert.equal(row.querySelector('.prompt_manager_prompt_tokens'),tokens);
    assert.equal(tokens.textContent,'114');assert.equal(row.classList.contains('theme-row'),true);assert.equal(fold.hidden,true);assert.equal(fold.style.display,'none');assert.equal(fold.classList.contains('bs-pc-search-reveal'),true);assert.equal(d.querySelector('#other').classList.contains('bs-pc-hidden'),true);assert.equal(sortDisabled,true);
    edit.click();toggle.click();assert.equal(edits,1);assert.equal(toggles,1);assert.equal(d.querySelectorAll('input[type="checkbox"]').length,0);
    search.filter(list,[prompts[0],prompts[2]],true);let fallback=d.querySelector('[data-bs-pc-fallback]');assert.equal(fallback.parentElement,list);assert.equal(fallback.classList.contains('completion_prompt_manager_prompt'),true);assert.equal(fallback.querySelector('.prompt_manager_prompt_tokens').textContent,'345');assert.equal(fallback.querySelector('.prompt-manager-toggle-action').classList.contains('fa-toggle-on'),true);
    fallback.querySelector('.prompt-manager-edit-action').click();fallback.querySelector('.prompt-manager-toggle-action').click();assert.equal(edits,2);assert.equal(toggles,2);
    search.filter(list,[prompts[0],prompts[2]],true);assert.equal(d.querySelector('[data-bs-pc-fallback]'),fallback);
    // A native render supplies a real row for a previously virtual item.
    const nativeVirtual=d.createElement('li');nativeVirtual.dataset.pmIdentifier='virtual';nativeVirtual.className='completion_prompt_manager_prompt';list.append(nativeVirtual);search.filter(list,[prompts[2]],true);assert.equal(d.querySelector('[data-bs-pc-fallback]'),null);assert.equal(nativeVirtual.classList.contains('bs-pc-hidden'),false);
    search.restore(list);assert.equal(sortDisabled,false);assert.equal(fold.hidden,true);assert.equal(fold.style.display,'none');assert.equal(fold.style.maxHeight,'0px');assert.equal(fold.className,'theme-group');assert.equal(row.className,'completion_prompt_manager_prompt theme-row');assert.equal(list.classList.contains('bs-pc-filtering'),false);
    search.filter(list,[],true);assert.equal(row.classList.contains('bs-pc-hidden'),true);search.destroy();assert.equal(row.classList.contains('bs-pc-hidden'),false);assert.equal(row.querySelector('.prompt-manager-edit-action'),edit);
    dom.window.close();console.log('PASS: original row/control identity, native listeners and Token preserved; folded-group reveal/restoration; sorting lock; native-style virtual-row fallback and replacement; zero-match and destroy cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1});
