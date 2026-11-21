import { createSwitchProfiles } from './switch-profiles.js';
const LIST = '[id$="prompt_manager_list"]';
const norm = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
const termsFor = query => norm(query).trim().split(/\s+/u).filter(Boolean);
const matches = (text, terms) => terms.every(term => norm(text).includes(term));
const clone = value => structuredClone(value);
function el(tag, props = {}, text) {
    const node = Object.assign(document.createElement(tag), props);
    if (text !== undefined) node.textContent = text;
    return node;
}
function button(text, action) {
    const node = el('button', { type:'button', className:'menu_button' }, text);
    node.addEventListener('click', action);
    return node;
}

// Read the prompt model, not only mounted DOM rows: folding/virtualization extensions
// can wrap, hide, recycle or temporarily remove those rows.
export function currentPrompts(pm, fallback = {}) {
    const service = pm?.serviceSettings ?? fallback;
    const prompts = Array.isArray(service.prompts) ? service.prompts.filter(Boolean) : [];
    let order;
    if (pm?.activeCharacter && typeof pm.getPromptOrderForCharacter === 'function') {
        order = pm.getPromptOrderForCharacter(pm.activeCharacter);
    } else {
        order = service.prompt_order?.find(item => String(item.character_id) === '100001')?.order;
    }
    const byId = new Map(prompts.map(p => [String(p.identifier), p]));
    return Array.isArray(order) ? order.filter(item => byId.has(String(item.identifier)))
        .map(item => ({ ...byId.get(String(item.identifier)), enabled:item.enabled })) : prompts;
}

export function renamePlan(items, selected, drafts, allowDuplicates = false) {
    const canonical = name => norm(name).normalize('NFD').replace(/\p{M}/gu, '');
    const occupied = new Set(items.filter(item => !selected.has(item.id)).map(item => canonical(item.name)));
    const plan = [];
    for (const item of items.filter(item => selected.has(item.id))) {
        const name = String(drafts.get(item.id) ?? item.name).trim();
        if (!name) throw new Error('名称不能为空。');
        if (!allowDuplicates && (/[<>:"/\\|?*\u0000-\u001f]/u.test(name) || /[. ]$/u.test(name))) throw new Error(`名称含有不支持的字符：${name}`);
        const key = canonical(name);
        if (!allowDuplicates && occupied.has(key)) throw new Error(`名称重复：${name}。请换一个名称。`);
        occupied.add(key);
        if (!allowDuplicates && name !== item.name && canonical(name) === canonical(item.name)) throw new Error('请先改成一个不同的临时名称，再调整大小写或全半角。');
        if (name !== item.name) plan.push({ ...item, newName:name });
    }
    // Renaming files runs sequentially; reject swaps/chains to avoid overwriting a source.
    for (const item of plan) if (!allowDuplicates && items.some(other => other.id !== item.id && canonical(other.name) === canonical(item.newName))) {
        throw new Error(`“${item.newName}”仍是另一项的原名称，请分两次改名。`);
    }
    return plan;
}

export function createPresetTools({ context, settings, onRefresh }) {
    let openai, presetModule, destroyed = false, query = '', modal, busy = false;
    const bars = new Map();
    const pm = () => openai?.promptManager;
    const fallback = () => openai?.oai_settings ?? context.chatCompletionSettings ?? {};
    const ready = Promise.all([
        import('../../../openai.js').then(module => { openai = module; }),
        import('../../../preset-manager.js').then(module => { presetModule = module; }),
    ].map(promise => promise.catch(error => console.warn('[白水预设工具]', error))))
        .then(() => { if (!destroyed) onRefresh(); });
    const notify = message => globalThis.toastr?.error?.(message);
    function getManager() { return presetModule?.getPresetManager?.('openai'); }
    const switchProfiles=createSwitchProfiles({context,settings,getManager:pm,getPresetName:()=>getManager()?.getSelectedPresetName?.() || fallback().preset_settings_openai || '',onRefresh});
    function entries() { return currentPrompts(pm(), fallback()); }
    function openEntry(id) {
        const manager = pm(), prompt = manager?.getPromptById?.(id);
        if (!prompt || manager.isPromptEditAllowed?.(prompt) === false) return;
        manager.clearEditForm?.(); manager.clearInspectForm?.();
        manager.loadPromptIntoEditForm(prompt); manager.showPopup();
    }
    function refresh() {
        for (const [list, state] of bars) if (!list.isConnected) { state.bar.remove(); bars.delete(list); }
        for (const list of document.querySelectorAll(LIST)) {
            list.classList.toggle('bs-pc-compact-list',settings.search);
            let state = bars.get(list);
            if (!state || !state.bar.isConnected) {
                const bar = el('div', { className:'bs-pc-search' });
                const row = el('div', { className:'bs-pc-search-row' });
                const input = el('input', { type:'search', className:'text_pole', value:query, placeholder:'搜索条目名称 / 内容' });
                input.setAttribute('aria-label', '搜索当前预设条目');
                const clear = () => { query=''; input.value=''; refresh(); input.focus(); };
                row.append(input, button('清除', clear), button('批量管理', () => showManager().catch(error => notify(error.message))));
                const count = el('small', { role:'status', className:'bs-pc-count' });
                const results = el('div', { className:'bs-pc-results', hidden:true });
                const switchHost=el('div',{className:'bs-pc-switcher'});
                bar.append(row,switchHost,count,results);list.before(bar);switchProfiles.mount(switchHost);
                state = { bar, input, count, results, fingerprint:'' }; bars.set(list, state);
                input.addEventListener('input', () => { query=input.value; refresh(); });
                input.addEventListener('keydown', event => { if (event.key==='Escape') { event.stopPropagation(); clear(); } });
            }
            state.bar.hidden = !settings.search;
            if (state.input.value !== query) state.input.value = query;
            const terms = settings.search ? termsFor(query) : [];
            const prompts = entries();
            const rows = [...list.querySelectorAll('[data-pm-identifier]')];
            const data = prompts.length ? prompts : rows.map(row => ({ identifier:row.dataset.pmIdentifier, name:row.querySelector('[data-pm-name]')?.dataset.pmName ?? row.textContent, content:'' }));
            const found = terms.length ? data.filter(p => matches(`${p.name}\n${p.content ?? ''}`, terms)) : [];
            // The original tree stays intact. Search results have their own small view,
            // so collapsed group ancestors and virtual rows cannot conceal a match.
            list.classList.toggle('bs-pc-search-list-hidden', !!terms.length);
            state.results.hidden = !terms.length;
            const fingerprint = JSON.stringify([terms, found.map(p => [p.identifier,p.name,p.content,p.enabled])]);
            if (fingerprint !== state.fingerprint) {
                state.fingerprint = fingerprint; state.results.replaceChildren();
                if (terms.length) for (const prompt of found) {
                    const item = el('div', { className:'bs-pc-result' });
                    const text = el('div');
                    text.append(el('strong', {}, prompt.name || '未命名条目'), el('small', {}, String(prompt.content ?? '').slice(0,180)));
                    const edit = button('编辑', () => openEntry(prompt.identifier));
                    edit.disabled = !pm()?.getPromptById?.(prompt.identifier) || pm()?.isPromptEditAllowed?.(prompt) === false;
                    item.append(text, edit); state.results.append(item);
                }
            }
            const message = terms.length ? `找到 ${found.length} / ${data.length} 条${found.length ? '' : '，试试其他关键词'}` : `${data.length} 条`;
            if (state.count.textContent !== message) state.count.textContent = message;
        }
        switchProfiles.refresh();
    }
    async function post(path, body) {
        if (typeof context.getRequestHeaders !== 'function') throw new Error('当前酒馆未提供保存接口，请更新酒馆后重试。');
        const response = await fetch(path, { method:'POST', headers:context.getRequestHeaders(), body:JSON.stringify(body) });
        if (!response.ok) throw new Error(`服务器保存失败（${response.status}），已停止后续操作。`);
        return response;
    }
    // Server first; failed requests must never remove the local item or its option.
    async function changeSaved(item, newName) {
        const manager = getManager();
        if (!manager?.getCompletionPresetByName) throw new Error('当前酒馆不支持预设管理。');
        const { presets, preset_names, settings:apiSettings } = manager.getPresetList();
        if (Array.isArray(preset_names)) throw new Error('此入口仅管理 Chat Completion 预设。');
        const index = preset_names[item.name], data = manager.getCompletionPresetByName(item.name);
        if (index === undefined || !data) throw new Error(`预设已发生变化，请重新打开：${item.name}`);
        const select = document.querySelector('#settings_preset_openai');
        const option = [...(select?.options ?? [])].find(option => option.text === item.name);
        const wasCurrent = manager.getSelectedPresetName() === item.name;
        if (newName) {
            if (Object.keys(preset_names).some(name => norm(name) === norm(newName) && name !== item.name)) throw new Error(`名称已存在：${newName}`);
            const response = await post('/api/presets/save', { name:newName, preset:clone(data), apiId:'openai' });
            const saved = await response.json();
            const actual = saved.name;
            if (!actual || actual !== newName) throw new Error(`服务器调整了名称，请刷新后检查：${actual || newName}`);
            // Register the successful copy even if deleting the old file later fails.
            presets.push(clone(data)); preset_names[actual] = presets.length-1;
            if (select) select.append(el('option', { value:String(preset_names[actual]) }, actual));
        }
        await post('/api/presets/delete', { name:item.name, apiId:'openai' });
        delete preset_names[item.name];option?.remove();
        if(newName)switchProfiles.renamePreset(item.name,newName);else switchProfiles.deletePreset(item.name);
        if (wasCurrent) {
            const next = newName || Object.keys(preset_names)[0];
            if (newName) {
                select.value = String(preset_names[next]);
                // Renaming must preserve unsaved working prompt contents and switches.
                apiSettings.preset_settings_openai = next;
                if (openai?.oai_settings) openai.oai_settings.preset_settings_openai = next;
            } else if (next && select) {
                if (manager.selectPreset) await manager.selectPreset(String(preset_names[next]));
                else if (window.jQuery) window.jQuery(select).val(String(preset_names[next])).trigger('change');
                else { select.value=String(preset_names[next]); select.dispatchEvent(new Event('change',{bubbles:true})); }
            }
        }
        context.saveSettingsDebounced?.();
    }
    async function changeEntries(plan, deleting, snapshot) {
        const manager = pm(), service = manager?.serviceSettings;
        if (!service || service.prompts !== snapshot.prompts || service.prompt_order !== snapshot.order || manager.activeCharacter !== snapshot.character) {
            throw new Error('当前预设或角色已切换，请重新打开批量管理。');
        }
        const beforePrompts = clone(service.prompts), beforeOrder = clone(service.prompt_order);
        for (const item of plan) {
            const prompt = manager.getPromptById(item.id);
            if (!prompt || prompt.name !== item.name) throw new Error('条目已发生变化，请重新打开批量管理。');
            if (deleting && manager.isPromptDeletionAllowed?.(prompt) !== true) throw new Error('内置条目不能删除。');
            if (!deleting && manager.isPromptEditAllowed?.(prompt) === false) throw new Error('此条目不允许编辑。');
        }
        if (deleting) {
            const ids = new Set(plan.map(item => item.id));
            service.prompts.splice(0,service.prompts.length,...service.prompts.filter(p => !ids.has(p.identifier)));
            for (const order of service.prompt_order ?? []) order.order = order.order.filter(p => !ids.has(p.identifier));
        } else for (const item of plan) manager.getPromptById(item.id).name = item.newName;
        try { await manager.saveServiceSettings(); }
        catch (error) {
            service.prompts.splice(0,service.prompts.length,...beforePrompts);
            if (Array.isArray(service.prompt_order)) service.prompt_order.splice(0,service.prompt_order.length,...beforeOrder);
            manager.render(false); throw error;
        }
        manager.render(false); onRefresh();
    }
    async function showManager() {
        await ready;
        if (destroyed || modal?.open) return;
        const manager = getManager();
        if (!manager || !pm()) throw new Error('预设尚未加载，请打开 AI 回复配置后重试。');
        let snapshot;
        const dialog = el('dialog', { className:'bs-theme-modal bs-preset-modal' }); modal=dialog;
        const header = el('div', { className:'bs-theme-header' });
        const close = button('关闭', () => { if (!busy) dialog.close(); });
        header.append(el('strong', {}, '批量管理预设'), close);
        const tabs = el('div', { className:'bs-preset-actions' });
        const filter = el('input', { className:'text_pole', type:'search', placeholder:'搜索名称 / 条目内容' });
        const controls = el('div', { className:'bs-preset-actions' });
        const prefix = el('input', { className:'text_pole', placeholder:'统一前缀', 'ariaLabel':'统一前缀' });
        const suffix = el('input', { className:'text_pole', placeholder:'统一后缀', 'ariaLabel':'统一后缀' });
        const names = el('div', { className:'bs-preset-actions' });
        const status = el('div', { className:'bs-theme-status', role:'status' });
        const list = el('div', { className:'bs-theme-scroll' });
        const footer = el('div', { className:'bs-preset-actions' });
        let mode='saved', items=[], selected=new Set(), drafts=new Map();
        const visible = () => items.filter(item => matches(`${item.name}\n${item.content ?? ''}`, termsFor(filter.value)));
        const render = () => {
            list.replaceChildren();
            for (const item of visible()) {
                const row = el('div', { className:'bs-preset-row' });
                const check = el('input', { type:'checkbox', checked:selected.has(item.id), disabled:busy });
                check.setAttribute('aria-label', `选择 ${item.name}`);
                const text = el('label', { className:'bs-preset-name' });
                text.append(check, el('span', {}, item.name));
                const draft = el('input', { className:'text_pole', value:drafts.get(item.id) ?? item.name, disabled:busy });
                draft.setAttribute('aria-label', `新名称：${item.name}`);
                check.onchange=()=>{ check.checked ? selected.add(item.id) : selected.delete(item.id); updateCount(); };
                draft.oninput=()=>{ drafts.set(item.id,draft.value); selected.add(item.id); check.checked=true; updateCount(); };
                row.append(text,draft); list.append(row);
            }
            if (!list.childElementCount) list.append(el('p', {}, '没有匹配的项目'));
            updateCount();
        };
        const updateCount = () => { status.textContent=`${mode==='saved'?'整份 Chat Completion 预设':'当前预设条目'} · 已选 ${selected.size} / ${items.length} 项`; };
        const load = nextMode => {
            mode=nextMode; selected.clear(); drafts.clear(); filter.value='';
            if (mode==='entries') {
                const service=pm().serviceSettings;
                snapshot={prompts:service.prompts,order:service.prompt_order,character:pm().activeCharacter};
            }
            items = mode==='saved' ? manager.getAllPresets().map(name=>({id:name,name})) : entries().map(p=>({ ...p,id:p.identifier }));
            for (const tab of tabs.children) tab.setAttribute('aria-pressed',String(tab.dataset.mode===mode));
            note.textContent=mode==='saved' ? '勾选后可逐项填写新名称，或统一加前后缀。改名保留预设内容；删除前会显示确认。' : '只修改当前使用的条目。内置条目禁止删除；如需覆盖已保存的整份预设，完成后再点酒馆原来的保存按钮。';
            render();
        };
        const setBusy = value => {
            busy=value;
            dialog.querySelectorAll('button,input').forEach(node=>{node.disabled=value;});
        };
        const run = async deleting => {
            if (busy) return;
            let plan;
            try {
                plan=deleting ? items.filter(item=>selected.has(item.id)) : renamePlan(items,selected,drafts,mode==='entries');
                if (!plan.length) { status.textContent='请先勾选项目并填写要修改的名称。'; return; }
                if (mode==='saved' && deleting && plan.length>=items.length) throw new Error('请至少保留一份预设。');
                if (mode==='entries' && deleting) {
                    const blocked=plan.filter(item=>pm().isPromptDeletionAllowed?.(pm().getPromptById(item.id))!==true);
                    if (blocked.length) throw new Error(`内置条目不能删除，请取消勾选：${blocked.map(p=>p.name).join('、')}`);
                }
                const summary=plan.map(item=>deleting ? item.name : `${item.name} → ${item.newName}`).join('\n');
                const content=el('div',{},`${deleting?'确认删除':'确认改名'} ${plan.length} 项？\n\n${summary}`);
                content.style.whiteSpace='pre-wrap';
                // Use a native ST popup when available, so confirmation is visible over
                // this dialog on mobile; fall back to the browser's confirm dialog.
                const confirmed = context.Popup?.show?.confirm ? await context.Popup.show.confirm('批量操作确认',content) : window.confirm(content.textContent);
                if (!confirmed || destroyed) return;
                setBusy(true);
                if (mode==='entries') { await changeEntries(plan,deleting,snapshot); load(mode); status.textContent=`已${deleting?'删除':'改名'} ${plan.length} 项。`; }
                else {
                    let done=0;
                    try { for (const item of plan) { if (destroyed) throw new Error('操作已停止。'); await changeSaved(item,deleting?null:item.newName); done++; } }
                    catch (error) { load(mode); throw new Error(`已完成 ${done} 项。${error.message} 其余项目未继续处理。`); }
                    load(mode); status.textContent=`已${deleting?'删除':'改名'} ${done} 项。`;
                }
            } catch (error) { status.textContent=error.message; }
            finally { setBusy(false); onRefresh(); }
        };
        for (const [value,label] of [['saved','整份预设'],['entries','当前条目']]) {
            const tab=button(label,()=>load(value));tab.dataset.mode=value;tabs.append(tab);
        }
        controls.append(button('全选搜索结果',()=>{visible().forEach(item=>selected.add(item.id));render();}),button('取消选择',()=>{selected.clear();render();}));
        names.append(prefix,suffix,button('应用到已选名称',()=>{for(const item of items.filter(item=>selected.has(item.id))) drafts.set(item.id,prefix.value+item.name+suffix.value);render();}));
        footer.append(button('保存改名',()=>run(false)),button('删除已选',()=>run(true)));
        const note=el('div',{className:'bs-theme-note'});
        filter.addEventListener('input',render);
        dialog.append(header,tabs,filter,controls,names,status,list,footer,note);
        dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
        dialog.addEventListener('close',()=>{dialog.remove();if(modal===dialog)modal=null;});
        document.body.append(dialog);load('saved');dialog.showModal();
    }
    function destroy() {
        destroyed=true;switchProfiles.destroy();
        for(const [list,state] of bars) {list.classList.remove('bs-pc-search-list-hidden','bs-pc-compact-list');state.bar.remove();}
        bars.clear();modal?.close();modal?.remove();modal=null;
    }
    return { refresh, destroy };
}
