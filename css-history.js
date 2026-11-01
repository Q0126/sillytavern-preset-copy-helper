let dbPromise;
async function storage(operation,key,value) {
    dbPromise??=new Promise((resolve,reject)=>{const req=indexedDB.open('baishui-css-history',1);req.onupgradeneeded=()=>req.result.createObjectStore('pairs');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}).catch(error=>{dbPromise=null;throw error;});
    const db=await dbPromise;
    return new Promise((resolve,reject)=>{const tx=db.transaction('pairs',operation==='get'?'readonly':'readwrite'),req=operation==='get'?tx.objectStore('pairs').get(key):tx.objectStore('pairs').put(value,key);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export function createCSSHistory({settings,onSave,onUpdate=()=>{}}) {
    let name='',committed='',before=null,editor=null,timer=null,queue=Promise.resolve(),pending=null,disposed=false;
    const namespace=()=>{if(!settings.coverNamespace){settings.coverNamespace=crypto.randomUUID?.()??`asset-${Date.now()}-${Math.random()}`;onSave();}return settings.coverNamespace;};
    const currentName=()=>document.querySelector('#themes')?.value??'';
    function sync(){name=currentName();editor=document.querySelector('#customCSS');committed=editor?.value??'';before=null;}
    function flush(){clearTimeout(timer);timer=null;if(!pending)return queue;const record=pending;pending=null;queue=queue.catch(()=>{}).then(()=>storage('put',`${namespace()}:${record.name}`,record)).then(()=>onUpdate(record.name));queue.catch(error=>console.warn('[白水杂货铺] CSS记录保存失败',error));return queue;}
    function input(event){if(disposed||event.target?.id!=='customCSS')return;if(currentName()!==name){void flush();sync();return;}if(!name)return;const value=event.target.value;if(value===committed)return;if(before===null)before=committed;pending={name,before,after:value,updatedAt:Date.now()};committed=value;clearTimeout(timer);timer=setTimeout(flush,700);}
    function focus(event){if(event.target?.id!=='customCSS')return;if(currentName()!==name)sync();else if(before===null)committed=event.target.value;}
    function blur(event){if(event.target?.id==='customCSS'){void flush();before=null;}}
    function change(event){if(event.target?.id==='themes'){void flush();queueMicrotask(sync);}}
    const jq=window.jQuery;
    if(jq?.fn?.on){jq(document).on('input.bsShopCSS','#customCSS',input);jq(document).on('change.bsShopCSS','#themes',change);}else{document.addEventListener('input',input);document.addEventListener('change',change);}
    document.addEventListener('focusin',focus);document.addEventListener('focusout',blur);window.addEventListener('pagehide',flush);sync();
    return {
        sync(){void flush();sync();},
        async get(themeName){await flush();if(!settings.coverNamespace)return null;return await storage('get',`${settings.coverNamespace}:${themeName}`)??null;},
        async restore(themeName,css){if(currentName()!==themeName)throw Error('请先应用这套美化，再恢复 CSS');const target=document.querySelector('#customCSS');if(!target)throw Error('未找到酒馆的自定义 CSS 编辑器');await flush();if(name!==themeName)sync();before=committed;target.value=css;if(jq?.fn?.on)jq(target).trigger('input');else target.dispatchEvent(new Event('input',{bubbles:true}));await flush();before=null;return target.value;},
        destroy(){void flush();disposed=true;if(jq?.fn?.on)jq(document).off('.bsShopCSS');else{document.removeEventListener('input',input);document.removeEventListener('change',change);}document.removeEventListener('focusin',focus);document.removeEventListener('focusout',blur);window.removeEventListener('pagehide',flush);}
    };
}
