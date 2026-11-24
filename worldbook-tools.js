import { renamePlan } from './preset-tools.js?v=1.7.5';

const node=(tag,props={},text)=>{const el=Object.assign(document.createElement(tag),props);if(text!==undefined)el.textContent=text;return el;};
const action=(text,run)=>{const el=node('button',{type:'button',className:'menu_button'},text);el.addEventListener('click',run);return el;};
const norm=value=>String(value??'').normalize('NFKC').toLocaleLowerCase();
const fileName=avatar=>String(avatar??'').replace(/\.[^/.]+$/u,'');
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const signature=value=>JSON.stringify(canonical(JSON.parse(JSON.stringify(value))));

// Show actual primary/auxiliary bindings, never infer ownership from a book name.
export function worldbookOwners(characters=[],charLore=[]) {
    charLore=Array.isArray(charLore)?charLore:[];
    const result=new Map(),extrasByFile=new Map();
    for(const item of charLore)if(item&&!extrasByFile.has(item.name))extrasByFile.set(item.name,item.extraBooks);
    const add=(book,character,id,kind)=>{
        if(typeof book!=='string'||!book)return;
        if(!result.has(book))result.set(book,[]);
        const owners=result.get(book);
        if(!owners.some(owner=>owner.id===String(id)&&owner.kind===kind))owners.push({id:String(id),avatar:character.avatar,name:character.name||character.data?.name||fileName(character.avatar)||'未命名角色',kind});
    };
    for(const [id,character] of Object.entries(characters??{})) {
        if(!character)continue;
        add(character.data?.extensions?.world,character,id,'主');
        const extra=extrasByFile.get(fileName(character.avatar));
        for(const book of Array.isArray(extra)?extra:[])add(book,character,id,'附加');
    }
    return result;
}

export function editWorldbookEntries(data,selected,drafts,operation,snapshot) {
    const next=clone(data);
    for(const id of selected) {
        if(!next.entries?.[id])throw new Error(`条目 ${id} 已不存在，请重新打开条目管理。`);
        if(snapshot&&signature(data.entries[id])!==signature(snapshot.entries?.[id]??null))throw new Error(`条目 ${id} 已在其他地方修改，请重新打开条目管理。`);
    }
    for(const id of selected) {
        const entry=next.entries[id],original=next.originalData?.entries?.find(item=>String(item.uid)===String(entry.uid??id));
        if(operation==='delete') {
            delete next.entries[id];
            if(Array.isArray(next.originalData?.entries))next.originalData.entries=next.originalData.entries.filter(item=>String(item.uid)!==String(entry.uid??id));
        } else if(operation==='rename') {
            const name=String(drafts.get(id)??entry.comment??'').trim();if(!name)throw new Error('条目名称不能为空。');
            entry.comment=name;if(original)original.comment=name;
        } else if(operation==='enable'||operation==='disable') {
            entry.disable=operation==='disable';if(original)original.enabled=!entry.disable;
        } else throw new Error('不支持的批量操作。');
    }
    return next;
}

export function createWorldbookTools({context,settings,onRefresh}) {
    let wi,destroyed=false,modal=null,owners=new Map(),activationPanel=null;
    const mounts=new Map();
    const ctx=()=>window.SillyTavern?.getContext?.()??context;
    const ready=import('../../../world-info.js').then(module=>{wi=module;if(!destroyed)onRefresh();}).catch(error=>console.warn('[白水世界书工具]',error));
    const names=()=>Array.isArray(wi?.world_names)?wi.world_names:[];
    const label=name=>{
        const linked=owners.get(name)??[];
        const text=linked.length ? linked.map(owner=>`${owner.name}（${owner.kind}）`).join('、') : '未关联角色';
        return `${wi?.selected_world_info?.includes(name)?'全局启用 · ':''}${text}`;
    };
    const notify=error=>globalThis.toastr?.error?.(error.message);
    async function post(url,body) {
        if(typeof ctx().getRequestHeaders!=='function')throw new Error('当前酒馆未提供保存接口。');
        const response=await fetch(url,{method:'POST',headers:ctx().getRequestHeaders(),body:JSON.stringify(body),cache:'no-cache'});
        if(!response.ok)throw new Error(`服务器操作失败（${response.status}）。`);return response;
    }
    async function persist(name,data) {
        if(typeof ctx().getRequestHeaders!=='function')throw new Error('当前酒馆未提供保存接口。');
        const previous=wi.worldInfoCache?.get(name);
        try {
            // Native save cancels pending debounced writes and notifies other
            // editors. Some ST versions ignore edit HTTP failures, so read back
            // before reporting success or deleting the source of a rename.
            await wi.saveWorldInfo(name,clone(data),true);
            const saved=await (await post('/api/worldinfo/get',{name})).json();
            if(signature(saved)!==signature(data))throw new Error('服务器未保存预期内容，已停止后续操作。');
            // ST returns an empty dummy book for a missing file; an empty
            // rename copy also needs an existence check before source deletion.
            if(!names().includes(name)){const listed=await (await post('/api/settings/get',{})).json();if(!listed.world_names?.includes(name))throw new Error('服务器未创建世界书，原文件不会删除。');}
        }catch(error){if(previous!==undefined)wi.worldInfoCache?.set(name,previous);else wi.worldInfoCache?.delete(name);wi.reloadEditor?.(name);throw error;}
    }
    async function retarget(oldName,newName) {
        const current=ctx();
        if(typeof current.saveSettingsDebounced!=='function')throw new Error('当前酒馆未提供绑定设置保存接口。');
        if(current.chatMetadata?.[wi.METADATA_KEY??'world_info']===oldName&&typeof current.saveMetadata!=='function')throw new Error('当前酒馆未提供聊天绑定保存接口。');
        for(const [id,character] of Object.entries(current.characters??[])) {
            if(character?.data?.extensions?.world!==oldName)continue;
            await post('/api/characters/merge-attributes',{avatar:character.avatar,data:{extensions:{world:newName??''}}});
            character.data.extensions.world=newName??'';
            if(character.json_data){try{const json=JSON.parse(character.json_data);json.data??={};json.data.extensions??={};json.data.extensions.world=newName??'';character.json_data=JSON.stringify(json);}catch{/* Retain an unreadable original JSON string. */}}
            if(String(current.characterId)===String(id)){
                const field=document.querySelector('#character_world');
                if(field){if(field instanceof HTMLSelectElement&&newName&&![...field.options].some(option=>option.value===newName))field.append(node('option',{value:newName},newName));field.value=newName??'';}
                const jsonField=document.querySelector('#character_json_data');if(jsonField&&character.json_data)jsonField.value=character.json_data;
            }
        }
        const lore=wi.world_info?.charLore;
        if(Array.isArray(lore))for(const item of lore)if(Array.isArray(item.extraBooks))item.extraBooks=[...new Set(item.extraBooks.flatMap(book=>book===oldName?(newName?[newName]:[]):[book]))];
        const globals=wi.selected_world_info;
        if(Array.isArray(globals)){const updated=[...new Set(globals.flatMap(book=>book===oldName?(newName?[newName]:[]):[book]))];globals.splice(0,globals.length,...updated);}
        const power=current.powerUserSettings;
        if(power){if(power.persona_description_lorebook===oldName){power.persona_description_lorebook=newName??'';document.querySelector('#persona_lore_button')?.classList.toggle('world_set',!!newName);}for(const descriptor of Object.values(power.persona_descriptions??{}))if(descriptor?.lorebook===oldName)descriptor.lorebook=newName??'';}
        const key=wi.METADATA_KEY??'world_info';
        if(current.chatMetadata?.[key]===oldName){if(newName)current.chatMetadata[key]=newName;else delete current.chatMetadata[key];await current.saveMetadata?.();}
        current.saveSettingsDebounced?.();wi.setWorldInfoButtonClass?.(current.characterId);
    }
    async function changeBook(oldName,newName) {
        if(!names().includes(oldName))throw new Error(`世界书已发生变化：${oldName}`);
        if(newName){
            if(names().some(name=>norm(name)===norm(newName)))throw new Error(`名称已存在：${newName}`);
            const data=await wi.loadWorldInfo(oldName);if(!data?.entries)throw new Error(`无法读取世界书：${oldName}`);
            await persist(newName,data);await wi.updateWorldInfoList();
        }
        // The source remains available if any character update fails. A saved
        // rename copy is deliberately retained, along with successful relinks.
        try {await retarget(oldName,newName);}
        catch(error){throw new Error(`${error.message} 原世界书保留${newName?'，新副本及已更新的绑定也保留':''}，请检查后继续。`);}
        try {
            const deleted=await wi.deleteWorldInfo(oldName);
            if(deleted!==true&&(deleted===false||names().includes(oldName)))throw new Error('服务器未能删除原文件。');
        }catch(error){throw new Error(`${error.message} 绑定已处理，请刷新检查原文件${newName?'及新副本':''}，再继续操作。`);}
        const current=ctx(),type=current.eventTypes?.WORLDINFO_SETTINGS_UPDATED??current.event_types?.WORLDINFO_SETTINGS_UPDATED;
        if(type){try{await current.eventSource?.emit?.(type);}catch(error){console.warn('[白水世界书工具] 绑定已保存，但界面通知失败',error);}}
        return newName;
    }
    function refresh() {
        if(destroyed)return;
        const nextPanel=document.querySelector('#wiActivationSettings')?.closest('.inline-drawer')??null;
        if(activationPanel!==nextPanel){activationPanel?.classList.remove('bs-world-activation-tools');activationPanel=nextPanel;}
        activationPanel?.classList.toggle('bs-world-activation-tools',!!settings.worldBooks);
        for(const [select,button] of mounts)if(!select.isConnected){button.remove();mounts.delete(select);}
        for(const select of document.querySelectorAll('#world_info')){
            let button=mounts.get(select);
            if(!button?.isConnected){button=action('管理',()=>showManager().catch(notify));button.classList.add('bs-world-launch');button.title='选择世界书、查看关联角色或批量编辑';mounts.set(select,button);}
            const target=activationPanel??(select.closest('[data-v-app]')??select).parentElement;
            if(button.parentElement!==target)target.append(button);
            button.hidden=!settings.worldBooks;
        }
        if(!settings.worldBooks&&!modal?.bsBusy)modal?.close();
    }
    function openWorldDrawer() {
        const drawer=document.querySelector('#WorldInfo');if(drawer?.classList.contains('closedDrawer'))document.querySelector('#WI-SP-button .drawer-toggle')?.click();
    }
    async function chooseBook(name) {
        openWorldDrawer();
        const select=document.querySelector('#world_editor_select'),index=names().indexOf(name);
        if(index<0)throw new Error('世界书列表已变化，请重新打开。');
        if(select){select.value=String(index);if(window.jQuery)window.jQuery(select).trigger('change');else select.dispatchEvent(new Event('change',{bubbles:true}));}
        else await wi.showWorldEditor(name);
    }
    async function showManager() {
        await ready;if(destroyed||modal?.open)return;
        if(!wi?.loadWorldInfo||!wi?.saveWorldInfo||!wi?.deleteWorldInfo||!wi?.updateWorldInfoList)throw new Error('当前酒馆缺少世界书管理接口。');
        // Opening is read-only: the native module already has the current list.
        // Rebuilding all native selects here used to block the popup on a full
        // settings request. Writes below still recheck server names and content.
        refresh();if(destroyed||modal?.open)return;
        const dialog=node('dialog',{className:'bs-theme-modal bs-preset-modal bs-preset-picker bs-world-modal'});modal=dialog;
        let busy=false,editing=false,book=null,snapshot=null,items=[],selected=new Set(),drafts=new Map(),returnToWorld=true,renderRevision=0;
        let viewItems=null,viewQuery=null,view=[];
        const header=node('div',{className:'bs-theme-header'}),title=node('strong',{},'世界书');
        const back=action('返回世界书',()=>loadBooks()),manage=action('批量管理',()=>{editing=!editing;selected.clear();drafts.clear();render();});
        const toolbar=node('div',{className:'bs-world-toolbar'});toolbar.append(back,manage);
        header.append(title,toolbar,action('关闭',()=>{if(!busy)dialog.close();}));
        const search=node('input',{type:'text',className:'text_pole',placeholder:'搜索世界书 / 角色'});search.setAttribute('aria-label','搜索世界书或条目');
        const controls=node('div',{className:'bs-preset-actions'}),naming=node('div',{className:'bs-preset-actions'}),status=node('div',{className:'bs-theme-status',role:'status'}),list=node('div',{className:'bs-theme-scroll'}),footer=node('div',{className:'bs-preset-actions bs-preset-picker-footer'});
        const prefix=node('input',{className:'text_pole',placeholder:'统一前缀'}),suffix=node('input',{className:'text_pole',placeholder:'统一后缀'});
        const selectionBar=node('div',{className:'bs-world-selection'});selectionBar.append(controls,status);
        const visible=()=>{
            const query=norm(search.value).trim();if(viewItems===items&&viewQuery===query)return view;
            const terms=query.split(/\s+/u).filter(Boolean);viewItems=items;viewQuery=query;
            view=terms.length?items.filter(item=>terms.every(term=>item.searchText.includes(term))):items;return view;
        };
        const confirm=async text=>ctx().Popup?.show?.confirm?ctx().Popup.show.confirm('确认批量操作',node('div',{className:'bs-world-confirm'},text)):window.confirm(text);
        const setBusy=value=>{busy=dialog.bsBusy=value;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value);};
        const count=()=>{status.textContent=editing?`已选 ${selected.size} / ${items.length} ${book?'条':'本'}`:`${visible().length} / ${items.length} 本世界书`;};
        async function loadEntries(name) {
            if(busy)return;setBusy(true);
            try{const data=await wi.loadWorldInfo(name);if(!data?.entries)throw new Error('世界书读取失败。');book=name;snapshot=clone(data);items=Object.entries(data.entries).filter(([,entry])=>entry).map(([id,entry])=>({id,name:entry.comment??'',content:entry.content??'',searchText:norm(`${entry.comment??''}\n${entry.content??''}`),key:entry.key??[],disable:entry.disable===true}));editing=true;selected.clear();drafts.clear();search.value='';render();}catch(error){status.textContent=error.message;}finally{setBusy(false);}
        }
        function loadBooks(){book=null;snapshot=null;editing=false;search.value='';selected.clear();drafts.clear();owners=worldbookOwners(ctx().characters,wi?.world_info?.charLore);items=names().map(name=>({id:name,name,searchText:norm(`${name}\n${label(name)}`)}));render();}
        function render(){
            title.textContent=book?`条目管理 · ${book}`:'世界书';title.title=title.textContent;back.hidden=!book;manage.hidden=!!book;manage.textContent=editing?'完成管理':'批量管理';controls.hidden=footer.hidden=!editing;naming.hidden=!editing||!!book;
            search.placeholder=book?'搜索条目名称 / 内容':'搜索世界书 / 角色';list.replaceChildren();
            const matches=visible(),revision=++renderRevision;let offset=0;
            const appendBatch=()=>{
            const fragment=document.createDocumentFragment();
            for(const item of matches.slice(offset,offset+40)) {
                const row=node('div',{className:`bs-world-row${editing?' bs-world-edit-row':''}`});
                if(editing){
                    const check=node('input',{type:'checkbox',checked:selected.has(item.id)});check.setAttribute('aria-label',`选择 ${item.name||'#'+item.id}`);check.addEventListener('change',()=>{check.checked?selected.add(item.id):selected.delete(item.id);count();});
                    const text=node('label',{className:'bs-world-name'});text.append(check,node('span',{},item.name||`未命名条目 #${item.id}`));
                    const draft=node('input',{className:'text_pole',value:drafts.get(item.id)??item.name,placeholder:'新名称'});draft.setAttribute('aria-label',`新名称：${item.id}`);draft.addEventListener('input',()=>{drafts.set(item.id,draft.value);selected.add(item.id);check.checked=true;count();});row.append(text,draft);
                }else{
                    const choose=action(item.name,async()=>{if(busy)return;try{await chooseBook(item.name);returnToWorld=false;dialog.close();}catch(error){status.textContent=error.message;}});choose.className='bs-world-choose';row.append(choose,action('条目管理',()=>loadEntries(item.name)));
                }
                row.append(node('small',{className:'bs-world-owners'},book?`${item.disable?'停用':'启用'} · 关键词：${item.key.join('、')||'无'}`:label(item.name)));if(busy)row.querySelectorAll('button,input').forEach(control=>control.disabled=true);fragment.append(row);
            }
            list.append(fragment);offset+=40;
            if(offset<matches.length){const next=()=>{if(revision===renderRevision&&dialog.open&&dialog.isConnected)appendBatch();};if(typeof globalThis.requestAnimationFrame==='function')globalThis.requestAnimationFrame(next);else setTimeout(next,16);}
            };
            appendBatch();
            if(!list.childElementCount)list.append(node('p',{},'没有匹配的项目'));for(const button of footer.children)button.hidden=!book&&['批量启用','批量停用'].includes(button.textContent);count();
        }
        async function run(operation) {
            if(busy||!selected.size)return;
            let plan,done=0,started=false;
            try {
                plan=operation==='rename'?renamePlan(items,selected,drafts,!!book):items.filter(item=>selected.has(item.id));
                if(!plan.length){status.textContent='请先填写要修改的名称。';return;}
                const verb={rename:'改名',delete:'删除',enable:'启用',disable:'停用'}[operation];
                const preview=plan.map(item=>operation==='rename'?`${item.name} → ${item.newName}`:item.name||`#${item.id}`).join('\n');
                if(!await confirm(`确认${verb} ${plan.length} ${book?'条条目':'本世界书'}？\n${!book?'已加载角色的主/附加绑定、全局启用、当前聊天及用户角色绑定会同步更新。\n':''}${preview}`)||destroyed)return;
                setBusy(true);started=true;
                const listed=await (await post('/api/settings/get',{})).json();
                if(!Array.isArray(listed.world_names))throw new Error('无法核对当前世界书清单，已停止操作。');
                if(book&&!listed.world_names.includes(book)||!book&&plan.some(item=>!listed.world_names.includes(item.name)))throw new Error('世界书已被删除或改名，请重新打开列表。');
                if(!book&&operation==='rename')plan=renamePlan(listed.world_names.map(name=>({id:name,name})),selected,drafts);
                if(book){
                    const current=await wi.loadWorldInfo(book);if(!current?.entries)throw new Error('世界书读取失败。');
                    const ids=new Set(plan.map(item=>item.id)),next=editWorldbookEntries(current,ids,drafts,operation,snapshot);await persist(book,next);done=plan.length;
                    if(document.querySelector('#world_editor_select')?.value===String(names().indexOf(book)))wi.reloadEditor?.(book);
                    setBusy(false);await loadEntries(book);
                }else{
                    for(const item of plan){if(destroyed)throw new Error('操作已停止。');await changeBook(item.name,operation==='rename'?item.newName:null);done++;}
                    loadBooks();
                }
                status.textContent=`已${verb} ${done} 项。`;
            }catch(error){if(!book&&started)loadBooks();status.textContent=`已完成 ${done} 项。${error.message} 其余项目未继续处理。`;}
            finally{setBusy(false);if(destroyed){dialog.close();dialog.remove();if(modal===dialog)modal=null;}onRefresh();}
        }
        controls.append(action('全选当前结果',()=>{visible().forEach(item=>selected.add(item.id));render();}),action('取消选择',()=>{selected.clear();render();}));
        naming.append(prefix,suffix,action('应用到已选名称',()=>{for(const item of items.filter(item=>selected.has(item.id)))drafts.set(item.id,prefix.value+item.name+suffix.value);render();}));
        for(const [op,text] of [['rename','保存改名'],['enable','批量启用'],['disable','批量停用'],['delete','删除已选']])footer.append(action(text,()=>run(op)));
        // ST closes unpinned drawers on html touchstart/mousedown. Interactions
        // inside this top-layer dialog must not be mistaken for outside clicks.
        for(const type of ['pointerdown','mousedown','touchstart','click'])dialog.addEventListener(type,event=>event.stopPropagation());
        search.addEventListener('input',render);dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>{renderRevision++;dialog.remove();if(modal===dialog)modal=null;if(!destroyed&&settings.worldBooks&&returnToWorld)openWorldDrawer();});
        dialog.append(header,search,selectionBar,naming,list,footer);document.body.append(dialog);loadBooks();dialog.showModal();
    }
    function destroy(){destroyed=true;activationPanel?.classList.remove('bs-world-activation-tools');for(const button of mounts.values())button.remove();mounts.clear();if(modal&&!modal.bsBusy){modal.close();modal.remove();modal=null;}}
    return {refresh,showManager,destroy};
}
