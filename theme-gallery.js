// Theme browser: applies via the existing #themes change handler, never rewrites themes.
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
const el = (tag, props={}, text) => { const node=document.createElement(tag);Object.assign(node,props);if(text!==undefined)node.textContent=text;return node; };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const previewCSS = theme => String(theme.custom_css ?? '').replace(/<\//g,'<\\/');

function previewDocument(theme) {
    const vars={SmartThemeBodyColor:theme.main_text_color??'#edeef6',SmartThemeEmColor:theme.italics_text_color??theme.main_text_color??'#bac6df',SmartThemeQuoteColor:theme.quote_text_color??theme.main_text_color??'#b4c6e8',SmartThemeBlurTintColor:theme.blur_tint_color??'#292e42',SmartThemeChatTintColor:theme.chat_tint_color??'#252a39',SmartThemeUserMesBlurTintColor:theme.user_mes_blur_tint_color??'transparent',SmartThemeBotMesBlurTintColor:theme.bot_mes_blur_tint_color??'transparent',SmartThemeBorderColor:theme.border_color??'#969db74d',SmartThemeShadowColor:theme.shadow_color??'#0007'};
    const variables=Object.entries(vars).map(([key,value])=>`--${key}:${String(value).replace(/[;{}<>]/g,'')};`).join('');
    const links=[...document.querySelectorAll('link[rel="stylesheet"]')].filter(link=>/\/(?:style\.css|css\/(?:mobile-styles|fontawesome\.min|solid\.min)\.css)$/.test(new URL(link.href).pathname)).map(link=>`<link rel="stylesheet" href="${escapeHTML(link.href)}">`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' http: https:; img-src data: blob: http: https:; font-src data: http: https:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">${links}<style>
    :root{${variables}--fontScale:1;--mainFontSize:16px;--chatWidth:100%;--blurStrength:0px;--avatar-base-width:44px;--avatar-base-height:44px}
    *{box-sizing:border-box}html,body{margin:0;width:390px;height:680px;overflow:hidden}body{font:16px/1.6 system-ui,sans-serif;color:var(--SmartThemeBodyColor);background:var(--SmartThemeChatTintColor)}
    #top-bar{position:relative;inset:auto;width:100%;height:52px;display:flex;align-items:center;justify-content:space-around;background:var(--SmartThemeBlurTintColor);border-bottom:1px solid var(--SmartThemeBorderColor)}.drawer-icon{font-size:20px}
    #sheld{position:relative;inset:auto;width:100%;height:628px;max-height:none;display:flex;flex-direction:column;margin:0}#chat{position:relative;inset:auto;display:block;flex:1;width:100%;height:auto;min-height:0;overflow:hidden;padding:18px 14px;background:var(--SmartThemeChatTintColor)}
    .mes{display:flex;position:relative;gap:12px;width:100%;padding:16px 4px;margin:0 0 18px;border-bottom:1px solid var(--SmartThemeBorderColor);background:var(--SmartThemeBotMesBlurTintColor)}.mes[is_user="true"]{background:var(--SmartThemeUserMesBlurTintColor)}.avatar{width:44px;height:44px;min-width:44px;border-radius:50%;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);display:grid;place-items:center;font-size:23px;overflow:hidden}.mes_block{min-width:0;flex:1}.ch_name{display:flex;justify-content:space-between;gap:8px;font-size:14px;margin-bottom:10px}.mes_buttons,.timestamp{font-size:11px;opacity:.6}.mes_text{padding:0;white-space:normal;font-size:16px;line-height:1.85}.mes_text p{margin:0 0 12px}em{color:var(--SmartThemeEmColor)}q{color:var(--SmartThemeQuoteColor)}
    #send_form{position:relative;inset:auto;width:100%;min-height:62px;display:flex;align-items:center;gap:10px;padding:10px;background:var(--SmartThemeBlurTintColor);border-top:1px solid var(--SmartThemeBorderColor)}#send_textarea{flex:1;min-width:0;border:1px solid var(--SmartThemeBorderColor);border-radius:10px;padding:10px;color:inherit;background:transparent;font:inherit}#send_but{font-size:23px}
    </style><style>${previewCSS(theme)}</style></head><body class="${theme.chat_display===1?'bubblechat':theme.chat_display===2?'documentstyle':''}"><div id="bg1"></div><div id="bg_custom"></div><div id="top-bar"><div class="drawer"><span class="drawer-icon fa-solid fa-sliders">☷</span></div><div class="drawer"><span class="drawer-icon">♧</span></div><div class="drawer"><span class="drawer-icon">✦</span></div><div class="drawer"><span class="drawer-icon">☰</span></div></div><div id="sheld"><div id="chat"><div class="mes" is_user="false" ch_name="角色" mesid="0"><div class="avatar">✧</div><div class="mes_block"><div class="ch_name"><b class="name_text">角色</b><span class="mes_buttons">⋯　✎</span></div><div class="mes_text"><p>午后的风穿过窗边，书页轻轻翻动。</p><p><q>今天想聊些什么？</q></p><p><em>这是一段美化示意文字。</em></p></div></div></div><div class="mes" is_user="true" ch_name="你" mesid="1"><div class="avatar">☁</div><div class="mes_block"><div class="ch_name"><b class="name_text">你</b><span class="timestamp">14:30</span></div><div class="mes_text"><p>就从这一刻开始吧。</p></div></div></div><div class="mes" is_user="false" ch_name="角色" mesid="2"><div class="avatar">✧</div><div class="mes_block"><div class="ch_name"><b class="name_text">角色</b><span class="mes_buttons">⋯　✎</span></div><div class="mes_text"><p>配色、文字与对话的模样，都在这里。</p></div></div></div></div><div id="send_form"><span>☰</span><div id="send_textarea" class="text_pole">发送一条消息…</div><span id="send_but">➤</span></div></div></body></html>`;
}

let dbPromise;
function coverDB() {
    dbPromise ??= new Promise((resolve,reject)=>{
        const request=indexedDB.open('baishui-theme-covers',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('covers');
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    }).catch(error=>{dbPromise=null;throw error;});
    return dbPromise;
}
async function coverStore(key,operation,value) {
    const db=await coverDB();
    return new Promise((resolve,reject)=>{
        const transaction=db.transaction('covers',operation==='get'?'readonly':'readwrite');
        const store=transaction.objectStore('covers');
        const request=operation==='get'?store.get(key):operation==='put'?store.put(value,key):store.delete(key);
        let result;request.onsuccess=()=>{result=request.result;};
        transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
    });
}
async function compressCover(file) {
    if(!file.type.startsWith('image/'))throw Error('请选择图片');
    if(file.size>15*1024*1024)throw Error('请选择小于 15 MB 的图片');
    const bitmap=await createImageBitmap(file);
    try {
        const scale=Math.min(1,1100/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片处理失败')),'image/jpeg',.84));
    }finally{bitmap.close();}
}

export function createThemeGallery({context,settings,onSave}) {
    let native=null,launch=null,modal=null,cache=[],dirty=true,pending=null,disposed=false;
    let query='',tagFilter='',detailName=null,lazy=null;
    let optionObserver=null,modalObserver=null;
    const urls=new Set(),previewCleanups=new Set();
    if(!Array.isArray(settings.themeMeta))settings.themeMeta=[];
    const getMeta=name=>settings.themeMeta.find(item=>item?.name===name)??{name,tags:[]};
    const tagsOf=name=>Array.isArray(getMeta(name).tags)?getMeta(name).tags.filter(tag=>typeof tag==='string'):[];
    const names=()=>native?[...native.options].filter(option=>!option.disabled&&option.value).map(option=>({name:option.value,label:option.textContent??option.value})):[];
    const coverKey=name=>settings.coverNamespace?`${settings.coverNamespace}:${name}`:null;
    function saveTags(name,text) {
        const tags=[...new Set(text.split(/[,，、\n]+/).map(tag=>tag.trim().slice(0,32)).filter(Boolean))].slice(0,20);
        const index=settings.themeMeta.findIndex(item=>item?.name===name);
        if(index<0)settings.themeMeta.push({name,tags});else settings.themeMeta[index]={...settings.themeMeta[index],tags};
        onSave();
    }
    function cleanupPreviews() {
        lazy?.disconnect();lazy=null;
        for(const cleanup of previewCleanups)cleanup();previewCleanups.clear();
        for(const url of urls)URL.revokeObjectURL(url);urls.clear();
    }
    async function loadThemes(force=false) {
        if(!force&&!dirty&&cache.length)return cache;
        if(pending)return pending;
        pending=(async()=>{
            const response=await fetch('/api/settings/get',{method:'POST',headers:context.getRequestHeaders(),body:'{}',cache:'no-cache'});
            if(!response.ok)throw Error(`读取美化失败（${response.status}）`);
            const data=await response.json();
            if(!Array.isArray(data.themes))throw Error('此酒馆版本没有返回美化数据');
            cache=data.themes.filter(theme=>theme&&typeof theme.name==='string');dirty=false;
            return cache;
        })().finally(()=>{pending=null;});
        return pending;
    }
    function selectedName() { return native?.selectedOptions?.[0]?.textContent||native?.value||'选择美化'; }
    function refresh() {
        if(disposed)return;
        const current=document.querySelector('select#themes');
        if(current!==native) {
            optionObserver?.disconnect();native?.classList.remove('bs-theme-native-hidden');launch?.remove();native=current;
            if(native) {
                launch=el('button',{type:'button',id:'bs-theme-launch',className:'menu_button bs-theme-launch'});
                launch.setAttribute('aria-haspopup','dialog');launch.onclick=open;
                native.after(launch);
                optionObserver=new MutationObserver(()=>{dirty=true;refresh();});optionObserver.observe(native,{childList:true,subtree:true});
            }
        }
        if(!native)return;
        const enabled=!!settings.themeGallery;
        native.classList.toggle('bs-theme-native-hidden',enabled);launch.hidden=!enabled;
        launch.replaceChildren(el('span',{},selectedName()),el('span',{className:'bs-theme-grid-icon',ariaHidden:'true'},'▦'));
        launch.title='打开美化预览，按名字或标签搜索';
        if(!enabled)modal?.close();
    }
    function onChange(event) {
        if(event.target===native)refresh();
        if(event.target?.id==='ui_preset_import_file')dirty=true;
    }
    function onClick(event) { if(event.target.closest?.('#ui-preset-update-button,#ui-preset-save-button,#ui-preset-delete-button'))dirty=true; }
    document.addEventListener('change',onChange);document.addEventListener('click',onClick,true);
    function populatePreview(host,name) {
        const theme=cache.find(item=>item.name===name);
        let gone=false,resize=null,ownURL=null;
        const clear=()=>{gone=true;resize?.disconnect();if(ownURL){URL.revokeObjectURL(ownURL);urls.delete(ownURL);}host.replaceChildren();};
        previewCleanups.add(clear);
        const builtIn=()=>{
            if(gone||!host.isConnected)return;
            if(!theme){host.append(el('span',{className:'bs-theme-no-preview'},'暂无预览\n可上传封面'));return;}
            const frame=el('iframe',{title:`${name} 示意预览`,tabIndex:-1,referrerPolicy:'no-referrer'});
            frame.setAttribute('sandbox','');frame.setAttribute('aria-hidden','true');
            frame.srcdoc=previewDocument(theme);host.append(frame);
            const scale=()=>{if(!gone)frame.style.transform=`scale(${host.clientWidth/390})`;};
            resize=new ResizeObserver(scale);resize.observe(host);scale();
        };
        const key=coverKey(name);
        if(key)coverStore(key,'get').then(blob=>{
            if(gone||!host.isConnected)return;
            if(blob){ownURL=URL.createObjectURL(blob);urls.add(ownURL);host.append(el('img',{src:ownURL,alt:`${name} 自定义封面`,loading:'lazy'}));}else builtIn();
        }).catch(()=>builtIn());else builtIn();
        return clear;
    }
    function makePreview(name) {
        const host=el('div',{className:'bs-theme-thumb'});host.dataset.theme=name;
        return host;
    }
    async function open() {
        if(modal||disposed)return;
        query='';tagFilter='';detailName=null;
        const previousFocus=document.activeElement;
        modal=el('dialog',{className:'bs-theme-modal',ariaLabel:'美化预览与分类'});
        const header=el('div',{className:'bs-theme-header'}),heading=el('div',{className:'bs-theme-heading'});
        heading.append(el('strong',{},'美化收藏架'),el('small',{},'白水杂货铺'));
        const close=el('button',{type:'button',className:'menu_button bs-theme-close',ariaLabel:'关闭美化收藏架'},'关闭');close.onclick=()=>modal.close();header.append(heading,close);
        const tools=el('div',{className:'bs-theme-search-row'}),search=el('input',{type:'search',className:'text_pole',placeholder:'搜索美化名称或 tag…'});
        search.setAttribute('aria-label','搜索美化名称或标签');
        search.oninput=()=>{query=search.value;renderGrid();};
        const reload=el('button',{type:'button',className:'menu_button'},'刷新');
        reload.onclick=async()=>{reload.disabled=true;status.textContent='正在刷新…';try{await loadThemes(true);if(modal)renderGrid();}catch(error){status.textContent=error.message;}finally{reload.disabled=false;}};
        tools.append(search,reload);
        const tags=el('div',{className:'bs-theme-filters',ariaLabel:'标签分类'});
        const status=el('small',{className:'bs-theme-status',role:'status'},'正在读取美化…');
        const scroll=el('div',{className:'bs-theme-scroll'}),grid=el('div',{className:'bs-theme-grid'}),detail=el('div',{className:'bs-theme-detail',hidden:true});scroll.append(grid,detail);
        const footer=el('small',{className:'bs-theme-note'},'自动生成的是示意预览；可上传实际截图作为封面。点击卡片查看大图、管理标签或应用。');
        modal.append(header,tools,tags,status,scroll,footer);
        const dialog=modal;
        dialog.addEventListener('close',()=>{cleanupPreviews();modalObserver?.disconnect();modalObserver=null;dialog.remove();if(modal===dialog)modal=null;previousFocus?.focus?.({preventScroll:true});},{once:true});
        document.body.append(dialog);dialog.showModal();
        // Opening and searching never changes the real UI theme.
        function renderFilters() {
            const all=[...new Set(names().flatMap(item=>tagsOf(item.name)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
            if(tagFilter&&!all.includes(tagFilter))tagFilter='';
            tags.replaceChildren();
            for(const name of ['',...all]) {
                const button=el('button',{type:'button',className:'bs-theme-tag-filter'},name||'全部');
                button.setAttribute('aria-pressed',String(name===tagFilter));button.onclick=()=>{tagFilter=name;renderGrid();};tags.append(button);
            }
        }
        function renderGrid() {
            if(modal!==dialog)return;
            cleanupPreviews();detailName=null;grid.hidden=false;detail.hidden=true;tools.hidden=false;tags.hidden=false;footer.hidden=false;scroll.scrollTop=0;
            renderFilters();
            const terms=normalize(query).trim().split(/\s+/).filter(Boolean),all=names();
            const shown=all.filter(item=>(!tagFilter||tagsOf(item.name).includes(tagFilter))&&terms.every(term=>normalize([item.label,...tagsOf(item.name)].join(' ')).includes(term)));
            status.textContent=`${shown.length} / ${all.length} 套美化`;
            grid.replaceChildren();
            lazy=new IntersectionObserver(entries=>{
                for(const entry of entries) {
                    const host=entry.target;
                    if(entry.isIntersecting&&!host._bsCleanup)host._bsCleanup=populatePreview(host,host.dataset.theme);
                    else if(!entry.isIntersecting&&host._bsCleanup){host._bsCleanup();previewCleanups.delete(host._bsCleanup);host._bsCleanup=null;}
                }
            },{root:scroll,rootMargin:'200px'});
            for(const item of shown) {
                const card=el('button',{type:'button',className:'bs-theme-card'});card.dataset.theme=item.name;
                card.classList.toggle('bs-theme-active',item.name===native.value);card.setAttribute('aria-label',`预览 ${item.label}`);
                const thumb=makePreview(item.name),caption=el('div',{className:'bs-theme-caption'}),name=el('strong',{},item.label);
                caption.append(name);
                const chips=el('div',{className:'bs-theme-tags'});for(const tag of tagsOf(item.name))chips.append(el('span',{},tag));caption.append(chips);
                if(item.name===native.value)caption.append(el('small',{className:'bs-theme-current'},'当前使用'));
                card.append(thumb,caption);card.onclick=()=>renderDetail(item);grid.append(card);lazy.observe(thumb);
            }
            if(!shown.length)grid.append(el('p',{className:'bs-theme-empty'},'没有找到匹配的美化，试试其他名称或标签。'));
        }
        async function renderDetail(item) {
            cleanupPreviews();detailName=item.name;grid.hidden=true;detail.hidden=false;tools.hidden=true;tags.hidden=true;footer.hidden=true;scroll.scrollTop=0;
            status.textContent='先预览，点击“应用美化”才会切换';
            detail.replaceChildren();
            const back=el('button',{type:'button',className:'menu_button'},'← 返回列表');back.onclick=renderGrid;
            const title=el('h3',{},item.label),preview=makePreview(item.name);preview.classList.add('bs-theme-large-preview');
            const label=el('label',{className:'bs-theme-tag-label'},'自定义标签（用逗号分隔）'),input=el('input',{type:'text',className:'text_pole',value:tagsOf(item.name).join('，'),placeholder:'例如：手机，日间，清新'});
            const inputId='bs-theme-tags-input';input.id=inputId;label.htmlFor=inputId;
            const save=el('button',{type:'button',className:'menu_button'},'保存标签');save.onclick=()=>{saveTags(item.name,input.value);input.value=tagsOf(item.name).join('，');status.textContent='标签已保存，可按名称或标签搜索';};
            const actions=el('div',{className:'bs-theme-actions'}),apply=el('button',{type:'button',className:'menu_button bs-theme-apply'},'应用美化');
            apply.onclick=()=>{
                if(![...native.options].some(option=>option.value===item.name)){status.textContent='此美化已被删除，请刷新列表';return;}
                native.value=item.name;
                // Core binds jQuery change; triggering it also updates power_user and persists selection.
                if(window.jQuery)window.jQuery(native).trigger('change');else native.dispatchEvent(new Event('change',{bubbles:true}));
                refresh();dialog.close();
            };
            const upload=el('button',{type:'button',className:'menu_button'},'上传预览封面'),reset=el('button',{type:'button',className:'menu_button'},'恢复示意预览'),file=el('input',{type:'file',accept:'image/*',hidden:true});
            upload.onclick=()=>file.click();
            file.onchange=async()=>{
                const image=file.files?.[0];if(!image)return;upload.disabled=true;
                try {
                    const blob=await compressCover(image);
                    if(!settings.coverNamespace){settings.coverNamespace=crypto.randomUUID?.()??`cover-${Date.now()}-${Math.random()}`;onSave();}
                    await coverStore(coverKey(item.name),'put',blob);
                    if(modal===dialog&&detailName===item.name){await renderDetail(item);status.textContent='封面已保存到此浏览器';}
                }catch(error){status.textContent=error.message||'封面保存失败';}finally{upload.disabled=false;file.value='';}
            };
            reset.onclick=async()=>{try{const key=coverKey(item.name);if(key)await coverStore(key,'delete');if(modal===dialog&&detailName===item.name){await renderDetail(item);status.textContent='已恢复自动示意预览';}}catch{status.textContent='无法移除封面，请稍后重试';}};
            actions.append(save,apply,upload,reset);detail.append(back,title,preview,label,input,actions,file,el('small',{className:'bs-theme-cover-note'},'标签随酒馆设置保存；上传的封面保存在当前浏览器。示意画面使用示例文字，不读取聊天。'));
            populatePreview(preview,item.name);
        }
        // Keep closures alive only for this modal, and release resources on close.
        modalObserver=new MutationObserver(()=>{if(detailName===null&&modal===dialog)renderGrid();});
        if(native)modalObserver.observe(native,{childList:true,subtree:true});
        try{await loadThemes();if(modal===dialog)renderGrid();}catch(error){if(modal===dialog){status.textContent=`${error.message}。仍可管理标签、上传封面和应用美化。`;renderGrid();status.textContent='美化数据读取失败：可刷新重试；仍可使用自定义封面与标签';}}
    }
    return {refresh,destroy(){disposed=true;modal?.close();optionObserver?.disconnect();modalObserver?.disconnect();cleanupPreviews();document.removeEventListener('change',onChange);document.removeEventListener('click',onClick,true);native?.classList.remove('bs-theme-native-hidden');launch?.remove();}};
}
