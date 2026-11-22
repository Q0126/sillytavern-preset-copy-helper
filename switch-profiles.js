function el(tag, props = {}, text) {
    const node=Object.assign(document.createElement(tag),props);
    if(text!==undefined) node.textContent=text;
    return node;
}
function button(text, action) {
    const node=el('button',{type:'button',className:'menu_button'},text);
    node.addEventListener('click',action);return node;
}
function orderFor(manager) {
    if(!manager?.activeCharacter || typeof manager.getPromptOrderForCharacter!=='function') throw new Error('预设条目尚未加载，请稍后重试。');
    return manager.getPromptOrderForCharacter(manager.activeCharacter);
}
export function captureSwitches(manager) {
    const states=orderFor(manager).filter(item=>{
        const prompt=manager.getPromptById?.(item.identifier);
        return prompt && manager.isPromptToggleAllowed?.(prompt)!==false;
    }).map(item=>({identifier:item.identifier,enabled:item.enabled===true}));
    if(!states.length) throw new Error('当前没有可保存的条目开关。');
    return states;
}
export async function applySwitches(manager, states) {
    if(!Array.isArray(states) || !states.length) throw new Error('此方案没有开关记录，请重新保存。');
    const order=orderFor(manager), saved=new Map(states.map(item=>[item.identifier,item.enabled===true]));
    const changes=[], matched=new Set();
    let added=0;
    for(const item of order) {
        const prompt=manager.getPromptById?.(item.identifier);
        if(!prompt || manager.isPromptToggleAllowed?.(prompt)===false) continue;
        if(!saved.has(item.identifier)) { added++; continue; }
        matched.add(item.identifier);
        if(item.enabled!==saved.get(item.identifier)) changes.push({item,before:item.enabled,after:saved.get(item.identifier)});
    }
    if(!matched.size) throw new Error('方案里的条目已不存在，请重新保存方案。');
    const result={changed:changes.length,missing:states.filter(item=>!matched.has(item.identifier)).length,added};
    if(!changes.length) return result;
    const counts=manager.tokenHandler?.getCounts?.();
    for(const change of changes) {change.item.enabled=change.after;if(counts)counts[change.item.identifier]=null;}
    try { await manager.saveServiceSettings(); }
    catch(error) { for(const change of changes) change.item.enabled=change.before; manager.render(false); throw error; }
    manager.render(false);
    return result;
}

// Only identifiers and boolean switches are stored. Prompt contents and ordering
// stay in the shared preset; each preset has its own independent named schemes.
export function createSwitchProfiles({context,settings,getManager,getPresetName,waitForPreset=async()=>{},onRefresh}) {
    if(!Array.isArray(settings.switchProfiles)) settings.switchProfiles=[];
    let destroyed=false,busy=false,dialog=null,message='';
    const hosts=new Set();
    let displayedPreset=getPresetName();
    async function ensurePreset(name) {
        if(destroyed||getPresetName()!==name)throw new Error('当前预设已切换，请重新打开角色方案。');
        await waitForPreset();
        if(destroyed||getPresetName()!==name)throw new Error('当前预设已切换，请重新打开角色方案。');
    }
    const profiles=()=>settings.switchProfiles.filter(profile=>profile.presetName===getPresetName());
    const save=()=>context.saveSettingsDebounced?.();
    const currentMatches=profile=>{
        try {
            const states=captureSwitches(getManager());
            const saved=new Map(profile.states.map(item=>[item.identifier,item.enabled]));
            return states.length===saved.size && states.every(item=>saved.has(item.identifier)&&saved.get(item.identifier)===item.enabled);
        } catch {return false;}
    };
    const report=error=>{message=error.message;refresh();};
    const confirm=async text=>context.Popup?.show?.confirm ? context.Popup.show.confirm(text,null) : window.confirm(text);
    async function apply(profile) {
        if(busy||destroyed) return false;
        if(profile.presetName!==getPresetName()) {report(new Error('当前预设已切换，请选择当前预设的方案。'));return false;}
        busy=true;message=`正在切换到「${profile.name}」…`;refresh();
        try {
            await ensurePreset(profile.presetName);
            const result=await applySwitches(getManager(),profile.states);
            if(getPresetName()!==profile.presetName)return false;
            message=`已切换「${profile.name}」`;
            if(result.added||result.missing) message+=` · ${result.added} 个新增条目保持原开关，${result.missing} 个旧条目已失效，可重新保存方案`;
            return result.added===0&&result.missing===0;
        } catch(error) { if(getPresetName()===profile.presetName)message=`切换失败：${error.message}`;return false; }
        finally {busy=false;if(!destroyed){refresh();onRefresh();}}
    }
    function mount(host) {hosts.add(host);refresh();}
    function refresh() {
        const selectedPreset=getPresetName();
        if(displayedPreset!==selectedPreset) {
            displayedPreset=selectedPreset;message='';dialog?.close();
        }
        for(const host of hosts) {
            if(!host.isConnected) {hosts.delete(host);continue;}
            const count=profiles().length;
            const fingerprint=JSON.stringify([busy,getPresetName(),count]);
            if(host.dataset.switchFingerprint===fingerprint)continue;
            host.dataset.switchFingerprint=fingerprint;host.replaceChildren();
            const launch=button('角色方案',()=>showDialog().catch(error=>{report(error);globalThis.toastr?.error?.(error.message);}));
            launch.title=`管理当前预设的 ${count} 个角色方案`;launch.disabled=busy;
            launch.setAttribute('aria-haspopup','dialog');host.append(launch);
        }
        if(dialog?.open) {
            dialog.querySelectorAll('button,input').forEach(node=>{node.disabled=busy;});
            const status=dialog.querySelector('[role=status]');if(status)status.textContent=message;
            for(const choose of dialog.querySelectorAll('[data-bs-switch-id]')) {
                const profile=profiles().find(item=>item.id===choose.dataset.bsSwitchId);
                const active=profile&&currentMatches(profile);choose.setAttribute('aria-pressed',String(!!active));
                choose.querySelector('.bs-switch-state').textContent=active?'当前开关':'使用';
            }
        }
    }
    async function showDialog() {
        if(destroyed||dialog?.open) return;
        const presetName=getPresetName();
        if(!presetName || !getManager()) throw new Error('请先选择一份 Chat Completion 预设。');
        await ensurePreset(presetName);
        if(dialog?.open||destroyed)return;
        captureSwitches(getManager());
        const modal=el('dialog',{className:'bs-theme-modal bs-preset-modal bs-switch-modal'});dialog=modal;
        const header=el('div',{className:'bs-theme-header'});
        header.append(el('strong',{},'角色条目方案'),button('关闭',()=>{if(!busy)modal.close();}));
        const label=el('div',{className:'bs-theme-status'},`当前预设：${presetName}`);
        const actions=el('div',{className:'bs-preset-actions'});
        const name=el('input',{className:'text_pole',placeholder:'角色 / 方案名字'});name.setAttribute('aria-label','角色 / 方案名字');
        const search=el('input',{type:'text',className:'text_pole bs-switch-search',placeholder:'搜索角色方案'});search.setAttribute('aria-label','搜索角色方案');
        const list=el('div',{className:'bs-theme-scroll'});
        const status=el('div',{className:'bs-theme-status',role:'status'});
        const assertCurrent=()=>{if(presetName!==getPresetName())throw new Error('当前预设已切换，请重新打开角色方案。');};
        const render=()=>{
            list.replaceChildren();
            const query=search.value.normalize('NFKC').toLocaleLowerCase().trim();
            for(const profile of settings.switchProfiles.filter(profile=>profile.presetName===presetName && profile.name.normalize('NFKC').toLocaleLowerCase().includes(query))) {
                const row=el('div',{className:'bs-switch-row'});
                const choose=button('',async()=>{
                    try {assertCurrent();if(await apply(profile))modal.close();}catch(error){report(error);}
                });
                choose.className='bs-switch-choose';choose.dataset.bsSwitchId=profile.id;choose.setAttribute('aria-label',`使用方案 ${profile.name}`);
                const active=currentMatches(profile);choose.setAttribute('aria-pressed',String(active));
                choose.append(el('span',{className:'bs-switch-name'},profile.name),el('small',{className:'bs-switch-state'},active?'当前开关':'使用'));
                row.append(choose);
                const buttons=el('div',{className:'bs-pc-switch-actions'});
                buttons.append(button('更新为当前开关',async()=>{
                    if(busy)return;
                    try {
                        assertCurrent();
                        if(!await confirm(`用当前的条目开关更新「${profile.name}」？`))return;
                        assertCurrent();await ensurePreset(presetName);
                        profile.states=captureSwitches(getManager());save();message=`已更新「${profile.name}」`;refresh();
                    }catch(error){report(error);}
                }));
                buttons.append(button('删除方案',async()=>{
                    if(busy)return;
                    if(!await confirm(`删除方案「${profile.name}」？预设条目不会被删除。`))return;
                    if(destroyed||presetName!==getPresetName())return;
                    settings.switchProfiles=settings.switchProfiles.filter(item=>item.id!==profile.id);save();message='方案已删除';render();refresh();
                }));
                row.append(buttons);list.append(row);
            }
            if(!list.childElementCount)list.append(el('p',{},search.value?'没有匹配的角色方案':'还没有方案。先在原列表调好开关，再填写名字保存。'));
        };
        actions.append(name,button('保存当前开关',async()=>{
            if(busy)return;
            try {
                assertCurrent();await ensurePreset(presetName);const text=name.value.trim();if(!text)throw new Error('请填写角色或方案名字。');
                if(settings.switchProfiles.some(profile=>profile.presetName===presetName&&profile.name===text))throw new Error('同名方案已存在，请点它旁边的“更新为当前开关”。');
                settings.switchProfiles.push({id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,presetName,name:text,states:captureSwitches(getManager())});
                save();message=`已保存「${text}」`;name.value='';search.value='';render();refresh();
            }catch(error){report(error);}
        }));
        const note=el('div',{className:'bs-theme-note'},'先调好角色 A 的开关并保存方案，再调角色 B 并保存。以后点名字，就会同时开启需要的条目、关闭该方案里不需要的条目。方案仅保存开关；预设新增的条目保持原状态，确认后可更新方案。');
        search.addEventListener('input',render);
        modal.append(header,label,search,actions,status,list,note);
        modal.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
        modal.addEventListener('close',()=>{modal.remove();if(dialog===modal)dialog=null;});
        document.body.append(modal);render();modal.showModal();refresh();
    }
    function renamePreset(oldName,newName) {for(const profile of settings.switchProfiles)if(profile.presetName===oldName)profile.presetName=newName;save();}
    function deletePreset(name) {settings.switchProfiles=settings.switchProfiles.filter(profile=>profile.presetName!==name);save();}
    function destroy() {destroyed=true;for(const host of hosts)host.remove();hosts.clear();dialog?.close();dialog?.remove();dialog=null;}
    return {mount,refresh,renamePreset,deletePreset,destroy};
}
