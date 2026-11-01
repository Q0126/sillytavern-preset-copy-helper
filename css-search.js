const el=(tag,props={},text)=>{const node=document.createElement(tag);Object.assign(node,props);if(text!==undefined)node.textContent=text;return node;};

// Search selects text in the original editor; it never rewrites or applies CSS.
export function createCSSSearch(){
    let editor=null,button=null,panel=null,query=null,count=null,snippet=null,previous=null,next=null,edit=null;
    let matches=[],active=0,timer=0;
    function update(){
        const match=matches[active];
        count.textContent=query.value?(match?`${active+1} / ${matches.length} · 第 ${editor.value.slice(0,match.start).split('\n').length} 行`:'没有找到匹配内容'):'输入 CSS 选择器、属性或文字';
        previous.disabled=next.disabled=edit.disabled=!match;
        snippet.textContent=match?editor.value.slice(Math.max(0,editor.value.lastIndexOf('\n',match.start-1)+1),editor.value.indexOf('\n',match.end)<0?editor.value.length:editor.value.indexOf('\n',match.end)).trim().slice(0,240):'';
    }
    function find(select=true){
        clearTimeout(timer);matches=[];
        if(query.value){
            const escaped=query.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
            for(const match of editor.value.matchAll(new RegExp(escaped,'giu')))matches.push({start:match.index,end:match.index+match[0].length});
        }
        active=Math.max(0,Math.min(active,matches.length-1));update();if(select)locate();
    }
    function locate(focus=false){
        const match=matches[active];if(!match||!editor.isConnected)return;
        if(focus)editor.focus({preventScroll:true});
        editor.setSelectionRange(match.start,match.end);
        // Measure actual wrapped lines, including theme fonts and textarea padding.
        const style=getComputedStyle(editor),mirror=document.createElement('div');
        for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textTransform','textIndent','tabSize','paddingTop','paddingBottom','paddingLeft','paddingRight','whiteSpace','wordBreak','overflowWrap'])mirror.style[key]=style[key];
        Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none',width:`${editor.clientWidth}px`,boxSizing:'border-box',height:'auto',border:'0',margin:'0'});
        mirror.append(document.createTextNode(editor.value.slice(0,match.start)));const mark=el('span',{},editor.value.slice(match.start,match.end)||' ');mirror.append(mark);document.body.append(mirror);
        const bounds=mark.getBoundingClientRect(),origin=mirror.getBoundingClientRect();
        editor.scrollTop=Math.max(0,bounds.top-origin.top-editor.clientHeight/2);
        editor.scrollLeft=Math.max(0,bounds.left-origin.left-editor.clientWidth/2);mirror.remove();
        if(focus)editor.scrollIntoView({block:'center',behavior:'auto'});
    }
    function step(direction){if(!matches.length)return;active=(active+direction+matches.length)%matches.length;update();locate();}
    function close(){clearTimeout(timer);panel.hidden=true;button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});}
    function onInput(event){if(event.target===editor&&panel&&!panel.hidden)find(false);}
    const jq=window.jQuery;
    if(jq?.fn?.on)jq(document).on('input.bsShopCSSSearch','#customCSS',onInput);else document.addEventListener('input',onInput);
    function mount(target,row,enabled){
        if(target!==editor||!button?.isConnected){
            clearTimeout(timer);button?.remove();panel?.remove();editor=target;
            button=el('button',{id:'bs-css-search-launch',type:'button',className:'menu_button'},'搜索 CSS');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','bs-css-search-panel');
            panel=el('div',{id:'bs-css-search-panel',className:'bs-css-search',hidden:true});panel.setAttribute('role','search');panel.setAttribute('aria-label','搜索当前自定义 CSS');
            query=el('input',{type:'search',className:'text_pole',placeholder:'搜索选择器、属性或文字…'});query.setAttribute('aria-label','搜索 CSS 关键词');
            count=el('small',{className:'bs-css-search-count'});count.setAttribute('role','status');snippet=el('code',{className:'bs-css-search-snippet'});
            previous=el('button',{type:'button',className:'menu_button'},'上一处');next=el('button',{type:'button',className:'menu_button'},'下一处');edit=el('button',{type:'button',className:'menu_button'},'定位并编辑');const dismiss=el('button',{type:'button',className:'menu_button'},'关闭搜索');
            previous.onclick=()=>step(-1);next.onclick=()=>step(1);edit.onclick=()=>locate(true);dismiss.onclick=close;
            const actions=el('div',{className:'bs-css-search-actions'});actions.append(previous,next,edit,dismiss);panel.append(query,count,snippet,actions);row.append(button);row.after(panel);
            query.oninput=()=>{active=0;clearTimeout(timer);timer=setTimeout(()=>find(),120);};
            query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);find(false);step(event.shiftKey?-1:1);}else if(event.key==='Escape'){event.preventDefault();close();}};
            button.onclick=()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){find(false);query.focus({preventScroll:true});}};
        }
        button.hidden=!enabled;if(!enabled){panel.hidden=true;button.setAttribute('aria-expanded','false');clearTimeout(timer);}
    }
    return {mount,destroy(){clearTimeout(timer);button?.remove();panel?.remove();if(jq?.fn?.on)jq(document).off('.bsShopCSSSearch');else document.removeEventListener('input',onInput);editor=null;}};
}
