function nativeElement(tag,className,text) {
    const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
// Filter live PromptManager nodes in place. Their controls, event listeners and
// theme styles belong to ST / the grouping extension and must not be replaced.
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
    function setSorting(list,state,active) {
        const jq=window.jQuery;
        if(!jq?.fn?.sortable||!jq(list).hasClass('ui-sortable'))return;
        try {
            if(active){if(state.sorting===undefined)state.sorting=jq(list).sortable('option','disabled');if(jq(list).sortable('option','disabled')!==true)jq(list).sortable('option','disabled',true);}
            else if(!active&&state.sorting!==undefined)jq(list).sortable('option','disabled',state.sorting);
        }catch{/* Some extensions replace sortable while rendering. */}
    }
    function resetMarks(state) {
        for(const [node,before] of state.hiddenStyles){
            // Only undo our own hiding, retaining newer styles from a renderer.
            if(node.style.getPropertyValue('display')==='none'&&node.style.getPropertyPriority('display')==='important'){
                if(before.value)node.style.setProperty('display',before.value,before.priority);
                else node.style.removeProperty('display');
                if(!before.hadStyle&&!node.getAttribute('style'))node.removeAttribute('style');
            }
        }
        state.hiddenStyles.clear();
        for(const node of state.marked)node.classList.remove('bs-pc-hidden','bs-pc-search-reveal');
        state.marked.clear();
    }
    function hide(node,state){
        state.hiddenStyles.set(node,{value:node.style.getPropertyValue('display'),priority:node.style.getPropertyPriority('display'),hadStyle:node.hasAttribute('style')});
        node.style.setProperty('display','none','important');
    }
    function restore(list) {
        const state=lists.get(list);list.classList.remove('bs-pc-search-list-hidden','bs-pc-filtering');
        if(!state)return;
        resetMarks(state);for(const row of state.fallback.values())row.remove();
        if(state.results){state.results.hidden=true;if(state.ownsResults)state.results.remove();}
        setSorting(list,state,false);lists.delete(list);
    }
    function filter(list,found,active,results) {
        if(!active){restore(list);return;}
        let state=lists.get(list);
        if(!state){state={marked:new Set(),hiddenStyles:new Map(),fallback:new Map(),sorting:undefined,results,ownsResults:!results};lists.set(list,state);}
        resetMarks(state);list.classList.remove('bs-pc-search-list-hidden');list.classList.add('bs-pc-filtering');setSorting(list,state,true);
        const ids=new Set(found.map(prompt=>String(prompt.identifier)));
        const original=[...list.querySelectorAll('[data-pm-identifier]')].filter(row=>row.dataset.bsPcFallback!=='true');
        const mounted=new Set(original.map(row=>row.dataset.pmIdentifier));
        for(const [id,row] of state.fallback)if(!ids.has(id)||mounted.has(id)||!row.isConnected){row.remove();state.fallback.delete(id);}
        for(const prompt of found) {
            const id=String(prompt.identifier);if(mounted.has(id))continue;
            const signature=JSON.stringify([prompt.name,prompt.enabled,getManager()?.tokenHandler?.getCounts?.()?.[id]]);
            let row=state.fallback.get(id);
            if(row?.dataset.bsPcSignature===signature)continue;
            const next=nativeRow(prompt,list);next.dataset.bsPcSignature=signature;
            if(!state.results){state.results=nativeElement('ul','text_pole bs-pc-search-results');anchor(list).before(state.results);}
            if(row)row.replaceWith(next);else state.results.append(next);state.fallback.set(id,next);
        }
        if(state.results)state.results.hidden=!state.fallback.size;
        const ancestors=new Set(),visible=new Set();
        for(const row of original) {
            const match=ids.has(row.dataset.pmIdentifier);
            row.classList.toggle('bs-pc-hidden',!match);state.marked.add(row);
            if(!match)hide(row,state);
            for(let parent=row.parentElement;parent&&parent!==list;parent=parent.parentElement){ancestors.add(parent);if(match)visible.add(parent);}
        }
        // Temporarily reveal matching folded groups. Keep collapse attributes,
        // classes and inline styles intact so clearing restores the prior view.
        for(const container of ancestors){container.classList.toggle('bs-pc-hidden',!visible.has(container));container.classList.toggle('bs-pc-search-reveal',visible.has(container));state.marked.add(container);if(!visible.has(container))hide(container,state);}
        // An empty native list still has a 300px minimum height. When every
        // match is virtual (or there are none), keep that blank list out of view.
        const hasMountedMatch=original.some(row=>ids.has(row.dataset.pmIdentifier));
        list.classList.toggle('bs-pc-search-list-hidden',!hasMountedMatch);
        if(!hasMountedMatch)hide(list,state);
    }
    function destroy(){for(const list of [...lists.keys()])restore(list);}
    return {filter,restore,destroy,anchor};
}
