const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeStyle=value=>String(value).replace(/<\//g,'<\\/');
let baseSnapshot=null,messageSnapshot=new Map();
export function resetPreviewCache(){baseSnapshot=null;messageSnapshot.clear();}
function absoluteURLs(css,base){return css.replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi,(all,quote,quoted,plain)=>{const value=(quoted??plain??'').trim();if(!value||/^(data:|blob:|#)/i.test(value))return all;try{return `url(${JSON.stringify(new URL(value,base).href)})`;}catch{return all;}});}
function baseStyles(){
    if(baseSnapshot)return baseSnapshot;
    const rootCSS=new URL('style.css',document.baseURI).href;
    const styles=[...document.querySelectorAll('head link[rel="stylesheet"]')].filter(link=>{const u=new URL(link.href);return u.origin===location.origin&&(link.href===rootCSS||/\/css\/(mobile-styles|fontawesome\.min|solid\.min)\.css$/.test(u.pathname));});
    const html=styles.map(link=>{
        try{
            const serialize=(rules,base)=>[...rules].map(rule=>{
                if(rule.type===CSSRule.IMPORT_RULE){try{return serialize(rule.styleSheet.cssRules,rule.href);}catch{return '';}}
                let text=absoluteURLs(rule.cssText,base);
                if(rule.type===CSSRule.FONT_FACE_RULE)text=text.replace(/}\s*$/,'font-display:swap;}');
                return text;
            }).join('\n');
            if(!link.sheet)throw Error('not loaded');
            return `<style data-bs-native>${safeStyle(serialize(link.sheet.cssRules,link.href))}</style>`;
        }catch{return `<link rel="stylesheet" href="${escapeHTML(link.href)}">`;}
    }).join('');
    return baseSnapshot={html,native:styles.some(link=>link.href===rootCSS)};
}
function splitImports(css){
    const source=String(css??''),imports=[];let text='',last=0,depth=0;
    const skipString=(i)=>{const quote=source[i++];while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]===quote)break;}return i;};
    for(let i=0;i<source.length;){
        if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+2;continue;}
        if(source[i]==='"'||source[i]==="'"){i=skipString(i);continue;}
        if(!depth&&/^@import\b/i.test(source.slice(i,i+8))){
            let end=i+7,parens=0;
            for(;end<source.length;end++){
                if(source[end]==='"'||source[end]==="'"){end=skipString(end)-1;continue;}
                if(source.startsWith('/*',end)){const close=source.indexOf('*/',end+2);end=close<0?source.length:close+1;continue;}
                if(source[end]==='(')parens++;else if(source[end]===')')parens--;
                else if(source[end]===';'&&!parens)break;
            }
            if(end<source.length){text+=source.slice(last,i);imports.push(source.slice(i,end+1));last=end+1;i=last;continue;}
        }
        if(source[i]==='{')depth++;else if(source[i]==='}')depth=Math.max(0,depth-1);i++;
    }
    return {text:text+source.slice(last),imports};
}
// The frame runs no scripts. Its parent adds optional remote styles after its first paint.
export function activatePreviewFrame(frame){
    const doc=frame.contentDocument;if(!doc?.body)return false;
    const images=new Map(),fontRequests=new Set();
    const checkIcons=()=>{
        if(!doc.defaultView)return;
        for(const icon of doc.querySelectorAll('[data-bs-preview-icon]')){
            // Inspect the theme without our fallback overrides, then choose one renderer
            // synchronously. No intermediate state is painted.
            icon.removeAttribute('data-bs-icon-mode');
            icon.removeAttribute('data-bs-hide-before');icon.removeAttribute('data-bs-hide-after');
            const view=doc.defaultView,style=view.getComputedStyle(icon),before=view.getComputedStyle(icon,'::before'),after=view.getComputedStyle(icon,'::after');
            const imageURLs=[style.backgroundImage,before.backgroundImage,after.backgroundImage,before.content,after.content].flatMap(value=>[...(value??'').matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match=>match[1]));
            for(const url of imageURLs)if(!images.has(url)){const img=doc.createElement('img');images.set(url,img);img.referrerPolicy='no-referrer';img.onload=checkIcons;img.src=url;}
            const beforeImage=[before.backgroundImage,before.content].some(value=>value?.includes('url(')),afterImage=[after.backgroundImage,after.content].some(value=>value?.includes('url('));
            const image=imageURLs.some(url=>images.get(url)?.naturalWidth>0);
            let glyph=false;
            for(const pseudo of [before,after]){
                const content=pseudo.content;
                if(!content||['none','normal','""',"''"].includes(content)||content.includes('url(')||pseudo.display==='none'||pseudo.visibility==='hidden'||parseFloat(pseudo.fontSize)===0)continue;
                const text=content.replace(/^["']|["']$/g,'');
                if(/awesome/i.test(pseudo.fontFamily)){
                    const font=`${pseudo.fontWeight} ${pseudo.fontSize} ${pseudo.fontFamily}`;
                    try{
                        glyph ||= doc.fonts.check(font,text);
                        const key=font+text;
                        if(!fontRequests.has(key)){fontRequests.add(key);doc.fonts.load(font,text).then(checkIcons).catch(()=>{});}
                    }catch{}
                }else if(!/[\ue000-\uf8ff]/u.test(text))glyph=true;
            }
            // A declared theme image takes precedence over its original font glyph.
            // Failed image requests retain the fallback rather than leaving a blank.
            icon.dataset.bsIconMode=imageURLs.length?(image?'image':'fallback'):(glyph?'glyph':'fallback');
            if(imageURLs.length&&image){if(!beforeImage)icon.setAttribute('data-bs-hide-before','');if(!afterImage)icon.setAttribute('data-bs-hide-after','');}
        }
    };
    checkIcons();doc.fonts?.ready.then(checkIcons).catch(()=>{});
    doc.fonts?.addEventListener('loadingdone',checkIcons);
    const imports=[...doc.querySelectorAll('meta[data-bs-import]')];
    if(imports.length){const style=doc.createElement('style');style.textContent=imports.map(meta=>meta.dataset.bsImport).join('\n');style.onload=checkIcons;doc.head.append(style);imports.forEach(meta=>meta.remove());}
    return true;
}
export function previewSize(name='',width=0) {
    const named=String(name).match(/(?:^|[^\d])(\d{3,4})\s*px\b/i)?.[1];
    const chosen=Number(width)||Number(named)||innerWidth;
    const w=Math.max(280,Math.min(1920,Math.round(chosen)));
    const ratio=Math.max(.65,Math.min(2.5,innerHeight/innerWidth));
    return {width:w,height:Math.max(540,Math.round(w*ratio))};
}
function sampleMessage(user,index) {
    const key=`${user}:${index}`;if(messageSnapshot.has(key))return messageSnapshot.get(key);
    // Clone only the EMPTY native template, never the actual chat or user avatars.
    let message=document.querySelector('#message_template .mes')?.cloneNode(true);
    if(!message){message=document.createElement('div');message.className='mes';message.innerHTML='<div class="mesAvatarWrapper"><div class="avatar"><img></div></div><div class="mes_block"><div class="ch_name flex-container justifySpaceBetween"><span class="name_text"></span><small class="timestamp"></small><div class="mes_buttons"><span class="mes_button">⋯</span></div></div><div class="mes_text"></div><div class="mes_media_wrapper"></div><div class="mes_file_wrapper"></div><div class="mes_bias"></div></div><div class="swipeRightBlock"><div class="swipes-counter"></div></div>';}
    message.setAttribute('is_user',String(user));message.setAttribute('is_system','false');message.setAttribute('mesid',String(index));message.setAttribute('ch_name',user?'你':'角色');
    message.querySelectorAll('script,iframe,object,embed,audio,video').forEach(node=>node.remove());
    for(const node of [message,...message.querySelectorAll('*')])for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['srcdoc','formaction'].includes(attr.name))node.removeAttribute(attr.name);
    message.querySelectorAll('.name_text').forEach(node=>node.textContent=user?'你':'角色');
    message.querySelectorAll('.timestamp').forEach(node=>node.textContent='14:30');
    const body=message.querySelector('.mes_text');
    body.replaceChildren();
    const texts=['午后的风穿过窗边，书页轻轻翻动。','“今天想聊些什么？”','这是一段美化预览文字。'];
    texts.forEach((text,i)=>{const p=document.createElement('p');if(i===2){const strong=document.createElement('strong');strong.textContent=text;p.append(strong);}else p.textContent=text;body.append(p);});
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="${user?'#b3c7ce':'#d4c2d6'}"/><circle cx="48" cy="35" r="16" fill="#fff"/><path d="M18 85a30 30 0 0 1 60 0" fill="#fff"/></svg>`;
    message.querySelectorAll('.avatar img').forEach(img=>{img.src=`data:image/svg+xml,${encodeURIComponent(svg)}`;img.alt=user?'示例用户':'示例角色';img.removeAttribute('srcset');});
    message.querySelectorAll('.mes_reasoning_details').forEach(node=>{node.hidden=true;node.style.display='none';});
    messageSnapshot.set(key,message.outerHTML);return message.outerHTML;
}
export function previewDocument(theme,size) {
    const colors={SmartThemeBodyColor:theme.main_text_color??'#eee',SmartThemeEmColor:theme.italics_text_color??theme.main_text_color??'#bbc',SmartThemeUnderlineColor:theme.underline_text_color??'#bbc',SmartThemeQuoteColor:theme.quote_text_color??theme.main_text_color??'#bbc',SmartThemeBlurTintColor:theme.blur_tint_color??'#292e42',SmartThemeChatTintColor:theme.chat_tint_color??'#252a39',SmartThemeUserMesBlurTintColor:theme.user_mes_blur_tint_color??'transparent',SmartThemeBotMesBlurTintColor:theme.bot_mes_blur_tint_color??'transparent',SmartThemeBorderColor:theme.border_color??'#969db74d',SmartThemeShadowColor:theme.shadow_color??'#0007'};
    const vars=Object.entries(colors).map(([key,value])=>`--${key}:${String(value).replace(/[;{}<>]/g,'')};`).join('');
    const {native,html:links}=baseStyles();
    const flags=[theme.chat_display===1?'bubblechat':theme.chat_display===2?'documentstyle':'',theme.fast_ui_mode?'no-blur':'',theme.noShadows?'noShadows':'',theme.waifuMode?'waifuMode':'',theme.avatar_style===1?'big-avatars':theme.avatar_style===2?'square-avatars':theme.avatar_style===3?'rounded-avatars':''].filter(Boolean).join(' ');
    const number=(value,fallback,min,max)=>Math.max(min,Math.min(max,value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):fallback));
    const variables=`:root{${vars}--fontScale:${number(theme.font_scale,1,.5,2)};--mainFontSize:calc(15px * var(--fontScale));--sheldWidth:${number(theme.chat_width,50,20,100)}vw;--blurStrength:${number(theme.blur_strength,1,0,30)};--shadowWidth:${number(theme.shadow_width,1,0,20)};}html{width:${size.width}px;height:${size.height}px;overflow:hidden}body{margin:0;}`;
    // Minimal CSS is used ONLY if the host has no native stylesheet (e.g. a test page).
    const fallback=native?'':`*{box-sizing:border-box}body{font:16px/1.7 system-ui;color:var(--SmartThemeBodyColor);background:var(--SmartThemeChatTintColor)}#top-bar,#top-settings-holder{position:fixed;top:0;left:0;right:0;height:44px;background:var(--SmartThemeBlurTintColor)}#top-settings-holder{display:flex;align-items:center;justify-content:space-around}#sheld{position:fixed;inset:44px 0 0;display:flex;flex-direction:column}#chat{flex:1;overflow:auto;padding:14px}.mes{display:flex;gap:10px;padding:16px 0;border-bottom:1px solid var(--SmartThemeBorderColor)}.mesAvatarWrapper{width:42px;flex:none}.avatar img{width:42px;height:42px;border-radius:50%}.mes_block{flex:1;min-width:0}.ch_name{display:flex;justify-content:space-between}.timestamp,.mes_buttons{font-size:12px;opacity:.5}.mes_text p{margin:12px 0}.mes_text em{color:var(--SmartThemeEmColor)}#form_sheld{background:var(--SmartThemeBlurTintColor)}#nonQRFormItems{display:flex;align-items:center;padding:10px;gap:8px}#send_textarea{flex:1;min-width:0;resize:none;height:48px;color:inherit;background:transparent;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px}.bubblechat .mes{border-radius:16px;background:var(--SmartThemeBotMesBlurTintColor);margin-bottom:10px;padding:12px}.bubblechat .mes[is_user="true"]{background:var(--SmartThemeUserMesBlurTintColor)}`;
    const {text,imports}=splitImports(theme.custom_css);
    const custom=safeStyle(text);
    const deferred=imports.map(rule=>`<meta data-bs-import="${escapeHTML(rule)}">`).join('');
    const buttons=[['ai-config-button','leftNavDrawerIcon','fa-sliders'],['sys-settings-button','API-status-top','fa-plug-circle-exclamation'],['advanced-formatting-button','','fa-font'],['WI-SP-button','WIDrawerIcon','fa-book-atlas'],['user-settings-button','','fa-user-cog'],['backgrounds-button','','fa-panorama'],['extensions-settings-button','','fa-cubes'],['persona-management-button','','fa-face-smile'],['rightNavHolder','rightNavDrawerIcon','fa-address-card']];
    const paths=['M4 7h16M4 17h16M8 4v6M16 14v6','M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0ZM12 18v3','M5 20l7-16 7 16M8 14h8','M4 4h7l1 2 1-2h7v16h-7l-1 1-1-1H4Z','M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0','M3 4h18v16H3ZM4 17l5-6 4 4 3-3 5 5','M12 3l9 5-9 5-9-5ZM3 8v9l9 5 9-5V8M12 13v9','M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 9h.1M16 9h.1M7 14q5 7 10 0','M3 5h18v14H3ZM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 16q3-6 6 0M14 9h5M14 13h5'];
    const icons=buttons.map(([id,icon,cls],i)=>`<div id="${id}" class="drawer"><div ${id==='backgrounds-button'?'id="backgrounds-drawer-toggle"':id==='rightNavHolder'?'id="unimportantYes"':''} class="drawer-toggle drawer-header"><div data-bs-preview-icon data-bs-icon-mode="fallback" ${icon?`id="${icon}"`:''} class="drawer-icon fa-solid ${cls} fa-fw closedIcon"><svg class="bs-preview-icon-fallback" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[i]}"/></svg></div></div></div>`).join('');
    const chrome=`
#top-settings-holder{position:fixed!important;top:0!important;left:0!important;right:0!important;display:flex!important;visibility:visible!important;opacity:1!important;transform:none!important;max-width:100vw!important;min-height:28px!important;z-index:2147483000!important}
#top-settings-holder>.drawer{display:flex!important;visibility:visible!important;flex:1;min-width:0}
#top-settings-holder .drawer-toggle{display:flex!important;visibility:visible!important}
#top-settings-holder .drawer-icon{display:inline-block!important;visibility:visible!important;opacity:1!important;min-width:20px;min-height:20px;position:relative}
#send_form [data-bs-preview-icon]{position:relative;min-width:20px;min-height:20px}
:is(#top-settings-holder,#send_form) [data-bs-preview-icon]>.bs-preview-icon-fallback{display:none!important;position:absolute!important;inset:0!important;margin:auto!important;width:20px!important;height:20px!important;max-width:100%;max-height:100%;stroke:currentColor;stroke-width:1.6;fill:none;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
:is(#top-settings-holder,#send_form) [data-bs-icon-mode="fallback"]{background-image:none!important}
:is(#top-settings-holder,#send_form) [data-bs-icon-mode="fallback"]::before,:is(#top-settings-holder,#send_form) [data-bs-icon-mode="fallback"]::after{content:none!important;display:none!important}
:is(#top-settings-holder,#send_form) [data-bs-hide-before]::before,:is(#top-settings-holder,#send_form) [data-bs-hide-after]::after{content:none!important;display:none!important}
:is(#top-settings-holder,#send_form) [data-bs-icon-mode="fallback"]>.bs-preview-icon-fallback{display:block!important}
`;
    const fallbackSVG=path=>`<svg class="bs-preview-icon-fallback" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' http: https:; img-src data: blob: http: https:; font-src data: http: https:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">${links}<style>${fallback}</style><style>${variables}</style><style id="custom-style">${custom}</style><style>${chrome}</style>${deferred}</head><body class="${flags}"><div id="bg1"></div><div id="bg_custom"></div><div id="top-bar"></div><div id="top-settings-holder">${icons}</div><div id="sheld"><div id="sheldheader" class="fa-solid fa-grip drag-grabber"></div><div id="chat">${sampleMessage(false,0)}${sampleMessage(true,1)}${sampleMessage(false,2)}</div><div id="form_sheld"><div id="send_form"><div id="nonQRFormItems"><div id="leftSendForm" class="alignContentCenter"><div id="options_button" class="fa-solid fa-bars" data-bs-preview-icon data-bs-icon-mode="fallback">${fallbackSVG('M4 5h16M4 12h16M4 19h16')}</div></div><textarea id="send_textarea" name="text" class="mdHotkeys" readonly placeholder="发送一条消息…"></textarea><div id="rightSendForm" class="alignContentCenter"><div id="send_but" class="fa-solid fa-paper-plane interactable" data-bs-preview-icon data-bs-icon-mode="fallback">${fallbackSVG('M3 3l19 9-19 9 4-9ZM7 12h15')}</div></div></div></div></div></div></body></html>`;
}
