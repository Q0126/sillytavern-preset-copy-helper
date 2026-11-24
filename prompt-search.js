function nativeElement(tag,className,text) {
    const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
// Render search matches in our own panel. The original preset list, grouping,
// collapse state, styling and sorting are never changed by a search.
export function createNativePromptSearch({getManager,onRefresh}) {
    const lists=new Map();
    const pending=new Set();
    // BaiBai owns this entire Vue mount, including the list's siblings. Keep
    // plugin UI outside it; Sortable/Vue must see only their own child nodes.
    const anchor=list=>{
        const host=list.closest('.bai-bai-preset-vue-list-host,[data-v-app]');
        return !host||host===document.body||host===document.documentElement ? list : host;
    };
    function bind(action,handler) {
        action.setAttribute('role','button');action.tabIndex=0;
        action.addEventListener('click',handler);
        action.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();action.click();}});
    }
    function nativeRow(prompt,list) {
        const manager=getManager(),prefix=manager?.configuration?.prefix ?? list.id.replace(/prompt_manager_list$/u,'');
        const row=nativeElement('li',`${prefix}prompt_manager_prompt ${prefix}prompt_manager_prompt_draggable${prompt.enabled?'':` ${prefix}prompt_manager_prompt_disabled`}${prompt.marker?` ${prefix}prompt_manager_marker`:''}`);
        row.classList.add('bs-pc-result');
        row.dataset.pmIdentifier=prompt.identifier;row.dataset.bsPcFallback='true';
        const drag=nativeElement('span','drag-handle','☰');drag.setAttribute('aria-hidden','true');row.append(drag);
        const name=nativeElement('span',`${prefix}prompt_manager_prompt_name`);name.dataset.pmName=prompt.name||'';
        name.classList.add('bs-pc-result-name');
        const label=nativeElement('a','prompt-manager-inspect-action',prompt.name||'未命名条目');label.title=prompt.name||'';
        bind(label,event=>getManager()?.handleInspect?.(event));name.append(label);row.append(name);
        const outer=nativeElement('span','bs-pc-result-actions'),controls=nativeElement('span','prompt_manager_prompt_controls');
        if(manager?.isPromptDeletionAllowed?.(prompt)) {
            const detach=nativeElement('span','prompt-manager-detach-action caution fa-solid fa-chain-broken fa-xs');detach.title='移除';
            bind(detach,event=>getManager()?.handleDetach?.(event));controls.append(detach);
        }else controls.append(nativeElement('span','fa-solid'));
        if(manager?.isPromptEditAllowed?.(prompt)!==false) {
            const edit=nativeElement('span','prompt-manager-edit-action fa-solid fa-pencil fa-xs');edit.title='编辑';edit.setAttribute('aria-label',`编辑 ${prompt.name||'未命名条目'}`);
            bind(edit,event=>{
                const current=getManager();
                if(typeof current?.handleEdit==='function')return current.handleEdit(event);
                const data=current?.getPromptById?.(prompt.identifier);if(!data)return;
                current.clearEditForm?.();current.clearInspectForm?.();current.loadPromptIntoEditForm?.(data);current.showPopup?.();
            });controls.append(edit);
        }else controls.append(nativeElement('span','fa-solid'));
        if(manager?.isPromptToggleAllowed?.(prompt)!==false) {
            const toggle=nativeElement('span',`prompt-manager-toggle-action fa-solid ${prompt.enabled?'fa-toggle-on':'fa-toggle-off'}`);toggle.title='切换开关';toggle.setAttribute('aria-label',`切换 ${prompt.name||'未命名条目'}`);
            toggle.setAttribute('aria-pressed',String(!!prompt.enabled));
            bind(toggle,async event=>{
                const current=getManager();
                if(typeof current?.handleToggle==='function')return current.handleToggle(event);
                // Compatibility fallback for branches without the native click handler.
                const data=current?.getPromptById?.(prompt.identifier);
                const order=current?.getPromptOrderForCharacter?.(current.activeCharacter);
                const entry=order?.find(item=>item.identifier===prompt.identifier);
                if(!entry||!data||current.isPromptToggleAllowed?.(data)===false||pending.has(prompt.identifier))return;
                const before=entry.enabled;pending.add(prompt.identifier);entry.enabled=!before;
                try {await current.saveServiceSettings();}
                catch(error){entry.enabled=before;globalThis.toastr?.error?.(error.message);}
                finally{pending.delete(prompt.identifier);current.render(false);onRefresh();}
            });controls.append(toggle);
        }else controls.append(nativeElement('span','fa-solid'));
        outer.append(controls);row.append(outer);
        const value=manager?.tokenHandler?.getCounts?.()?.[prompt.identifier] ?? '-';
        const tokens=nativeElement('span','prompt_manager_prompt_tokens bs-pc-result-tokens',String(value));tokens.dataset.pmTokens=String(value);row.append(tokens);
        return row;
    }
    function restore(list) {
        const state=lists.get(list);if(!state)return;
        state.results.replaceChildren();state.results.hidden=true;
        if(state.ownsResults)state.results.remove();
        lists.delete(list);
    }
    function filter(list,found,active,results) {
        if(!active){restore(list);return;}
        let state=lists.get(list);
        if(state&&results&&state.results!==results){restore(list);state=null;}
        if(!state){
            const ownsResults=!results;
            if(!results){results=nativeElement('ul','text_pole bs-pc-search-results');anchor(list).before(results);}
            results.setAttribute('aria-label','当前预设搜索结果');results.tabIndex=0;
            state={fallback:new Map(),results,ownsResults};lists.set(list,state);
        }
        const ids=new Set(found.map(prompt=>String(prompt.identifier)));
        for(const [id,row] of state.fallback)if(!ids.has(id)){row.remove();state.fallback.delete(id);}
        state.results.querySelector('.bs-pc-search-empty')?.remove();
        const scrollTop=state.results.scrollTop;
        const manager=getManager();
        for(const [index,prompt] of found.entries()) {
            const id=String(prompt.identifier);
            const signature=JSON.stringify([prompt.name,prompt.enabled,prompt.marker,manager?.tokenHandler?.getCounts?.()?.[id],manager?.isPromptDeletionAllowed?.(prompt),manager?.isPromptEditAllowed?.(prompt),manager?.isPromptToggleAllowed?.(prompt)]);
            let row=state.fallback.get(id);
            if(row?.dataset.bsPcSignature!==signature){
                const next=nativeRow(prompt,list);next.dataset.bsPcSignature=signature;
                if(row)row.replaceWith(next);state.fallback.set(id,next);row=next;
            }
            if(state.results.children[index]!==row)state.results.insertBefore(row,state.results.children[index]??null);
        }
        if(!found.length)state.results.append(nativeElement('li','bs-pc-search-empty','没有匹配的条目'));
        state.results.hidden=false;state.results.scrollTop=scrollTop;
    }
    function destroy(){for(const list of [...lists.keys()])restore(list);}
    return {filter,restore,destroy,anchor};
}
