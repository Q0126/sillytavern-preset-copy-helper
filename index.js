import { createThemeGallery } from './theme-gallery.js?v=1.8.1';
import { createPresetTools } from './preset-tools.js?v=1.8.1';
import { createWorldbookTools } from './worldbook-tools.js?v=1.8.1';
// SillyTavern UI extension. Data changes require explicit management actions.
const KEY = 'baishui_preset_copy';
const VERSION = '1.8.1';
const defaults = { search: true, protect: true, themeGallery: true, worldBooks: true };
const LIST = '[id$="prompt_manager_list"]';
const BODY = '#chat .mes .mes_text';
const EXCLUDE = 'script,style,button,input,textarea,select,iframe,svg,[hidden],[contenteditable="true"],.code-copy,.copy-code-button,.bs-pc-message';
let ctx, settings, observer, scheduled = false, running = false;
let presetTools = null;
let worldbookTools = null;
let themeGallery = null, savedRange = null, touchScroll = null, restoreTimer;
const listeners = [], subscriptions = [];

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
function refresh() {
    mountSettings();
    presetTools?.refresh();
    worldbookTools?.refresh();
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
    if (!host) return;
    const existing = document.getElementById('bs-pc-settings');
    if (existing?.dataset.version === VERSION) return;
    existing?.remove();
    const panel = element('div', { id:'bs-pc-settings', className:'extension_container bs-pc-settings' });
    panel.dataset.version = VERSION;
    const drawer = element('div', { className:'inline-drawer' });
    const header = element('div', { className:'inline-drawer-toggle inline-drawer-header', role:'button', tabIndex:0 });
    const content = element('div', { className:'inline-drawer-content', id:'bs-pc-settings-content' });
    header.setAttribute('aria-controls', content.id);
    const heading = element('span');
    heading.append(element('b', {}, '白水水'), element('small', { className:'bs-pc-version' }, `v${VERSION}`));
    header.append(heading, element('div', { className:'inline-drawer-icon fa-solid fa-circle-chevron-down down' }));
    // SillyTavern owns the click handler and animation for native inline drawers.
    header.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); header.click(); }
    });
    for(const [key,label] of [['search','预设管理与滑条防误触'],['worldBooks','世界书管理'],['protect','正文复制保护与滚动选区保留'],['themeGallery','美化预览、标签与搜索']]) {
        const line=element('label', { className:'checkbox_label' }); const input=element('input',{type:'checkbox',checked:settings[key]});
        input.onchange=()=>{settings[key]=input.checked;save();}; line.append(input,element('span', {}, label)); content.append(line);
    }
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
    presetTools = createPresetTools({ context:ctx, settings, onRefresh:queueRefresh });
    worldbookTools = createWorldbookTools({ context:ctx, settings, onRefresh:queueRefresh });
    themeGallery = createThemeGallery({ context:ctx, settings, onSave:() => ctx.saveSettingsDebounced?.() });
    applySettings(); mountSettings(); refresh();
    observer=new MutationObserver(records=>{
        // Child-list only: filter class/style changes must not trigger a refresh loop.
        if(records.some(r=>r.target.nodeType===1 && !r.target.closest('.bs-pc-search,.bs-preset-modal,.bs-theme-modal,.bs-theme-launch,.bs-world-launch') && !r.target.closest('.mes_text') && (r.target.closest('#completion_prompt_manager,#chat,#UI-presets-block,#WorldInfo') || [...r.addedNodes].some(n=>n.nodeType===1 && (n.matches?.(LIST+',#chat,#completion_prompt_manager,#themes,#UI-presets-block,#settings_preset_openai,#world_editor_select,#world_info') || n.querySelector?.(LIST+',#settings_preset_openai,#world_editor_select,#world_info')))))) queueRefresh();
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
    const refreshEvents=['CHAT_CHANGED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_EDITED','MESSAGE_SWIPED','GENERATION_ENDED','PRESET_CHANGED','OAI_PRESET_CHANGED_AFTER','SETTINGS_UPDATED','WORLDINFO_UPDATED','WORLDINFO_SETTINGS_UPDATED','CHARACTER_EDITED','CHARACTER_DELETED','CHARACTER_RENAMED','CHARACTER_CREATED'];
    for(const name of refreshEvents){const type=ctx.eventTypes?.[name] ?? ctx.event_types?.[name];if(type && ctx.eventSource?.on){ctx.eventSource.on(type,queueRefresh);subscriptions.push([type,queueRefresh]);}}

}
export function onDisable() {
    running=false;
    observer?.disconnect();observer=null;
    for(const remove of listeners.splice(0)) remove();
    for(const [type,fn] of subscriptions.splice(0)) ctx?.eventSource?.removeListener?.(type,fn);
    clearTimeout(restoreTimer);presetTools?.destroy();presetTools=null;worldbookTools?.destroy();worldbookTools=null;themeGallery?.destroy();themeGallery=null;document.body.classList.remove('bs-pc-protect');
    document.querySelectorAll('.bs-pc-search,.bs-pc-message,#bs-pc-settings').forEach(el=>el.remove());
}
export function onEnable() { init(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
