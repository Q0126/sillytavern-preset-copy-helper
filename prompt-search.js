function nativeElement(tag,className,text) {
    const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
// Render search matches in our own panel. The original preset list, grouping,
// collapse state, styling and sorting are never changed by a search. Only an
// explicit Locate action may open the target's group and highlight its row.
export function createNativePromptSearch({getManager,onRefresh,getPresetName=()=>getManager()?.serviceSettings?.preset_settings_openai,getGroupState=()=>getManager()?.serviceSettings?.extensions?.baibaiToolkit?.presetPromptGroups}) {
    const lists=new Map();
    const pending=new Set();
    const rowParts=new WeakMap();
    let locateVersion=0,locateState=null,cancelLocate=null,highlight=null,highlightTimer;
    function clearHighlight(){
        window.clearTimeout(highlightTimer);
        if(highlight){const {row,tabindex}=highlight;row.classList.remove('bs-pc-locate-highlight');if(row.getAttribute('tabindex')==='-1'){if(tabindex===null)row.removeAttribute('tabindex');else row.setAttribute('tabindex',tabindex);}highlight=null;}
    }
    function stopLocate(){locateVersion++;cancelLocate?.();cancelLocate=null;locateState=null;clearHighlight();}
    function nativeTarget(state,id){return [...state.list.querySelectorAll('[data-pm-identifier]')].find(row=>row.dataset.pmIdentifier===id&&row.dataset.bsPcFallback!=='true'&&row.dataset.presetFavoriteMirror!=='true');}
    function visibleTarget(state,row){
        for(let node=row;node&&node!==state.list.parentElement;node=node.parentElement)if(node.hidden||node.tagName==='DETAILS'&&!node.open||node.classList.contains('bai-bai-preset-group-collapsed')||node.getAttribute('aria-hidden')==='true'||window.getComputedStyle(node).display==='none')return false;
        return true;
    }
    function waitForTarget(state,id,valid){return new Promise(resolve=>{
        let finished=false,timer;
        const finish=row=>{if(finished)return;finished=true;observer.disconnect();window.clearTimeout(timer);if(cancelLocate===cancel)cancelLocate=null;resolve(row);};
        const check=()=>{if(!valid())return finish();const row=nativeTarget(state,id);if(row&&visibleTarget(state,row))finish(row);};
        const cancel=()=>finish(),observer=new MutationObserver(check);cancelLocate=cancel;
        observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','open','aria-hidden','style']});timer=window.setTimeout(()=>finish(),1400);check();
    });}
    async function locate(id,source,button){
        const state=[...lists.values()].find(item=>item.results.contains(source));if(!state)return;
        stopLocate();const version=locateVersion,presetName=getPresetName();locateState=state;
        const valid=()=>version===locateVersion&&state.active&&lists.get(state.list)===state&&source.isConnected&&getPresetName()===presetName;
        button.disabled=true;button.textContent='…';let expanded=false;
        try{
            let row=nativeTarget(state,id);
            if(!row){
                const groupId=getGroupState()?.prompts?.[id]?.groupId;
                const group=[...state.list.querySelectorAll('.bai-bai-preset-group[data-preset-group-id]')].find(item=>item.dataset.presetGroupId===String(groupId));
                if(group?.classList.contains('bai-bai-preset-group-collapsed')){group.querySelector('.bai-bai-preset-group-toggle')?.click();expanded=true;}
            }else{
                const parents=[];for(let node=row.parentElement;node&&node!==state.list;node=node.parentElement)parents.unshift(node);
                for(const node of parents){
                    if(node.tagName==='DETAILS'&&!node.open){node.open=true;expanded=true;}
                    else if(node.classList.contains('bai-bai-preset-group-collapsed')){node.querySelector('.bai-bai-preset-group-toggle')?.click();expanded=true;}
                    else if(node.hidden&&node.id){const control=[...state.list.querySelectorAll('[aria-controls]')].find(item=>item.getAttribute('aria-controls')===node.id&&item.getAttribute('aria-expanded')==='false');if(control){control.click();expanded=true;}}
                }
            }
            row=await waitForTarget(state,id,valid);
            // BaiBai's native group expansion animates for 180ms. Let the row
            // settle before asking the browser to center it in the real list.
            if(row&&expanded)await new Promise(resolve=>window.setTimeout(resolve,200));
            if(!valid())return;
            row=nativeTarget(state,id);
            if(!row||!visibleTarget(state,row)){button.title='原条目可能被其他筛选隐藏，请展开相关分组后重试。';globalThis.toastr?.info?.(button.title);return;}
            clearHighlight();highlight={row,tabindex:row.getAttribute('tabindex')};row.classList.add('bs-pc-locate-highlight');row.tabIndex=-1;row.focus({preventScroll:true});
            row.scrollIntoView?.({block:'center',inline:'nearest',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
            highlightTimer=window.setTimeout(clearHighlight,1800);
        }finally{button.disabled=false;button.textContent='定位';if(locateState===state&&version===locateVersion)locateState=null;}
    }
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
        const locateButton=nativeElement('button','bs-pc-locate','定位');locateButton.type='button';locateButton.title='在原预设列表中定位';locateButton.setAttribute('aria-label',`定位 ${prompt.name||'未命名条目'}`);
        locateButton.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void locate(String(prompt.identifier),row,locateButton).catch(error=>globalThis.toastr?.error?.(error.message));});row.append(locateButton);
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
        rowParts.set(row,{name,label,tokens,locateButton,edit:controls.querySelector('.prompt-manager-edit-action'),toggle:controls.querySelector('.prompt-manager-toggle-action'),disabledClass:`${prefix}prompt_manager_prompt_disabled`});
        return row;
    }
    function restore(list) {
        const state=lists.get(list);if(!state)return;
        if(locateState===state)stopLocate();
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
                if(parts.label.textContent!==name){parts.label.textContent=name;parts.label.title=prompt.name||'';parts.name.dataset.pmName=prompt.name||'';parts.locateButton.setAttribute('aria-label',`定位 ${name}`);parts.edit?.setAttribute('aria-label',`编辑 ${name}`);parts.toggle?.setAttribute('aria-label',`切换 ${name}`);}
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
    function destroy(){stopLocate();for(const list of [...lists.keys()])restore(list);}
    return {filter,restore,destroy,anchor,rebind};
}
