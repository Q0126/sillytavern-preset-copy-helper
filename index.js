import { createThemeGallery } from './theme-gallery.js';
// SillyTavern UI extension. No request interception, prompt mutation or chat writes.
const KEY = 'baishui_preset_copy';
const defaults = { search: true, protect: true, themeGallery: true };
const LIST = '[id$="prompt_manager_list"]';
const BODY = '#chat .mes .mes_text';
const EXCLUDE = 'script,style,button,input,textarea,select,iframe,svg,[hidden],[contenteditable="true"],.code-copy,.copy-code-button,.bs-pc-message';
let ctx, settings, openai, observer, scheduled = false, searchQuery = '', running = false;
let themeGallery = null, savedRange = null, touchScroll = null, restoreTimer;
const listeners = [], subscriptions = [], sortableStates = new Map();
const promptIndex = new WeakMap();

function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
}
function element(tag, props = {}, text) {
    const el = document.createElement(tag);
    Object.assign(el, props);
    if (text !== undefined) el.textContent = text;
    return el;
}
function normalized(value) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase(); }
function bodyFor(node) { return (node?.nodeType === 1 ? node : node?.parentElement)?.closest(BODY); }
function inEditor(node) { return !!(node?.nodeType === 1 ? node : node?.parentElement)?.closest('input,textarea,[contenteditable="true"]'); }
function save() { ctx.saveSettingsDebounced?.(); applySettings(); queueRefresh(); }
function queueRefresh() {
    if (scheduled || !running) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; if(running) refresh(); });
}
function toggleSorting(list, filtered) {
    const jq = window.jQuery;
    if (!jq?.fn?.sortable || !jq(list).hasClass('ui-sortable')) return;
    if (filtered && !sortableStates.has(list)) {
        sortableStates.set(list, jq(list).sortable('option', 'disabled'));
        jq(list).sortable('option', 'disabled', true);
    } else if (!filtered && sortableStates.has(list)) {
        jq(list).sortable('option', 'disabled', sortableStates.get(list));
        sortableStates.delete(list);
    }
}
function refresh() {
    mountSettings();
    for (const list of sortableStates.keys()) if (!list.isConnected) sortableStates.delete(list);
    for (const list of document.querySelectorAll(LIST)) {
        let bar = list.parentElement.querySelector(':scope > .bs-pc-search');
        if (!bar && settings.search) {
            bar = element('div', { className:'bs-pc-search' });
            const row = element('div', { className:'bs-pc-search-row' });
            const input = element('input', { type:'search', className:'text_pole', placeholder:'搜索当前预设条目：名称 / 内容', value:searchQuery });
            input.setAttribute('aria-label', '搜索当前预设条目');
            const clear = element('button', { type:'button', className:'menu_button', title:'清除搜索' }, '清除');
            row.append(input, clear);
            const count = element('small', { role:'status', className:'bs-pc-count' });
            bar.append(row, count);
            list.before(bar);
            input.addEventListener('input', () => { searchQuery = input.value; refresh(); });
            clear.addEventListener('click', () => { searchQuery = ''; input.value = ''; refresh(); input.focus(); });
            input.addEventListener('keydown', e => { if (e.key === 'Escape') { searchQuery = ''; input.value = ''; refresh(); e.stopPropagation(); } });
        }
        if (bar) bar.hidden = !settings.search;
        const terms = settings.search ? normalized(searchQuery).trim().split(/\s+/u).filter(Boolean) : [];
        const prompts = terms.length ? openai?.promptManager?.serviceSettings?.prompts ?? openai?.oai_settings?.prompts ?? [] : [];
        const byId = new Map(prompts.filter(Boolean).map(p => [p.identifier, p]));
        const rows = [...list.querySelectorAll(':scope > [data-pm-identifier]')];
        let found = 0;
        for (const row of rows) {
            const prompt = byId.get(row.dataset.pmIdentifier);
            let haystack = '';
            if (terms.length) {
                if (prompt) {
                    let entry = promptIndex.get(prompt);
                    if (!entry || entry.name !== prompt.name || entry.content !== prompt.content) {
                        entry = { name:prompt.name, content:prompt.content, text:normalized([prompt.name,prompt.content].join('\n')) };
                        promptIndex.set(prompt, entry);
                    }
                    haystack = entry.text;
                } else haystack = normalized(row.querySelector('[data-pm-name]')?.dataset.pmName ?? row.textContent);
            }
            const matches = terms.every(term => haystack.includes(term));
            row.classList.toggle('bs-pc-hidden', !matches);
            if (matches) found++;
        }
        list.classList.toggle('bs-pc-filtering', !!terms.length);
        toggleSorting(list, !!terms.length);
        const count = bar?.querySelector('.bs-pc-count');
        const text = terms.length ? `找到 ${found} / ${rows.length} 条${found ? '' : '，试试其他关键词'} · 清除后可拖动排序` : `共 ${rows.length} 条 · 支持名称与内容，多词用空格分隔`;
        if (count && count.textContent !== text) count.textContent = text;
    }
    themeGallery?.refresh();
}

function cleanClone(fragment) {
    fragment.querySelectorAll(EXCLUDE).forEach(el => el.remove());
    return fragment;
}
function plainText(fragment) {
    const div = element('div');
    div.append(cleanClone(fragment));
    div.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    div.querySelectorAll('p,div,section,article,li,pre,blockquote,h1,h2,h3,h4,tr').forEach(el => el.append('\n'));
    return div.textContent.replace(/\n{3,}/g, '\n\n');
}
function selectedBodies(range) {
    const parts = [];
    for (const body of document.querySelectorAll(BODY)) {
        if (!range.intersectsNode(body)) continue;
        const cut = document.createRange();
        cut.selectNodeContents(body);
        if (range.compareBoundaryPoints(Range.START_TO_START, cut) > 0) cut.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(Range.END_TO_END, cut) < 0) cut.setEnd(range.endContainer, range.endOffset);
        parts.push(plainText(cut.cloneContents()));
    }
    return parts.join('\n\n');
}
function onCopy(event) {
    if (!settings.protect || inEditor(document.activeElement)) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    // Only take ownership when the selection includes a chat body, never a preset/editor.
    const range = selection.getRangeAt(0);
    if (![...document.querySelectorAll(BODY)].some(el => range.intersectsNode(el))) return;
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', selectedBodies(range));
    event.preventDefault();
    event.stopImmediatePropagation();
}
function rememberSelection() {
    if (!settings.protect || touchScroll) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) { savedRange = null; return; }
    const range = sel.getRangeAt(0);
    savedRange = bodyFor(range.startContainer) && bodyFor(range.endContainer) ? range.cloneRange() : null;
}
function restoreSelection() {
    if (!touchScroll?.moved || !touchScroll.scrolled || !savedRange?.startContainer?.isConnected || !savedRange?.endContainer?.isConnected || inEditor(document.activeElement)) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange.cloneRange());
}

function applySettings() { document.body.classList.toggle('bs-pc-protect', settings.protect); }
function mountSettings() {
    const host = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!host || document.getElementById('bs-pc-settings')) return;
    const panel = element('div', { id:'bs-pc-settings', className:'extension_container bs-pc-settings' });
    const drawer = element('div', { className:'inline-drawer' });
    const header = element('div', { className:'inline-drawer-toggle inline-drawer-header', role:'button', tabIndex:0 });
    const content = element('div', { className:'inline-drawer-content', id:'bs-pc-settings-content' });
    header.setAttribute('aria-controls', content.id);
    header.append(element('b', {}, '白水杂货铺'), element('div', { className:'inline-drawer-icon fa-solid fa-circle-chevron-down down' }));
    // SillyTavern owns the click handler and animation for native inline drawers.
    header.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); header.click(); }
    });
    for(const [key,label] of [['search','预设条目关键词搜索'],['protect','正文复制保护与滚动选区保留'],['themeGallery','美化预览、标签与搜索']]) {
        const line=element('label', { className:'checkbox_label' }); const input=element('input',{type:'checkbox',checked:settings[key]});
        input.onchange=()=>{settings[key]=input.checked;save();}; line.append(input,element('span', {}, label)); content.append(line);
    }
    content.append(element('small',{className:'bs-pc-description'},'正文复制保护排除顶栏、消息工具和输入框。美化选择支持双列预览、自定义封面、标签分类和搜索。'));
    drawer.append(header, content);
    panel.append(drawer);host.append(panel);
}
function init() {
    if (observer) return;
    ctx=window.SillyTavern?.getContext?.();
    if (!ctx) { console.warn('[白水复制助手] SillyTavern context unavailable'); return; }
    const store=ctx.extensionSettings ?? ctx.extension_settings;
    if (!store) return;
    running=true;
    settings=store[KEY] ??= {};
    for(const [k,v] of Object.entries(defaults)) if(typeof settings[k]!=='boolean') settings[k]=v;
    delete settings.buttons;
    themeGallery = createThemeGallery({ context:ctx, settings, onSave:() => ctx.saveSettingsDebounced?.() });
    applySettings(); mountSettings(); refresh();
    observer=new MutationObserver(records=>{
        // Child-list only: filter class/style changes must not trigger a refresh loop.
        if(records.some(r=>r.target.nodeType===1 && !r.target.closest('.bs-pc-search,.bs-theme-modal,.bs-theme-launch') && !r.target.closest('.mes_text') && (r.target.closest('#completion_prompt_manager,#chat,#UI-presets-block') || [...r.addedNodes].some(n=>n.nodeType===1 && (n.matches?.(LIST+',#chat,#completion_prompt_manager,#themes,#UI-presets-block') || n.querySelector?.(LIST)))))) queueRefresh();
    });
    observer.observe(document.body,{childList:true,subtree:true});
    listen(document,'copy',onCopy,true);
    listen(document,'selectionchange',rememberSelection);
    listen(document,'pointerdown',e=>{
        clearTimeout(restoreTimer);
        if(e.pointerType==='touch' && savedRange && bodyFor(e.target)) touchScroll={x:e.clientX,y:e.clientY,moved:false,scrolled:false};
        else { touchScroll=null; savedRange=null; }
    },true);
    listen(document,'pointermove',e=>{if(touchScroll && Math.hypot(e.clientX-touchScroll.x,e.clientY-touchScroll.y)>14) touchScroll.moved=true;},{capture:true,passive:true});
    listen(document,'scroll',e=>{
        if(touchScroll && e.target instanceof Element && (e.target.id==='chat' || e.target.closest('#chat'))) {
            touchScroll.scrolled=true;
            clearTimeout(restoreTimer);
            restoreTimer=setTimeout(()=>{restoreSelection();touchScroll=null;},180);
        }
    },{capture:true,passive:true});
    for(const type of ['pointerup','pointercancel']) listen(document,type,()=>{if(touchScroll){clearTimeout(restoreTimer);restoreTimer=setTimeout(()=>{restoreSelection();touchScroll=null;},180);}},true);
    const refreshEvents=['CHAT_CHANGED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_EDITED','MESSAGE_SWIPED','GENERATION_ENDED','PRESET_CHANGED','OAI_PRESET_CHANGED_AFTER','SETTINGS_UPDATED'];
    for(const name of refreshEvents){const type=ctx.event_types?.[name];if(type && ctx.eventSource?.on){ctx.eventSource.on(type,queueRefresh);subscriptions.push([type,queueRefresh]);}}
    // Optional, read-only access for searching hidden prompt CONTENT. UI still works by name if this internal module changes.
    import('../../../openai.js').then(module=>{openai=module;queueRefresh();}).catch(error=>console.warn('[白水预设搜索] 内容索引不可用，只搜索名称',error));
}
export function onDisable() {
    running=false;
    observer?.disconnect();observer=null;
    for(const remove of listeners.splice(0)) remove();
    for(const [type,fn] of subscriptions.splice(0)) ctx?.eventSource?.removeListener?.(type,fn);
    clearTimeout(restoreTimer);themeGallery?.destroy();themeGallery=null;document.body.classList.remove('bs-pc-protect');
    document.querySelectorAll('.bs-pc-hidden').forEach(el=>el.classList.remove('bs-pc-hidden'));
    for(const list of sortableStates.keys()) toggleSorting(list,false);
    document.querySelectorAll('.bs-pc-search,.bs-pc-message,#bs-pc-settings').forEach(el=>el.remove());
}
export function onEnable() { init(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
