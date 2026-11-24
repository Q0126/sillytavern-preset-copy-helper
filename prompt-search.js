function nativeElement(tag,className,text) {
    const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
// Render search matches in our own panel. The original preset list, grouping,
// collapse state, styling and sorting are never changed by a search.
export function createNativePromptSearch({getManager,onRefresh}) {
    const lists=new Map();
    const pending=new Set();
    const rowParts=new WeakMap();
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
        rowParts.set(row,{name,label,tokens,edit:controls.querySelector('.prompt-manager-edit-action'),toggle:controls.querySelector('.prompt-manager-toggle-action'),disabledClass:`${prefix}prompt_manager_prompt_disabled`});
        return row;
    }
    function restore(list) {
        const state=lists.get(list);if(!state)return;
        state.active=false;state.frame?.cancel();
        state.results.replaceChildren();state.results.hidden=true;
        if(state.ownsResults)state.results.remove();
        lists.delete(list);
    }
    function filter(list,found,active,results,reset=false) {
        if(!active){restore(list);return;}
        let state=lists.get(list);
        if(state&&results&&state.results!==results){restore(list);state=null;}
        if(!state){
            const ownsResults=!results;
            if(!results){results=nativeElement('ul','text_pole bs-pc-search-results');anchor(list).before(results);}
            results.setAttribute('aria-label','当前预设搜索结果');results.tabIndex=0;
            state={fallback:new Map(),results,ownsResults,list,active:true,limit:40,frame:null};lists.set(list,state);
        }
        state.found=found;state.limit=Math.min(reset?40:Math.max(state.limit,40),found.length);
        renderRows(state);scheduleRows(state);
    }
    function scheduleRows(state){
        if(state.frame||state.limit>=state.found.length)return;
        const callback=()=>{state.frame=null;if(!state.active||!state.results.isConnected)return;state.limit=Math.min(state.limit+32,state.found.length);renderRows(state);scheduleRows(state);};
        if(typeof window.requestAnimationFrame==='function'){
            const id=window.requestAnimationFrame(callback);state.frame={cancel:()=>window.cancelAnimationFrame?.(id)};
        }else {const id=window.setTimeout(callback,16);state.frame={cancel:()=>window.clearTimeout(id)};}
    }
    function renderRows(state){
        const {list}=state,found=state.found.slice(0,state.limit),ids=new Set(found.map(prompt=>String(prompt.identifier)));
        for(const [id,row] of state.fallback)if(!ids.has(id)){row.remove();state.fallback.delete(id);}
        if(found.length)state.results.querySelector('.bs-pc-search-empty')?.remove();
        const manager=getManager();
        const counts=manager?.tokenHandler?.getCounts?.()??{};
        for(const [index,prompt] of found.entries()) {
            const id=String(prompt.identifier);
            const capabilities=JSON.stringify([prompt.marker,manager?.isPromptDeletionAllowed?.(prompt),manager?.isPromptEditAllowed?.(prompt),manager?.isPromptToggleAllowed?.(prompt)]);
            const signature=JSON.stringify([prompt.name,prompt.enabled,counts[id],capabilities]);
            let row=state.fallback.get(id);
            if(!row||row.dataset.bsPcCapabilities!==capabilities){
                const next=nativeRow(prompt,list);next.dataset.bsPcCapabilities=capabilities;
                if(row)row.replaceWith(next);state.fallback.set(id,next);row=next;
            }
            if(row.dataset.bsPcSignature!==signature){
                const parts=rowParts.get(row),name=prompt.name||'未命名条目',value=String(counts[id]??'-');
                if(parts.label.textContent!==name){parts.label.textContent=name;parts.label.title=prompt.name||'';parts.name.dataset.pmName=prompt.name||'';parts.edit?.setAttribute('aria-label',`编辑 ${name}`);parts.toggle?.setAttribute('aria-label',`切换 ${name}`);}
                if(parts.tokens.textContent!==value){parts.tokens.textContent=value;parts.tokens.dataset.pmTokens=value;}
                row.classList.toggle(parts.disabledClass,!prompt.enabled);
                if(parts.toggle){parts.toggle.classList.toggle('fa-toggle-on',!!prompt.enabled);parts.toggle.classList.toggle('fa-toggle-off',!prompt.enabled);parts.toggle.setAttribute('aria-pressed',String(!!prompt.enabled));}
                row.dataset.bsPcSignature=signature;
            }
            if(state.results.children[index]!==row)state.results.insertBefore(row,state.results.children[index]??null);
        }
        if(!found.length&&!state.results.querySelector('.bs-pc-search-empty'))state.results.append(nativeElement('li','bs-pc-search-empty','没有匹配的条目'));
        state.results.hidden=false;
    }
    // Native renderers can replace their list after token counting. Our panel
    // belongs to the preset, so keep it and its momentum rather than rebuilding.
    function rebind(before,after){const state=lists.get(before);if(state){lists.delete(before);state.list=after;lists.set(after,state);}}
    function destroy(){for(const list of [...lists.keys()])restore(list);}
    return {filter,restore,destroy,anchor,rebind};
}
