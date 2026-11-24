const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const dom=new JSDOM('<div id="completion_prompt_manager"><div class="bai-bai-preset-vue-list-host" data-v-app><ul id="completion_prompt_manager_list"><section id="fold" hidden style="display:none;max-height:0"><li class="completion_prompt_manager_prompt" data-pm-identifier="mounted-match">心理描写</li></section><section id="miss-group"><li class="completion_prompt_manager_prompt" data-pm-identifier="miss" style="display:grid!important;color:red">无关条目</li></section></ul></div></div>',{runScripts:'outside-only'});
const w=dom.window,d=w.document,list=d.querySelector('ul'),host=list.parentElement,miss=d.querySelector('[data-pm-identifier=miss]'),group=d.querySelector('#miss-group'),fold=d.querySelector('#fold');
// Native CSS is scoped to the original ID; fallback rows must supply their own
// layout. A late grouping stylesheet also forces native rows to display:grid.
const style=d.createElement('style');style.textContent=':root{--mainFontSize:16px;--SmartThemeQuoteColor:rgb(40, 110, 155);--SmartThemeBorderColor:rgb(150,150,150)}\n'+read('style.css')+'\n#completion_prompt_manager #completion_prompt_manager_list{display:flex!important;min-height:300px} #completion_prompt_manager #completion_prompt_manager_list li.completion_prompt_manager_prompt{display:grid!important;grid-template-columns:4fr 80px 45px;padding:.5em}';d.head.append(style);
const enabled={identifier:'virtual-enabled',name:'心理测评与很长很长的角色条目名称',enabled:true},disabled={identifier:'virtual-disabled',name:'心理方案二',enabled:false};
let edits=0,toggles=0;
const manager={configuration:{prefix:'completion_'},tokenHandler:{getCounts:()=>({'virtual-enabled':0,'virtual-disabled':12345})},isPromptDeletionAllowed:()=>true,handleEdit(){edits++},handleToggle(){toggles++}};
w.eval(read('prompt-search.js').replace('export function ','function ')+'\nwindow.makeSearch=createNativePromptSearch;');
const search=w.makeSearch({getManager:()=>manager,onRefresh(){}}),before=miss.style.cssText,hostChildren=[...host.childNodes];
search.filter(list,[enabled,disabled],true);
assert.equal(w.getComputedStyle(miss).display,'none');assert.equal(miss.style.getPropertyPriority('display'),'important');assert.equal(w.getComputedStyle(group).display,'none');assert.equal(w.getComputedStyle(list).display,'none');
assert.equal(host.querySelector('.bs-pc-search-results'),null);assert.deepEqual([...host.childNodes],hostChildren);assert.equal(d.querySelectorAll('#completion_prompt_manager_list').length,1);
const rows=[...d.querySelectorAll('.bs-pc-result')];assert.equal(rows.length,2);
for(const row of rows){
    const computed=w.getComputedStyle(row);assert.equal(computed.display,'grid');assert.match(computed.gridTemplateColumns,/^18px minmax\(0(?:px)?,\s*1fr\) 80px 45px$/);assert.equal(computed.minHeight,'40px');assert.equal(computed.marginBottom,'8px');
    assert.equal(w.getComputedStyle(row.querySelector('.prompt_manager_prompt_controls')).display,'flex');assert.equal(w.getComputedStyle(row.querySelector('.bs-pc-result-name')).whiteSpace,'normal');assert.equal(w.getComputedStyle(row.querySelector('.bs-pc-result-tokens')).textAlign,'right');
    assert.ok(row.querySelector('.fa-pencil'));assert.ok(row.querySelector('.prompt-manager-toggle-action'));
}
assert.equal(rows[0].querySelector('.bs-pc-result-tokens').textContent,'0');assert.equal(rows[1].querySelector('.bs-pc-result-tokens').textContent,'12345');assert.equal(rows[0].querySelector('.prompt-manager-toggle-action').getAttribute('aria-pressed'),'true');assert.equal(rows[1].querySelector('.prompt-manager-toggle-action').getAttribute('aria-pressed'),'false');
rows[0].querySelector('.fa-pencil').click();rows[1].querySelector('.prompt-manager-toggle-action').click();assert.equal(edits,1);assert.equal(toggles,1);
// Mixed matches preserve native controls/parents and remove no-longer-matching
// fallback rows; the hidden native list is restored as soon as it has a match.
search.filter(list,[{identifier:'mounted-match'},enabled],true);assert.notEqual(w.getComputedStyle(list).display,'none');assert.equal(d.querySelectorAll('.bs-pc-result').length,1);assert.equal(d.querySelector('[data-pm-identifier="mounted-match"]').parentElement,fold);assert.equal(fold.hidden,true);assert.equal(fold.style.display,'none');
search.filter(list,[],true);assert.equal(w.getComputedStyle(list).display,'none');assert.equal(d.querySelectorAll('.bs-pc-result').length,0);
search.restore(list);assert.equal(miss.style.cssText,before);assert.equal(group.hasAttribute('style'),false);assert.equal(list.hasAttribute('style'),false);assert.equal(fold.style.display,'none');assert.equal(fold.style.getPropertyPriority('display'),'');assert.equal(fold.style.maxHeight,'0px');assert.equal(d.querySelector('.bs-pc-search-results'),null);assert.equal(list.classList.contains('bs-pc-search-list-hidden'),false);
// Do not revert a newer inline style authored by the grouping renderer.
search.filter(list,[enabled],true);miss.style.setProperty('display','flex');search.destroy();assert.equal(miss.style.display,'flex');assert.equal(list.hasAttribute('style'),false);assert.deepEqual([...host.childNodes],hostChildren);
w.close();console.log('PASS: externally mounted virtual results retain four-column native-style rows, edit/toggle/Token controls and 0 counts; unmatched native rows stay hidden against late important grid rules, empty-list whitespace disappears, native styles/parents and new renderer writes survive cleanup.');
