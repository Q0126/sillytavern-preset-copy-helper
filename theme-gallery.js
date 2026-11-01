import { previewDocument, previewSize, activatePreviewFrame, resetPreviewCache } from './theme-preview.js';
import { createCSSHistory } from './css-history.js';
import { createCSSSearch } from './css-search.js';
// Theme browser: applies via the existing #themes change handler, never rewrites themes.
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
const el = (tag, props={}, text) => { const node=document.createElement(tag);Object.assign(node,props);if(text!==undefined)node.textContent=text;return node; };

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
    let native=null,launch=null,historyLaunch=null,modal=null,cache=[],dirty=true,pending=null,disposed=false;
    let query='',tagFilter='',detailName=null,lazy=null,favoritesOnly=false,previewWidth=0;
    let optionObserver=null,modalObserver=null;
    let workFrame=0,searchTimer=0;
    const previewWork=[],liveThumbnails=new Map();
    const urls=new Set(),previewCleanups=new Set();
    if(!Array.isArray(settings.themeMeta))settings.themeMeta=[];
    const getMeta=name=>settings.themeMeta.find(item=>item?.name===name)??{name,tags:[]};
    const tagsOf=name=>Array.isArray(getMeta(name).tags)?getMeta(name).tags.filter(tag=>typeof tag==='string'):[];
    const names=()=>native?[...native.options].filter(option=>!option.disabled&&option.value).map(option=>({name:option.value,label:option.textContent??option.value})):[];
    const history=createCSSHistory({settings,onSave,onUpdate:()=>{}});
    const cssSearch=createCSSSearch();let editorActions=null;
    const favorite=name=>getMeta(name).favorite===true;
    function toggleFavorite(name){const index=settings.themeMeta.findIndex(item=>item?.name===name);if(index<0)settings.themeMeta.push({name,tags:[],favorite:true});else settings.themeMeta[index]={...settings.themeMeta[index],favorite:!favorite(name)};onSave();}
    const coverKey=name=>settings.coverNamespace?`${settings.coverNamespace}:${name}`:null;
    function saveTags(name,text) {
        const tags=[...new Set(text.split(/[,，、\n]+/).map(tag=>tag.trim().slice(0,32)).filter(Boolean))].slice(0,20);
        const index=settings.themeMeta.findIndex(item=>item?.name===name);
        if(index<0)settings.themeMeta.push({name,tags});else settings.themeMeta[index]={...settings.themeMeta[index],tags};
        onSave();
    }
    function cleanupPreviews() {
        lazy?.disconnect();lazy=null;
        cancelAnimationFrame(workFrame);workFrame=0;previewWork.length=0;liveThumbnails.clear();
        for(const cleanup of previewCleanups)cleanup();previewCleanups.clear();
        for(const url of urls)URL.revokeObjectURL(url);urls.clear();
    }
    function queuePreview(task){
        previewWork.push(task);
        const step=()=>{workFrame=0;previewWork.shift()?.();if(previewWork.length)workFrame=requestAnimationFrame(step);};
        if(!workFrame)workFrame=requestAnimationFrame(step);
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
                launch.setAttribute('aria-haspopup','dialog');launch.onclick=()=>open();
                native.after(launch);
                optionObserver=new MutationObserver(()=>{dirty=true;refresh();});optionObserver.observe(native,{childList:true,subtree:true});
            }
        }
        if(!native)return;
        const enabled=!!settings.themeGallery;
        native.classList.toggle('bs-theme-native-hidden',enabled);launch.hidden=!enabled;
        launch.replaceChildren(el('span',{},selectedName()),el('span',{className:'bs-theme-grid-icon',ariaHidden:'true'},'▦'));
        launch.title='打开美化预览，按名字或标签搜索';
        const editor=document.querySelector('#customCSS');
        // The native textarea wrapper is a nowrap flex row. Place tools AFTER that
        // wrapper so buttons cannot squeeze the textarea or collapse to one character.
        const editorAnchor=editor?.closest('#CustomCSS-textAreaBlock')??editor;
        if(editor&&(!historyLaunch?.isConnected||editorActions?.previousElementSibling!==editorAnchor)){editorActions?.remove();editorActions=el('div',{className:'bs-css-editor-actions'});historyLaunch=el('button',{id:'bs-css-history-launch',type:'button',className:'menu_button'},'修改前后对比');historyLaunch.onclick=()=>open(native.value);editorActions.append(historyLaunch);editorAnchor.after(editorActions);}
        if(historyLaunch)historyLaunch.hidden=!enabled;
        if(editor&&editorActions){editorActions.hidden=!enabled;cssSearch.mount(editor,editorActions,enabled);}
        if(!enabled)modal?.close();
    }
    function onChange(event) {
        if(event.target===native){history.sync();refresh();}
        if(event.target?.id==='ui_preset_import_file')dirty=true;
    }
    function onClick(event) { if(event.target.closest?.('#ui-preset-update-button,#ui-preset-save-button,#ui-preset-delete-button'))dirty=true; }
    document.addEventListener('change',onChange);document.addEventListener('click',onClick,true);
    function populatePreview(host,name,override=null,ignoreCover=false) {
        const base=cache.find(item=>item.name===name);
        const currentCSS=document.querySelector('#customCSS');
        const theme=override??(base&&native?.value===name&&currentCSS?{...base,custom_css:currentCSS.value}:base);
        const size=previewSize(name,previewWidth);host.style.aspectRatio=`${size.width}/${size.height}`;
        // Transparent theme canvases must not reveal the gallery's unrelated current skin.
        if(theme?.blur_tint_color)host.style.backgroundColor=theme.blur_tint_color;
        let gone=false,resize=null,ownURL=null,readyTimer=0,activateTimer=0;
        host.dataset.ready='false';host.replaceChildren(el('span',{className:'bs-theme-loading'},'正在加载预览…'));
        const clear=()=>{gone=true;clearTimeout(readyTimer);clearTimeout(activateTimer);resize?.disconnect();if(ownURL){URL.revokeObjectURL(ownURL);urls.delete(ownURL);}host.replaceChildren();};
        previewCleanups.add(clear);
        const builtIn=()=>{
            if(gone||!host.isConnected)return;
            if(!theme){host.replaceChildren(el('span',{className:'bs-theme-no-preview'},'暂无预览\n可上传封面'));return;}
            const frame=el('iframe',{title:`${name} CSS 预览`,tabIndex:-1,referrerPolicy:'no-referrer'});
            // Same-origin assets let the native font files load; scripts remain forbidden.
            frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('aria-hidden','true');
            frame.style.setProperty('--bs-frame-width',`${size.width}px`);frame.style.setProperty('--bs-frame-height',`${size.height}px`);frame.srcdoc=previewDocument(theme,size);host.append(frame);
            const ready=()=>{
                if(gone||!frame.isConnected)return;
                const doc=frame.contentDocument;
                if(doc?.readyState!=='loading'&&doc?.querySelector('#chat')){
                    host.dataset.ready='true';host.querySelector('.bs-theme-loading')?.remove();
                    activateTimer=setTimeout(()=>{if(!gone)activatePreviewFrame(frame);},60);
                }else readyTimer=setTimeout(ready,40);
            };
            readyTimer=setTimeout(ready,0);
            const scroller=host.closest('.bs-theme-scroll');
            const scale=()=>{
                if(gone)return;
                if(host.classList.contains('bs-theme-large-preview')){
                    const offset=scroller?host.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop:90;
                    const height=Math.max(220,(scroller?.clientHeight??innerHeight)-offset-12);
                    const maximum=`${Math.min(390,size.width*height/size.height)}px`;
                    if(host.style.maxWidth!==maximum)host.style.maxWidth=maximum;
                }
                frame.style.transform=`scale(${host.clientWidth/size.width})`;
            };
            resize=new ResizeObserver(scale);resize.observe(host);if(scroller)resize.observe(scroller);scale();
        };
        const key=ignoreCover?null:coverKey(name);
        if(key)coverStore(key,'get').then(blob=>{
            if(gone||!host.isConnected)return;
            if(blob){ownURL=URL.createObjectURL(blob);urls.add(ownURL);host.dataset.ready='true';host.replaceChildren(el('img',{src:ownURL,alt:`${name} 自定义封面`,loading:'lazy'}));}else queuePreview(builtIn);
        }).catch(()=>queuePreview(builtIn));else queuePreview(builtIn);
        return clear;
    }
    function makePreview(name) {
        const host=el('div',{className:'bs-theme-thumb'});host.dataset.theme=name;
        return host;
    }
    async function open(initialCompare=null) {
        if(modal||disposed)return;
        query='';tagFilter='';detailName=null;favoritesOnly=false;
        const previousFocus=document.activeElement;
        modal=el('dialog',{className:'bs-theme-modal',ariaLabel:'美化预览与分类'});
        const header=el('div',{className:'bs-theme-header'}),heading=el('div',{className:'bs-theme-heading'});
        heading.append(el('strong',{},'美化收藏架'),el('small',{},'白水杂货铺'));
        const close=el('button',{type:'button',className:'menu_button bs-theme-close',ariaLabel:'关闭美化收藏架'},'关闭');close.onclick=()=>modal.close();header.append(heading,close);
        const tools=el('div',{className:'bs-theme-search-row'}),search=el('input',{type:'search',className:'text_pole',placeholder:'搜索美化名称或 tag…'});
        search.setAttribute('aria-label','搜索美化名称或标签');
        search.oninput=()=>{query=search.value;clearTimeout(searchTimer);searchTimer=setTimeout(renderGrid,140);};
        const reload=el('button',{type:'button',className:'menu_button'},'刷新');
        reload.onclick=async()=>{reload.disabled=true;status.textContent='正在刷新…';resetPreviewCache();try{await loadThemes(true);if(modal)renderGrid();}catch(error){status.textContent=error.message;}finally{reload.disabled=false;}};
        const width=el('select',{className:'bs-theme-width',ariaLabel:'预览宽度'});for(const [value,label] of [['0','适配设备'],['360','360px'],['390','390px'],['768','768px']])width.append(el('option',{value},label));width.value=String(previewWidth);width.onchange=()=>{previewWidth=Number(width.value);renderGrid();};tools.append(search,width,reload);
        const tags=el('div',{className:'bs-theme-filters',ariaLabel:'标签分类'});
        const status=el('small',{className:'bs-theme-status',role:'status'},'正在读取美化…');
        const scroll=el('div',{className:'bs-theme-scroll'}),grid=el('div',{className:'bs-theme-grid'}),detail=el('div',{className:'bs-theme-detail',hidden:true});scroll.append(grid,detail);
        const footer=el('small',{className:'bs-theme-note'},'按原生消息结构渲染 CSS；可切换预览宽度。点卡片查看大图、收藏、标签与修改对比。');
        modal.append(header,tools,tags,status,scroll,footer);
        const dialog=modal;
        dialog.addEventListener('close',()=>{clearTimeout(searchTimer);cleanupPreviews();modalObserver?.disconnect();modalObserver=null;dialog.remove();if(modal===dialog)modal=null;previousFocus?.focus?.({preventScroll:true});},{once:true});
        document.body.append(dialog);dialog.showModal();
        // Opening and searching never changes the real UI theme.
        function renderFilters() {
            const all=[...new Set(names().flatMap(item=>tagsOf(item.name)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
            if(tagFilter&&!all.includes(tagFilter))tagFilter='';
            tags.replaceChildren();
            const fav=el('button',{type:'button',className:'bs-theme-tag-filter'},'★ 收藏');fav.setAttribute('aria-pressed',String(favoritesOnly));fav.onclick=()=>{favoritesOnly=!favoritesOnly;renderGrid();};tags.append(fav);
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
            const shown=all.filter(item=>(!favoritesOnly||favorite(item.name))&&(!tagFilter||tagsOf(item.name).includes(tagFilter))&&terms.every(term=>normalize([item.label,...tagsOf(item.name)].join(' ')).includes(term)));
            status.textContent=`${shown.length} / ${all.length} 套美化`;
            grid.replaceChildren();
            lazy=new IntersectionObserver(entries=>{
                for(const entry of entries) {
                    const host=entry.target;
                    host._bsVisible=entry.isIntersecting;
                    if(entry.isIntersecting){
                        if(!host._bsCleanup)host._bsCleanup=populatePreview(host,host.dataset.theme);
                        liveThumbnails.delete(host);liveThumbnails.set(host,host._bsCleanup);
                    }
                }
                while(liveThumbnails.size>8){
                    const pair=[...liveThumbnails].find(([host])=>!host._bsVisible)??liveThumbnails.entries().next().value;
                    const [host,cleanup]=pair;cleanup();previewCleanups.delete(cleanup);host._bsCleanup=null;liveThumbnails.delete(host);
                }
            },{root:scroll,rootMargin:'80px'});
            for(const item of shown) {
                const card=el('article',{className:'bs-theme-card'});card.dataset.theme=item.name;
                const opener=el('button',{type:'button',className:'bs-theme-open'});opener.setAttribute('aria-label',`预览 ${item.label}`);
                const star=el('button',{type:'button',className:'bs-theme-favorite',title:favorite(item.name)?'取消收藏':'收藏美化'},favorite(item.name)?'★':'☆');star.setAttribute('aria-label',`${favorite(item.name)?'取消收藏':'收藏'} ${item.label}`);star.setAttribute('aria-pressed',String(favorite(item.name)));star.onclick=()=>{const y=scroll.scrollTop;toggleFavorite(item.name);renderGrid();scroll.scrollTop=y;};
                card.classList.toggle('bs-theme-active',item.name===native.value);
                const thumb=makePreview(item.name),caption=el('div',{className:'bs-theme-caption'}),name=el('strong',{},item.label);
                caption.append(name);
                const chips=el('div',{className:'bs-theme-tags'});for(const tag of tagsOf(item.name))chips.append(el('span',{},tag));caption.append(chips);
                if(item.name===native.value)caption.append(el('small',{className:'bs-theme-current'},'当前使用'));
                opener.append(thumb,caption);opener.onclick=()=>renderDetail(item);card.append(opener,star);grid.append(card);lazy.observe(thumb);
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
                history.sync();refresh();dialog.close();
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
            const star=el('button',{type:'button',className:'menu_button'},favorite(item.name)?'★ 已收藏':'☆ 收藏美化');star.onclick=()=>{toggleFavorite(item.name);star.textContent=favorite(item.name)?'★ 已收藏':'☆ 收藏美化';};
            const compare=el('button',{type:'button',className:'menu_button'},'修改前后对比');compare.onclick=()=>renderCompare(item);
            actions.append(save,apply,star,compare,upload,reset);detail.append(back,title,preview,label,input,actions,file,el('small',{className:'bs-theme-cover-note'},'标签随酒馆设置保存；上传的封面保存在当前浏览器。预览使用空白原生消息模板与示例文字，不读取聊天。'));
            populatePreview(preview,item.name);
        }
        async function renderCompare(item) {
            cleanupPreviews();detailName=item.name;grid.hidden=true;detail.hidden=false;tools.hidden=true;tags.hidden=true;footer.hidden=true;scroll.scrollTop=0;
            detail.replaceChildren();status.textContent='正在读取最近一次修改记录…';
            const back=el('button',{type:'button',className:'menu_button'},'← 返回美化详情');back.onclick=()=>renderDetail(item);
            detail.append(back,el('h3',{},`${item.label} · 修改前后对比`));
            let record;
            try{record=await history.get(item.name);}catch{if(modal===dialog)status.textContent='无法读取本地记录，浏览器可能限制了站点存储';return;}
            if(modal!==dialog||detailName!==item.name)return;
            if(!record){status.textContent='还没有这套美化的 CSS 修改记录';detail.append(el('p',{className:'bs-theme-cover-note'},'从本次更新开始，在酒馆的“自定义 CSS”编辑器修改内容后，会自动保留最近一次编辑前、编辑后的两版。更新前已丢失的内容无法追溯。'));return;}
            const base=cache.find(theme=>theme.name===item.name)??{name:item.name};
            const pair=el('div',{className:'bs-theme-compare-grid'}),code=el('div',{className:'bs-theme-code-grid',hidden:true});
            for(const [title,css] of [['修改前',record.before],['修改后',record.after]]){
                const pane=el('section',{className:'bs-theme-compare-pane'}),preview=makePreview(item.name);pane.append(el('b',{},title),preview);pair.append(pane);
                const label=el('label',{},`${title} CSS`),textarea=el('textarea',{readOnly:true,value:css,className:'text_pole bs-theme-code'});textarea.setAttribute('aria-label',`${title} CSS`);label.append(textarea);code.append(label);
            }
            const actions=el('div',{className:'bs-theme-actions'}),toggle=el('button',{type:'button',className:'menu_button'},'查看 CSS 代码');
            toggle.onclick=()=>{code.hidden=!code.hidden;toggle.textContent=code.hidden?'查看 CSS 代码':'收起 CSS 代码';};
            actions.append(toggle);
            for(const [title,css] of [['恢复修改前 CSS',record.before],['恢复修改后 CSS',record.after]]){
                const restore=el('button',{type:'button',className:'menu_button'},title);
                restore.onclick=async()=>{restore.disabled=true;try{await history.restore(item.name,css);status.textContent='已恢复到当前 CSS 编辑器并应用。要更新美化文件，请使用酒馆原来的保存按钮。';}catch(error){status.textContent=error.message;}finally{restore.disabled=false;}};
                actions.append(restore);
            }
            const time=new Date(record.updatedAt).toLocaleString();
            status.textContent=`最近记录：${time} · 只保留最近一次修改的两版`;
            detail.append(pair,actions,code,el('small',{className:'bs-theme-cover-note'},'对比直接渲染两版 CSS，忽略上传封面。记录保存在当前浏览器，清理站点数据会丢失；恢复到编辑器不会覆盖已保存的主题文件。'));
            const hosts=pair.querySelectorAll('.bs-theme-thumb');populatePreview(hosts[0],item.name,{...base,custom_css:record.before},true);populatePreview(hosts[1],item.name,{...base,custom_css:record.after},true);
        }
        // Keep closures alive only for this modal, and release resources on close.
        modalObserver=new MutationObserver(()=>{if(detailName===null&&modal===dialog)renderGrid();});
        if(native)modalObserver.observe(native,{childList:true,subtree:true});
        try{await loadThemes();if(modal===dialog){const item=initialCompare&&names().find(item=>item.name===initialCompare);if(item)await renderCompare(item);else renderGrid();}}catch(error){if(modal===dialog){renderGrid();status.textContent='美化数据读取失败：可刷新重试；仍可使用自定义封面与标签';}}
    }
    return {refresh,destroy(){disposed=true;history.destroy();cssSearch.destroy();editorActions?.remove();modal?.close();optionObserver?.disconnect();modalObserver?.disconnect();cleanupPreviews();document.removeEventListener('change',onChange);document.removeEventListener('click',onClick,true);native?.classList.remove('bs-theme-native-hidden');launch?.remove();}};
}
