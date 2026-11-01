const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function previewSize(name='',width=0) {
    const named=String(name).match(/(?:^|[^\d])(\d{3,4})\s*px\b/i)?.[1];
    const chosen=Number(width)||Number(named)||innerWidth;
    const w=Math.max(280,Math.min(1920,Math.round(chosen)));
    const ratio=Math.max(.65,Math.min(2.5,innerHeight/innerWidth));
    return {width:w,height:Math.max(540,Math.round(w*ratio))};
}
function sampleMessage(user,index) {
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
    const texts=user?['就从这一刻开始吧。']:index===0?['午后的风穿过窗边，书页轻轻翻动。','“今天想聊些什么？”','这是一段美化预览文字。']:['想说的话，慢慢说就好。'];
    texts.forEach((text,i)=>{const p=document.createElement('p');if(i===2){const em=document.createElement('em');em.textContent=text;p.append(em);}else p.textContent=text;body.append(p);});
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="${user?'#b3c7ce':'#d4c2d6'}"/><circle cx="48" cy="35" r="16" fill="#fff"/><path d="M18 85a30 30 0 0 1 60 0" fill="#fff"/></svg>`;
    message.querySelectorAll('.avatar img').forEach(img=>{img.src=`data:image/svg+xml,${encodeURIComponent(svg)}`;img.alt=user?'示例用户':'示例角色';img.removeAttribute('srcset');});
    message.querySelectorAll('.mes_reasoning_details').forEach(node=>{node.hidden=true;node.style.display='none';});
    return message.outerHTML;
}
export function previewDocument(theme,size) {
    const colors={SmartThemeBodyColor:theme.main_text_color??'#eee',SmartThemeEmColor:theme.italics_text_color??theme.main_text_color??'#bbc',SmartThemeUnderlineColor:theme.underline_text_color??'#bbc',SmartThemeQuoteColor:theme.quote_text_color??theme.main_text_color??'#bbc',SmartThemeBlurTintColor:theme.blur_tint_color??'#292e42',SmartThemeChatTintColor:theme.chat_tint_color??'#252a39',SmartThemeUserMesBlurTintColor:theme.user_mes_blur_tint_color??'transparent',SmartThemeBotMesBlurTintColor:theme.bot_mes_blur_tint_color??'transparent',SmartThemeBorderColor:theme.border_color??'#969db74d',SmartThemeShadowColor:theme.shadow_color??'#0007'};
    const vars=Object.entries(colors).map(([key,value])=>`--${key}:${String(value).replace(/[;{}<>]/g,'')};`).join('');
    const rootCSS=new URL('style.css',document.baseURI).href;
    const styles=[...document.querySelectorAll('head link[rel="stylesheet"]')].filter(link=>{const u=new URL(link.href);return u.origin===location.origin&&!u.pathname.includes('/scripts/extensions/')&&!/\/css\/user\.css$/.test(u.pathname);});
    const native=styles.some(link=>link.href===rootCSS);
    const links=styles.map(link=>`<link rel="stylesheet" href="${escapeHTML(link.href)}">`).join('');
    const flags=[theme.chat_display===1?'bubblechat':theme.chat_display===2?'documentstyle':'',theme.fast_ui_mode?'no-blur':'',theme.noShadows?'noShadows':'',theme.waifuMode?'waifuMode':'',theme.avatar_style===1?'big-avatars':theme.avatar_style===2?'square-avatars':theme.avatar_style===3?'rounded-avatars':''].filter(Boolean).join(' ');
    const number=(value,fallback,min,max)=>Math.max(min,Math.min(max,value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):fallback));
    const variables=`:root{${vars}--fontScale:${number(theme.font_scale,1,.5,2)};--mainFontSize:calc(15px * var(--fontScale));--sheldWidth:${number(theme.chat_width,50,20,100)}vw;--blurStrength:${number(theme.blur_strength,1,0,30)};--shadowWidth:${number(theme.shadow_width,1,0,20)};}html{width:${size.width}px;height:${size.height}px;overflow:hidden}body{margin:0;}`;
    // Minimal CSS is used ONLY if the host has no native stylesheet (e.g. a test page).
    const fallback=native?'':`*{box-sizing:border-box}body{font:16px/1.7 system-ui;color:var(--SmartThemeBodyColor);background:var(--SmartThemeChatTintColor)}#top-bar,#top-settings-holder{position:fixed;top:0;left:0;right:0;height:44px;background:var(--SmartThemeBlurTintColor)}#top-settings-holder{display:flex;align-items:center;justify-content:space-around}#sheld{position:fixed;inset:44px 0 0;display:flex;flex-direction:column}#chat{flex:1;overflow:auto;padding:14px}.mes{display:flex;gap:10px;padding:16px 0;border-bottom:1px solid var(--SmartThemeBorderColor)}.mesAvatarWrapper{width:42px;flex:none}.avatar img{width:42px;height:42px;border-radius:50%}.mes_block{flex:1;min-width:0}.ch_name{display:flex;justify-content:space-between}.timestamp,.mes_buttons{font-size:12px;opacity:.5}.mes_text p{margin:12px 0}.mes_text em{color:var(--SmartThemeEmColor)}#form_sheld{background:var(--SmartThemeBlurTintColor)}#nonQRFormItems{display:flex;align-items:center;padding:10px;gap:8px}#send_textarea{flex:1;min-width:0;resize:none;height:48px;color:inherit;background:transparent;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px}.bubblechat .mes{border-radius:16px;background:var(--SmartThemeBotMesBlurTintColor);margin-bottom:10px;padding:12px}.bubblechat .mes[is_user="true"]{background:var(--SmartThemeUserMesBlurTintColor)}`;
    const custom=String(theme.custom_css??'').replace(/<\//g,'<\\/');
    const buttons=[['ai-config-button','leftNavDrawerIcon','fa-sliders'],['sys-settings-button','API-status-top','fa-plug-circle-exclamation'],['advanced-formatting-button','','fa-font'],['WI-SP-button','WIDrawerIcon','fa-book-atlas'],['user-settings-button','','fa-user-cog'],['backgrounds-button','','fa-panorama'],['extensions-settings-button','','fa-cubes'],['persona-management-button','','fa-face-smile'],['rightNavHolder','rightNavDrawerIcon','fa-address-card']];
    const iconFont=styles.some(link=>/fontawesome|solid\.min/.test(link.href));
    const icons=buttons.map(([id,icon,cls])=>`<div id="${id}" class="drawer"><div class="drawer-toggle drawer-header"><div ${icon?`id="${icon}"`:''} class="drawer-icon fa-solid ${cls} fa-fw closedIcon">${iconFont?'':'☷'}</div></div></div>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' http: https:; img-src data: blob: http: https:; font-src data: http: https:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">${links}<style>${fallback}</style><style>${variables}</style><style id="custom-style">${custom}</style></head><body class="${flags}"><div id="bg1"></div><div id="bg_custom"></div><div id="top-bar"></div><div id="top-settings-holder">${icons}</div><div id="sheld"><div id="sheldheader" class="fa-solid fa-grip drag-grabber"></div><div id="chat">${sampleMessage(false,0)}${sampleMessage(true,1)}${sampleMessage(false,2)}</div><div id="form_sheld"><div id="send_form"><div id="nonQRFormItems"><div id="leftSendForm" class="alignContentCenter"><div id="options_button" class="fa-solid fa-bars">${native?'':'☰'}</div></div><textarea id="send_textarea" name="text" class="mdHotkeys" readonly placeholder="发送一条消息…"></textarea><div id="rightSendForm" class="alignContentCenter"><div id="send_but" class="fa-solid fa-paper-plane interactable">${native?'':'➤'}</div></div></div></div></div></div></body></html>`;
}
