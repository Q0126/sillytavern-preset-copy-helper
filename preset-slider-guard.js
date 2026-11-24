const SLIDER_BINDINGS={
    temperature:['#temp_openai','temp_openai'],frequency_penalty:['#freq_pen_openai','freq_pen_openai'],presence_penalty:['#pres_pen_openai','pres_pen_openai'],
    top_p:['#top_p_openai','top_p_openai'],top_k:['#top_k_openai','top_k_openai'],top_a:['#top_a_openai','top_a_openai'],min_p:['#min_p_openai','min_p_openai'],
    repetition_penalty:['#repetition_penalty_openai','repetition_penalty_openai'],openai_max_context:['#openai_max_context','openai_max_context'],
};

// Discover preset-bound ranges rather than guarding every range on the page:
// audio, world-book settings and unrelated APIs retain their native controls.
export function createPresetSliderGuard({enabled,getSettings,getPreset,getBindings=()=>null}) {
    let destroyed=false,queued=false,jqueryDocument=null;
    const states=new Map(),counters=new Map();
    const limits=range=>({min:Number(range.min||0),max:Number(range.max||100),step:Number(range.step)>0?Number(range.step):1});
    function format(value,range){const {step}=limits(range),[base,exponent='0']=String(step).split('e'),digits=(base.split('.')[1]?.length??0)-Number(exponent);return Number(value).toFixed(Number.isInteger(step)?0:Math.min(8,Math.max(2,digits)));}
    function normalized(value,range){const {min,max,step}=limits(range);return Number(Math.min(max,Math.max(min,min+Math.round((value-min)/step)*step)).toFixed(8));}
    function remember(state,element){
        if(!element)return;
        if(!state.tracks.has(element))state.tracks.set(element,{inert:element.hasAttribute('inert'),tabindex:element.getAttribute('tabindex'),marked:element.classList.contains('bs-preset-track')});
        element.classList.add('bs-preset-track');element.setAttribute('inert','');element.setAttribute('tabindex','-1');
    }
    function restoreTrack(state,element,before){if(!before.marked)element.classList.remove('bs-preset-track');if(!before.inert)element.removeAttribute('inert');if(before.tabindex===null)element.removeAttribute('tabindex');else element.setAttribute('tabindex',before.tabindex);state.tracks.delete(element);}
    function restore(state){
        for(const [element,before] of state.tracks)restoreTrack(state,element,before);
        const {counter,numberMarked,counterBox,boxMarked,title}=state;
        counter.removeEventListener('input',state.input);counter.removeEventListener('change',state.finish);counter.removeEventListener('blur',state.finish);
        if(!numberMarked)counter.classList.remove('bs-preset-number');if(counterBox&&!boxMarked)counterBox.classList.remove('bs-preset-counter');
        if(counter.title===state.ownTitle){if(title===null)counter.removeAttribute('title');else counter.setAttribute('title',title);}
        state.hint?.remove();states.delete(state.range);counters.delete(counter);
    }
    const currentValue=state=>Number(getSettings()?.[state.modelKey]??state.range.value);
    function emit(range){if(window.jQuery?.fn?.trigger)window.jQuery(range).trigger('input',{forced:true});else range.dispatchEvent(new Event('input',{bubbles:true}));}
    function commit(state,finish=false){
        if(destroyed||!enabled()||!states.has(state.range)||state.counter.disabled)return;
        const {range,counter}=state,raw=counter.value.trim();
        if(!raw){if(finish){counter.value=format(currentValue(state),range);paint(state);}return;}
        const value=Number(raw);if(!Number.isFinite(value))return;
        const {min,max}=limits(range);if(!finish&&(value<min||value>max))return;
        const next=normalized(value,range),editing=document.activeElement===counter&&!finish;
        if(Number(range.value)!==next||currentValue(state)!==next){range.value=String(next);emit(range);}
        counter.value=editing?raw:format(next,range);paint(state);
    }
    function queue(){if(queued||destroyed)return;queued=true;Promise.resolve().then(()=>{queued=false;if(!destroyed)refresh();});}
    function bindJquery(){
        if(jqueryDocument||!window.jQuery?.fn?.on)return;
        jqueryDocument=window.jQuery(document);
        jqueryDocument.on('input.bsPresetSliders change.bsPresetSliders','input',event=>{const state=counters.get(event.target);if(state)commit(state,event.type==='change');else if(states.has(event.target))queue();});
    }
    function paint(state){
        const {range,counter,modelKey,presetKey}=state,current=currentValue(state);if(!Number.isFinite(current))return;
        range.value=String(current);
        if(document.activeElement!==counter)counter.value=format(current,range);
        const preset=getPreset?.(),raw=preset?.[presetKey]??preset?.[modelKey],defaultValue=Number(raw);
        const hasDefault=(typeof raw==='number'||typeof raw==='string'&&raw.trim()!=='')&&Number.isFinite(defaultValue);
        state.ownTitle=hasDefault?`已记录的初始默认值：${format(defaultValue,range)}；请在此修改当前数值。`:'滑条防误触：请在此修改数值。';counter.title=state.ownTitle;
        const title=range.closest('.range-block')?.querySelector('.range-block-title');
        if(hasDefault&&title){if(state.hint?.parentElement!==title){state.hint?.remove();state.hint=document.createElement('small');state.hint.className='bs-preset-default';title.append(state.hint);}const text=`默认 ${format(defaultValue,range)}`;if(state.hint.textContent!==text)state.hint.textContent=text;}
        else {state.hint?.remove();state.hint=null;}
        const zen=document.getElementById(`${range.id}_zenslider`);
        if(zen){
            remember(state,zen);const jq=window.jQuery;
            if(jq?.fn?.slider){try{const slider=jq(zen),instance=slider.slider('instance');if(instance){const options=limits(range);if(Number(instance.options.min)!==options.min||Number(instance.options.max)!==options.max||Number(instance.options.step)!==options.step)slider.slider('option',options);if(Number(slider.slider('value'))!==current)slider.slider('value',current);}}catch{/* A widget can appear before its native initialization finishes. */}}
            const handle=zen.querySelector('.ui-slider-handle');
            if(handle){remember(state,handle);const text=format(current,range);if(handle.textContent!==text)handle.textContent=text;const {min,max}=limits(range),ratio=max>min?Math.max(0,Math.min(1,(current-min)/(max-min))):0;handle.style.left=`${ratio*100}%`;handle.style.marginLeft=`${-ratio*50}px`;handle.setAttribute('aria-valuenow',String(current));}
        }
    }
    function definitions(){
        const result=new Map(),linked=new Map([...document.querySelectorAll('input[data-for]')].map(input=>[input.dataset.for,input]));
        const add=(range,modelKey,presetKey)=>{
            if(!(range instanceof HTMLInputElement)||range.type!=='range'||!range.id||result.has(range))return;
            const counter=linked.get(range.id)??range.closest('.range-block')?.querySelector('input[type=number]');
            if(counter&&counter!==range)result.set(range,{range,counter,modelKey,presetKey});
        };
        for(const [presetKey,binding] of Object.entries({...SLIDER_BINDINGS,...getBindings()})){
            if(!Array.isArray(binding))continue;const [selector,modelKey]=binding;if(typeof selector!=='string'||!selector)continue;
            try{add(document.querySelector(selector),modelKey,presetKey);}catch{/* Ignore selectors specific to another host implementation. */}
        }
        for(const range of document.querySelectorAll('#range_block_openai input[type=range]'))add(range,range.id,range.id);
        return result;
    }
    function refresh(){
        if(destroyed)return;
        if(!enabled()){for(const state of [...states.values()])restore(state);return;}
        const found=definitions();
        for(const state of [...states.values()])if(found.get(state.range)?.counter!==state.counter)restore(state);
        for(const definition of found.values()){
            const {range,counter}=definition;let state=states.get(range);
            if(!state){const counterBox=counter.closest('.range-block-counter');state={...definition,counterBox,tracks:new Map(),numberMarked:counter.classList.contains('bs-preset-number'),boxMarked:counterBox?.classList.contains('bs-preset-counter'),title:counter.getAttribute('title')};state.input=()=>commit(state);state.finish=()=>commit(state,true);states.set(range,state);counters.set(counter,state);counter.addEventListener('input',state.input);counter.addEventListener('change',state.finish);counter.addEventListener('blur',state.finish);}
            else Object.assign(state,definition);
            counter.classList.add('bs-preset-number');state.counterBox?.classList.add('bs-preset-counter');
            for(const [element,before] of state.tracks)if(!element.isConnected)restoreTrack(state,element,before);
            remember(state,range);const track=range.closest('.range-block-range');if(track&&!track.contains(counter)&&track.querySelectorAll('input[type=range]').length===1)remember(state,track);
            paint(state);
        }
        if(states.size)bindJquery();
    }
    const onInput=event=>{if(states.has(event.target))queue();};document.addEventListener('input',onInput);
    const relevant=node=>node.nodeType===1&&(node.matches?.('input[type=range],input[data-for],[id$="_zenslider"]')||node.querySelector?.('input[type=range],input[data-for],[id$="_zenslider"]'));
    const observer=new MutationObserver(records=>{if(records.some(record=>{if(record.target.nodeType!==1)return false;const widget=record.target.closest('[id$="_zenslider"]');return widget&&states.has(document.getElementById(widget.id.slice(0,-'_zenslider'.length)))||[...record.addedNodes].some(relevant);}))queue();});observer.observe(document.body,{childList:true,subtree:true});
    function destroy(){destroyed=true;observer.disconnect();document.removeEventListener('input',onInput);jqueryDocument?.off('.bsPresetSliders');for(const state of [...states.values()])restore(state);}
    return {refresh,destroy};
}
