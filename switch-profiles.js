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

// Shared built-ins occur in unrelated presets; they cannot prove ownership.
const switchBuiltins=new Set(['main','nsfw','jailbreak','enhanceDefinitions','charDescription','charPersonality','scenario','personaDescription','worldInfoBefore','worldInfoAfter','chatHistory','dialogueExamples']);
function switchIds(states) {return new Set((states??[]).map(item=>String(item.identifier)).filter(id=>!switchBuiltins.has(id)));}
function switchCatalog(catalog) {return (catalog??[]).filter(item=>typeof item.name==='string'&&Array.isArray(item.prompts)).map(item=>({name:item.name,ids:switchIds(item.prompts)}));}
function switchFit(profile,scope) {
    const ids=switchIds(profile.states);if(!ids.size)return 1;
    return [...ids].filter(id=>scope.ids.has(id)).length/ids.size;
}
export function repairSwitchProfileBindings(profiles,catalog) {
    const scopes=switchCatalog(catalog);let changed=false;
    if(!scopes.length)return false;
    for(const profile of profiles) {
        if(profile.bindingVersion===2)continue;
        const ids=switchIds(profile.states);
        const ranked=scopes.map(scope=>({scope,fit:switchFit(profile,scope)})).sort((a,b)=>b.fit-a.fit);
        const best=ranked[0],next=ranked[1]?.fit??0;
        // Only repair a legacy label when the stored IDs identify one clear owner.
        if(ids.size&&best.fit>=.8&&next<.5&&(best.fit===1||ids.size>=3)) {
            if(profile.presetName!==best.scope.name) {profile.previousPresetName=profile.presetName;profile.presetName=best.scope.name;changed=true;}
        }
        const declared=scopes.find(scope=>scope.name===profile.presetName);
        if(declared&&switchFit(profile,declared)>=.5){profile.bindingVersion=2;changed=true;}
    }
    return changed;
}

// Only identifiers and boolean switches are stored. Prompt contents and ordering
// stay in the shared preset; each preset has its own independent named schemes.
export function createSwitchProfiles({context,settings,getManager,getPresetName,waitForPreset=async()=>{},getPresetCatalog=()=>[],onRefresh}) {
    if(!Array.isArray(settings.switchProfiles)) settings.switchProfiles=[];
    let destroyed=false,busy=false,dialog=null,message='';
    const hosts=new Set();
    let displayedPreset=getPresetName();
    async function ensurePreset(name) {
        if(destroyed||getPresetName()!==name)throw new Error('当前预设已切换，请重新打开角色方案。');
        await waitForPreset();
        if(destroyed||getPresetName()!==name)throw new Error('当前预设已切换，请重新打开角色方案。');
    }
    let catalog=[],catalogScopes=new Map(),renderDialog=null;
    const compatible=(profile,name=profile.presetName)=>{
        const scope=catalogScopes.get(name);
        return !scope||switchFit(profile,scope)>=.5;
    };
    const profiles=()=>settings.switchProfiles.filter(profile=>profile.presetName===getPresetName()&&compatible(profile));
    function checkBindings(){catalog=getPresetCatalog()??[];catalogScopes=new Map(switchCatalog(catalog).map(item=>[item.name,item]));if(repairSwitchProfileBindings(settings.switchProfiles,catalog)){save();renderDialog?.();}}
    function captureCurrent(name){
        const states=captureSwitches(getManager());
        if(!compatible({presetName:name,states}))throw new Error('当前条目与已保存的预设不一致，请等待加载完成；若仍有提示，请先保存或重新选择预设。');
        return states;
    }
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
            await ensurePreset(profile.presetName);checkBindings();
            if(profile.presetName!==getPresetName()||!compatible(profile))throw new Error('这个旧方案不属于当前预设，请在“⋯”中调整归属。');
            captureCurrent(profile.presetName);
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
            dialog.querySelectorAll('button,input,select').forEach(node=>{node.disabled=busy;});
            const status=dialog.querySelector('[role=status]');if(status){status.textContent=message;status.hidden=!message;}
            const available=new Map(profiles().map(profile=>[profile.id,profile]));
            for(const choose of dialog.querySelectorAll('[data-bs-switch-id]')) {
                const profile=available.get(choose.dataset.bsSwitchId);
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
        checkBindings();captureSwitches(getManager());
        const modal=el('dialog',{className:'bs-theme-modal bs-preset-modal bs-switch-modal'});dialog=modal;
        const header=el('div',{className:'bs-theme-header'});
        header.append(el('strong',{},'角色条目方案'),button('关闭',()=>{if(!busy)modal.close();}));
        const label=el('div',{className:'bs-theme-status bs-switch-preset-label',title:presetName},`当前预设：${presetName}`);
        const actions=el('form',{id:'bs-switch-create',className:'bs-preset-actions bs-switch-create',hidden:true});
        const name=el('input',{type:'text',className:'text_pole',placeholder:'例如：陈觉斐'});name.setAttribute('aria-label','方案名称');
        const nameLabel=el('label',{},'方案名称');nameLabel.append(name);
        const search=el('input',{type:'text',className:'text_pole bs-switch-search',placeholder:'搜索已存方案'});search.setAttribute('aria-label','搜索角色方案');
        const setCreating=open=>{actions.hidden=!open;create.setAttribute('aria-expanded',String(open));(open?name:create).focus();};
        const create=button('新建方案',()=>setCreating(actions.hidden));create.setAttribute('aria-expanded','false');create.setAttribute('aria-controls',actions.id);
        const toolbar=el('div',{className:'bs-switch-toolbar'});toolbar.append(search,create);
        const list=el('div',{className:'bs-theme-scroll'});
        const status=el('div',{className:'bs-theme-status',role:'status'});
        const assertCurrent=()=>{if(presetName!==getPresetName())throw new Error('当前预设已切换，请重新打开角色方案。');};
        const render=()=>{
            list.replaceChildren();
            const query=search.value.normalize('NFKC').toLocaleLowerCase().trim();
            for(const profile of profiles().filter(profile=>profile.name.normalize('NFKC').toLocaleLowerCase().includes(query))) {
                const row=el('div',{className:'bs-switch-row'});
                const choose=button('',async()=>{
                    try {assertCurrent();if(await apply(profile))modal.close();}catch(error){report(error);}
                });
                choose.className='bs-switch-choose';choose.dataset.bsSwitchId=profile.id;choose.setAttribute('aria-label',`使用方案 ${profile.name}`);
                const active=currentMatches(profile);choose.setAttribute('aria-pressed',String(active));
                choose.append(el('span',{className:'bs-switch-name'},profile.name),el('small',{className:'bs-switch-state'},active?'当前开关':'使用'));
                const main=el('div',{className:'bs-switch-main'});main.append(choose);row.append(main);
                const menu=el('details',{className:'bs-switch-menu'}),summary=el('summary',{title:'管理方案'},'⋯');summary.setAttribute('aria-label',`管理方案 ${profile.name}`);menu.append(summary);main.append(menu);
                const buttons=el('div',{className:'bs-switch-menu-panel'});
                buttons.append(button('更新为当前开关',async()=>{
                    if(busy)return;
                    try {
                        assertCurrent();
                        if(!await confirm(`用当前的条目开关更新「${profile.name}」？`))return;
                        assertCurrent();await ensurePreset(presetName);
                        checkBindings();profile.states=captureCurrent(presetName);profile.bindingVersion=2;save();message=`已更新「${profile.name}」`;refresh();
                    }catch(error){report(error);}
                }));
                buttons.append(button('删除方案',async()=>{
                    if(busy)return;
                    if(!await confirm(`删除方案「${profile.name}」？预设条目不会被删除。`))return;
                    if(destroyed||presetName!==getPresetName())return;
                    settings.switchProfiles=settings.switchProfiles.filter(item=>item.id!==profile.id);save();message='方案已删除';render();refresh();
                }));
                const owner=el('select',{className:'text_pole'});owner.setAttribute('aria-label',`所属预设 ${profile.name}`);
                const owners=[...new Set([profile.presetName,...catalog.map(item=>item.name)])];
                for(const value of owners)owner.append(el('option',{value},value));owner.value=profile.presetName;
                buttons.append(el('small',{},'所属预设'),owner,button('保存归属',async()=>{
                    if(busy||!owner.value)return;
                    const target=owner.value;
                    if(target===profile.presetName){menu.open=false;return;}
                    if(!await confirm(`把「${profile.name}」移到预设「${target}」？方案的开关记录会保留。`))return;
                    if(destroyed||presetName!==getPresetName())return;
                    profile.previousPresetName=profile.presetName;profile.presetName=target;profile.bindingVersion=2;save();message='方案归属已调整';render();refresh();
                }));
                menu.append(buttons);list.append(row);
            }
            if(!list.childElementCount)list.append(el('p',{},search.value?'没有匹配的角色方案':'当前预设还没有角色方案。'));
            const unresolved=settings.switchProfiles.filter(profile=>profile.presetName===presetName&&!compatible(profile));
            if(unresolved.length){
                const recovery=el('details',{className:'bs-switch-recovery'});recovery.append(el('summary',{},`待确认归属的旧方案（${unresolved.length}）`));
                for(const profile of unresolved){
                    const row=el('div',{className:'bs-switch-recover-row'}),owner=el('select',{className:'text_pole'});
                    owner.setAttribute('aria-label',`修复归属 ${profile.name}`);for(const item of catalog)owner.append(el('option',{value:item.name},item.name));owner.value=profile.presetName;
                    row.append(el('span',{},profile.name),owner,button('调整归属',()=>{if(destroyed||presetName!==getPresetName()||!owner.value)return;profile.previousPresetName=profile.presetName;profile.presetName=owner.value;profile.bindingVersion=2;save();render();refresh();}));recovery.append(row);
                }
                list.append(recovery);
            }
        };
        const saveProfile=async event=>{
            event.preventDefault();
            if(busy)return;
            try {
                assertCurrent();await ensurePreset(presetName);checkBindings();const text=name.value.trim();if(!text)throw new Error('请填写角色或方案名字。');
                if(settings.switchProfiles.some(profile=>profile.presetName===presetName&&profile.name===text))throw new Error('同名方案已存在，请点它旁边的“更新为当前开关”。');
                settings.switchProfiles.push({id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,presetName,bindingVersion:2,name:text,states:captureCurrent(presetName)});
                save();message=`已保存「${text}」`;name.value='';search.value='';setCreating(false);render();refresh();
            }catch(error){report(error);}
        };
        const submit=el('button',{type:'submit',className:'menu_button'},'保存方案');
        actions.append(nameLabel,submit,button('取消',()=>{name.value='';setCreating(false);}));actions.addEventListener('submit',saveProfile);
        const note=el('div',{className:'bs-theme-note'},'方案仅保存当前预设的条目开关。');
        renderDialog=render;search.addEventListener('input',render);
        modal.append(header,label,toolbar,actions,status,list,note);
        modal.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
        modal.addEventListener('close',()=>{modal.remove();if(dialog===modal){dialog=null;renderDialog=null;}});
        document.body.append(modal);render();modal.showModal();refresh();
    }
    function renamePreset(oldName,newName) {for(const profile of settings.switchProfiles)if(profile.presetName===oldName)profile.presetName=newName;save();}
    function deletePreset(name) {settings.switchProfiles=settings.switchProfiles.filter(profile=>profile.presetName!==name);save();}
    function destroy() {destroyed=true;for(const host of hosts)host.remove();hosts.clear();dialog?.close();dialog?.remove();dialog=null;}
    return {mount,refresh,renamePreset,deletePreset,destroy};
}
