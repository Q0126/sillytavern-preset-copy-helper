// SillyTavern UI extension. No request interception, prompt mutation or chat writes.
const KEY = 'baishui_preset_copy';
const defaults = { search: true, protect: true, buttons: true };
const LIST = '[id$="prompt_manager_list"]';
const BODY = '#chat .mes .mes_text';
const EXCLUDE = 'script,style,button,input,textarea,select,iframe,svg,[hidden],[contenteditable="true"],.code-copy,.copy-code-button,.bs-pc-message';
let ctx, settings, openai, observer, scheduled = false, searchQuery = '', running = false;
let activeDialog = null, savedRange = null, touchScroll = null, restoreTimer;
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
    if (settings.buttons) for (const mes of document.querySelectorAll('#chat .mes')) {
        if (!mes.querySelector('.mes_text') || mes.querySelector('.bs-pc-message')) continue;
        const host = mes.querySelector('.extraMesButtons') ?? mes.querySelector('.mes_buttons') ?? mes.querySelector('.mes_block') ?? mes;
        const button = element('button', { type:'button', className:'menu_button bs-pc-message', title:'正文连续选择：固定起点，跨屏滚动后选择终点' }, '连续选择');
        button.addEventListener('click', () => openCopy(mes.querySelector('.mes_text')));
        host.append(button);
    }
    for (const button of document.querySelectorAll('.bs-pc-message')) button.hidden = !settings.buttons;
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
    if (!settings.protect || activeDialog || inEditor(document.activeElement)) return;
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
    if (!settings.protect || activeDialog || touchScroll) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) { savedRange = null; return; }
    const range = sel.getRangeAt(0);
    savedRange = bodyFor(range.startContainer) && bodyFor(range.endContainer) ? range.cloneRange() : null;
}
function restoreSelection() {
    if (!touchScroll?.moved || !touchScroll.scrolled || !savedRange?.startContainer?.isConnected || !savedRange?.endContainer?.isConnected || activeDialog || inEditor(document.activeElement)) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange.cloneRange());
}

async function writeClipboard(text, status) {
    try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(text);
        status.textContent = `已复制 ${[...text].length} 字`;
        return;
    } catch { /* HTTP / Android fallback; keep it inside the modal. */ }
    const textarea = element('textarea', { value:text, readOnly:true });
    textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;';
    activeDialog.append(textarea);
    textarea.focus(); textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Manual fallback below. */ }
    textarea.remove();
    if (copied) { status.textContent = `已复制 ${[...text].length} 字`; return; }
    const manual = element('textarea', { className:'bs-pc-manual', value:text, readOnly:true });
    manual.setAttribute('aria-label', '待复制正文，请长按复制');
    const scroll = activeDialog.querySelector('.bs-pc-scroll');
    scroll.replaceChildren(manual);
    manual.focus(); manual.select();
    status.textContent = '浏览器未允许自动复制，请长按文本框复制';
}

function openCopy(body) {
    if (!body) return;
    activeDialog?.close();
    const text = plainText(body.cloneNode(true)).trim();
    if (!text) return;
    const previousFocus = document.activeElement;
    const dialog = element('dialog', { className:'bs-pc-dialog', 'ariaLabel':'正文连续选择' });
    const head = element('div', { className:'bs-pc-head' });
    const title = element('div');
    const close = element('button', { type:'button', ariaLabel:'关闭' }, '关闭');
    title.append(element('strong', {}, '正文连续选择'), close);
    const help = element('p', {}, '点“起点”后点文字，再点“终点”后点文字；中途可正常上下滑动，选区会保留。也可开启拖选，拖到边缘自动滚动。');
    const tools = element('div', { className:'bs-pc-tools' });
    const startButton = element('button', { type:'button' }, '起点');
    const endButton = element('button', { type:'button' }, '终点');
    const dragButton = element('button', { type:'button' }, '拖动选择');
    const all = element('button', { type:'button' }, '全选');
    const back = element('button', { type:'button', title:'向前调整一个字符' }, '← 一字');
    const forward = element('button', { type:'button', title:'向后调整一个字符' }, '一字 →');
    tools.append(startButton, endButton, dragButton, all, back, forward);
    head.append(title, help, tools);
    const scroll = element('div', { className:'bs-pc-scroll', tabIndex:0 });
    const content = element('div', { className:'bs-pc-content' });
    scroll.append(content);
    const foot = element('div', { className:'bs-pc-foot' });
    const status = element('output', { ariaLive:'polite' });
    const copy = element('button', { type:'button', className:'bs-pc-copy' }, '复制选中');
    foot.append(status, copy); dialog.append(head, scroll, foot);
    let start = 0, end = text.length, mode = 'end', pointer = null, raf = 0;
    function render() {
        const scrollTop = scroll.scrollTop;
        const lo = Math.min(start, end), hi = Math.max(start, end);
        content.replaceChildren(document.createTextNode(text.slice(0,lo)), element('mark', {}, text.slice(lo,hi)), document.createTextNode(text.slice(hi)));
        status.textContent = `已选 ${[...text.slice(lo,hi)].length} 字`;
        startButton.setAttribute('aria-pressed', String(mode === 'start'));
        endButton.setAttribute('aria-pressed', String(mode === 'end'));
        dragButton.setAttribute('aria-pressed', String(mode === 'drag'));
        content.classList.toggle('bs-pc-drag', mode === 'drag');
        scroll.scrollTop = scrollTop;
    }
    function offsetAt(x, y) {
        const pos = document.caretPositionFromPoint?.(x,y);
        const caret = pos ? { startContainer:pos.offsetNode, startOffset:pos.offset } : document.caretRangeFromPoint?.(x,y);
        if (!caret || !content.contains(caret.startContainer)) return null;
        const r = document.createRange();
        r.selectNodeContents(content); r.setEnd(caret.startContainer, caret.startOffset);
        return Math.min(text.length, r.toString().length);
    }
    function moveAt(x,y) { const n = offsetAt(x,y); if (n !== null) { end=n; render(); } }
    function autoScroll() {
        if (!pointer || mode !== 'drag') return;
        const box = scroll.getBoundingClientRect();
        const speed = pointer.y < box.top+48 ? -Math.min(18,(box.top+48-pointer.y)/3) : pointer.y > box.bottom-48 ? Math.min(18,(pointer.y-box.bottom+48)/3) : 0;
        if (speed) { scroll.scrollTop += speed; moveAt(Math.min(box.right-20, Math.max(box.left+20,pointer.x)),Math.min(box.bottom-12,Math.max(box.top+12,pointer.y))); }
        raf = requestAnimationFrame(autoScroll);
    }
    content.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        pointer = { id:e.pointerId, x:e.clientX, y:e.clientY, initialX:e.clientX, initialY:e.clientY };
        if (mode === 'drag') {
            e.preventDefault(); content.setPointerCapture(e.pointerId);
            const n = offsetAt(e.clientX,e.clientY); if (n !== null) { start=n; end=n; render(); }
            raf = requestAnimationFrame(autoScroll);
        }
    });
    content.addEventListener('pointermove', e => {
        if (!pointer || pointer.id !== e.pointerId) return;
        pointer.x=e.clientX; pointer.y=e.clientY;
        if (mode === 'drag') { e.preventDefault(); moveAt(e.clientX,e.clientY); }
    });
    function finish(e) {
        if (!pointer || e.pointerId !== pointer.id) return;
        if (e.type === 'pointerup' && mode !== 'drag' && Math.hypot(e.clientX-pointer.initialX,e.clientY-pointer.initialY)<9) {
            const n = offsetAt(e.clientX,e.clientY);
            if (n !== null) { if (mode === 'start') start=n; else end=n; render(); }
        }
        pointer=null; cancelAnimationFrame(raf);
    }
    content.addEventListener('pointerup', finish); content.addEventListener('pointercancel', finish);
    function action(button, handler) {
        let touchTime=-Infinity;
        // A mobile browser may consume the first CLICK after inertial scrolling.
        // Handle touch pointerdown directly, and suppress its compatibility click.
        button.addEventListener('pointerdown', e => {
            if(e.pointerType==='touch') { e.preventDefault(); touchTime=performance.now(); handler(); }
        });
        button.addEventListener('click', e => { if(e.detail===0 || performance.now()-touchTime>700) handler(); });
    }
    action(startButton,() => { mode='start'; render(); });
    action(endButton,() => { mode='end'; render(); });
    action(dragButton,() => { mode=mode==='drag'?'end':'drag'; render(); });
    action(all,() => { start=0; end=text.length; render(); });
    function step(direction) {
        const key = mode==='start'?'start':'end';
        let value = key==='start'?start:end;
        // Avoid splitting UTF-16 surrogate pairs, e.g. emoji.
        const part = direction<0 ? [...text.slice(0,value)].at(-1) : [...text.slice(value)][0];
        value = Math.max(0,Math.min(text.length,value+direction*(part?.length??0)));
        if (key==='start') start=value; else end=value;
        render();
    }
    action(back,() => step(-1)); action(forward,() => step(1));
    action(copy,() => { const value=text.slice(Math.min(start,end),Math.max(start,end)); if(value) void writeClipboard(value,status); else status.textContent='先选择一些正文'; });
    action(close,() => dialog.close());
    dialog.addEventListener('close', () => { pointer=null; cancelAnimationFrame(raf); dialog.remove(); if(activeDialog===dialog) activeDialog=null; previousFocus?.focus?.({preventScroll:true}); }, {once:true});
    document.body.append(dialog); activeDialog=dialog; render(); dialog.showModal();
}

function applySettings() { document.body.classList.toggle('bs-pc-protect', settings.protect); }
function mountSettings() {
    const host = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!host || document.getElementById('bs-pc-settings')) return;
    const panel = element('div', { id:'bs-pc-settings', className:'bs-pc-settings' });
    const drawer=element('details'); drawer.append(element('summary',{},'白水 · 预设搜索与正文复制'));
    for(const [key,label] of [['search','预设条目关键词搜索'],['protect','正文复制保护与滚动选区保留'],['buttons','显示“连续选择”按钮']]) {
        const line=element('label'); const input=element('input',{type:'checkbox',checked:settings[key]});
        input.onchange=()=>{settings[key]=input.checked;save();}; line.append(input,document.createTextNode(label)); drawer.append(line);
    }
    drawer.append(element('small',{},'原生长按由浏览器控制；跨屏选区仍跳动时，请用每条消息旁的“连续选择”。正文指消息文字区域，不含顶栏、消息工具和输入框；不读取 iframe 内容。'));
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
    applySettings(); mountSettings(); refresh();
    observer=new MutationObserver(records=>{
        // Child-list only: filter class/style changes must not trigger a refresh loop.
        if(records.some(r=>r.target.nodeType===1 && !r.target.closest('.bs-pc-search,.bs-pc-dialog') && !r.target.closest('.mes_text') && (r.target.closest('#completion_prompt_manager,#chat') || [...r.addedNodes].some(n=>n.nodeType===1 && (n.matches?.(LIST+',#chat,#completion_prompt_manager') || n.querySelector?.(LIST)))))) queueRefresh();
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
    clearTimeout(restoreTimer);activeDialog?.close();document.body.classList.remove('bs-pc-protect');
    document.querySelectorAll('.bs-pc-hidden').forEach(el=>el.classList.remove('bs-pc-hidden'));
    for(const list of sortableStates.keys()) toggleSorting(list,false);
    document.querySelectorAll('.bs-pc-search,.bs-pc-message,#bs-pc-settings').forEach(el=>el.remove());
}
export function onEnable() { init(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
