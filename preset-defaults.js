// Preserve the first observed saved/imported parameters, separately from live
// settings and preset files that the native Save button is allowed to overwrite.
export function createPresetDefaults({settings,onSave}) {
    if(!Array.isArray(settings.presetOriginalDefaults))settings.presetOriginalDefaults=[];
    const records=()=>settings.presetOriginalDefaults;
    const find=name=>records().find(record=>record?.name===name&&record.values&&typeof record.values==='object');
    function capture(entries){
        let changed=false;
        for(const {name,preset} of entries){
            if(typeof name!=='string'||!name||!preset||typeof preset!=='object'||find(name))continue;
            const values=Object.fromEntries(Object.entries(preset).filter(([,value])=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))).map(([key,value])=>[key,Number(value)]));
            if(!Object.keys(values).length)continue;
            records().push({name,values});changed=true;
        }
        if(changed)onSave();
    }
    function rename(oldName,newName){
        const source=find(oldName);if(!source||oldName===newName)return;
        settings.presetOriginalDefaults=records().filter(record=>record!==source&&record?.name!==newName);
        settings.presetOriginalDefaults.push({...source,name:newName});onSave();
    }
    function remove(name){
        const remaining=records().filter(record=>record?.name!==name);
        if(remaining.length===records().length)return;
        settings.presetOriginalDefaults=remaining;onSave();
    }
    return {capture,get:name=>find(name)?.values,rename,remove};
}
