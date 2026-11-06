/* Die Chroniken · Admin · Charakterverwaltung
   In das Admin-Dashboard eingebettet. Daten: ChronikenStorage/MySQL. */
(() => {
  "use strict";
  const CHARS_KEY="portal_char_registry";
  const NEXT_ID_KEY="portal_char_next_id";
  const CHARACTER_PROXY_URL="https://chronikenweb-1.onrender.com/charakter";
  const MONTHS=["Frostmond","Eismond","Tauwind","Blütenmond","Sonnenhain","Glutmond","Erntemond","Goldlaub","Nebelmond","Dunkelmond","Sternenfall","Nachtfrost"];

  const local=()=>{try{const v=JSON.parse(localStorage.getItem(CHARS_KEY)||"[]");return Array.isArray(v)?v:[]}catch{return[]}};
  const saveLocal=v=>localStorage.setItem(CHARS_KEY,JSON.stringify(v));
  const nextId=()=>{let n=parseInt(localStorage.getItem(NEXT_ID_KEY)||"1",10);if(!Number.isFinite(n)||n<1)n=1;localStorage.setItem(NEXT_ID_KEY,String(n+1));return"CH-"+String(n).padStart(4,"0")};
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const get=id=>document.getElementById(id);

  async function notify(type,char){
    try{await fetch(CHARACTER_PROXY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"Chroniken Admin",embeds:[{
      title:type==="created"?"🆕 Charakter angelegt":type==="violation"?"⚠️ Regelverstoß / Verwarnung":type==="deleted"?"🗑️ Charakter gelöscht":"✏️ Charakter bearbeitet",
      color:type==="violation"?0xe11d48:type==="deleted"?0x6b7280:type==="created"?0x22c55e:0xa855f7,
      fields:[
        {name:"ID",value:char.id||"—",inline:true},{name:"Charakter",value:char.name||"—",inline:true},
        {name:"Spieler",value:char.player||"—",inline:true},{name:"Steam-ID",value:char.steamId||"—",inline:true},
        {name:"Volk",value:char.race||"—",inline:true},{name:"Status",value:char.status||"aktiv",inline:true},
        {name:"Verwarnungen",value:String(char.warnings??0),inline:true},
        ...(char.violation?[{name:"Regelverstoß",value:String(char.violation).slice(0,1000),inline:false}]:[])
      ],footer:{text:"Chroniken · Charakterverwaltung"},timestamp:new Date().toISOString()
    }]})})}catch(e){console.warn("Charakter-Proxy:",e)}
  }

  async function remoteChars(){
    try{const v=await ChronikenStorage.load("characters");return Array.isArray(v)?v:[]}catch{return local()}
  }
  async function writeChars(list){
    saveLocal(list);
    try{await ChronikenStorage.save("characters",list)}catch(e){console.warn("Charaktere zentral speichern:",e)}
  }
  async function getSheet(id){
    try{const sheets=await ChronikenSync.loadShared("characterSheets");return sheets.find(x=>x.id===id)||null}catch{return null}
  }

  const SHEET_FIELDS=[
    ["Allgemein",[["Charaktername","name"],["Discord","discordName"],["Steam-ID","steamId"],["Geburtstag","@birthday"],["Alter","age"],["Geschlecht","gender"],["Größe","size"],["Gesinnung","alignment"],["Gott/Göttin","god"]]],
    ["Volk & Beruf",[["Volk","race"],["Unterarten","subraces"],["Hauptberuf","mainJob"],["Nebenberuf","subJob"]]],
    ["Verwandlung & Magie",[["Verwandlung","transformInput"],["Magieschulen","magicSchools"],["Magie-Details","magicDetails"],["Magieregeln akzeptiert","@magicRules"]]],
    ["Aussehen & Anhängsel",[["Haare","hairInput"],["Augen","eyesInput"],["Aussehen","appearanceInput"],["Ohren","earsInput"],["Flügel","wingsInput"],["Schwanz","tailInput"],["Sonstiges","otherInput"]]],
    ["Hintergrund",[["Hintergrund","background"],["Ziele & Vorhaben","goalsInput"],["Fähigkeiten","abilities"],["Eigenschaften","traits"]]],
    ["OOC",[["Größen-Sonderfreigabe","@sizeOk"],["Fesseln & Versklavung akzeptiert","@consent"],["OOC-Phobien / Grenzen","phobias"]]]
  ];
  function sheetValue(d,key){
    if(key==="@birthday"){if(d.birthdayDay===undefined&&d.birthdayMonth===undefined&&!d.birthdayYear)return"";return[d.birthdayDay?d.birthdayDay+".":"",d.birthdayMonth!==undefined?MONTHS[Number(d.birthdayMonth)]||"":"",d.birthdayYear||""].filter(Boolean).join(" ")}
    if(key==="@magicRules")return d.magicRulesAccepted?"Ja"+(d.verifiedUsername?" – von "+d.verifiedUsername:""):"";
    if(key==="@sizeOk")return d.sizeConfirmed?"Ja"+(d.sizeVerifiedUsername?" – von "+d.sizeVerifiedUsername:""):"";
    if(key==="@consent")return d.consentAccepted?"Ja"+(d.consentVerifiedUsername?" – von "+d.consentVerifiedUsername:""):"";
    const v=d[key];return Array.isArray(v)?v.join(", "):(v==null?"":String(v));
  }

  function renderTable(list){
    const body=get("charAdminBody"),empty=get("charAdminEmpty"),table=get("charAdminTable"),count=get("charAdminCount");
    if(!body)return;
    count.textContent=list.length+" Charakter"+(list.length===1?"":"e");
    if(!list.length){table.hidden=true;empty.hidden=false;body.innerHTML="";return}
    empty.hidden=true;table.hidden=false;
    body.innerHTML=list.slice().sort((a,b)=>(a.id||"").localeCompare(b.id||"")).map(c=>{
      const w=Number(c.warnings)||0;
      return '<tr><td><strong class="char-id">'+esc(c.id)+'</strong></td><td><strong>'+esc(c.name)+'</strong><div class="muted">'+esc(c.race||"")+'</div></td><td>'+esc(c.player||"—")+'</td><td>'+esc(c.steamId||"—")+'</td><td><span class="warn-badge '+(w===0?"zero":"")+'">'+w+'</span></td><td>'+esc(c.violation||"—")+'</td><td>'+esc(c.status||"aktiv")+'</td><td class="char-actions"><button class="btn small" data-sheet="'+esc(c.id)+'">Bogen</button><button class="btn small" data-edit="'+esc(c.id)+'">Bearbeiten</button><button class="btn small danger" data-delete="'+esc(c.id)+'">Löschen</button></td></tr>'
    }).join("");
    body.querySelectorAll("[data-sheet]").forEach(b=>b.onclick=()=>openSheet(b.dataset.sheet));
    body.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editChar(b.dataset.edit));
    body.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deleteChar(b.dataset.delete));
  }

  async function refresh(){renderTable(await remoteChars())}

  function resetForm(){
    get("charAdminForm").reset();get("charAdminEditId").value="";get("charAdminId").value="";
    get("charAdminWarnings").value="0";get("charAdminStatus").value="aktiv";
    get("charAdminTitle").textContent="Neuer Charakterbogen";get("charAdminSave").textContent="Speichern";get("charAdminCancel").hidden=true;
  }
  async function editChar(id){
    const c=(await remoteChars()).find(x=>x.id===id);if(!c)return;
    get("charAdminEditId").value=c.id;get("charAdminId").value=c.id;get("charAdminName").value=c.name||"";
    get("charAdminPlayer").value=c.player||"";get("charAdminSteam").value=c.steamId||"";get("charAdminRace").value=c.race||"";
    get("charAdminWarnings").value=c.warnings??0;get("charAdminStatus").value=c.status||"aktiv";get("charAdminViolation").value=c.violation||"";get("charAdminNotes").value=c.notes||"";
    get("charAdminTitle").textContent="Charakter bearbeiten · "+c.id;get("charAdminSave").textContent="Aktualisieren";get("charAdminCancel").hidden=false;
    get("charAdminName").focus();
  }
  async function deleteChar(id){
    const list=await remoteChars(),c=list.find(x=>x.id===id);if(!c||!confirm("Charakter "+id+" wirklich löschen?"))return;
    await writeChars(list.filter(x=>x.id!==id));
    try{await ChronikenSync.removeCharacter(id)}catch(e){console.warn(e)}
    await notify("deleted",c);if(get("charAdminEditId").value===id)resetForm();refresh();
  }

  async function openSheet(id){
    const modal=get("charAdminSheetModal"),body=get("charAdminSheetBody");modal.hidden=false;body.innerHTML='<p class="muted">Lade Bogen …</p>';
    const list=await remoteChars(),c=list.find(x=>x.id===id)||{},sh=await getSheet(id);
    if(!sh||!sh.data){body.innerHTML='<p class="muted">Für <strong>'+esc(id)+'</strong> ist keine Bogen-Kopie gespeichert.</p>';return}
    const d=sh.data;let html="",txt=id+" – "+(sh.name||c.name||"")+"\n";
    SHEET_FIELDS.forEach(([sec,fields])=>{const rows=fields.map(([l,k])=>[l,sheetValue(d,k)]).filter(x=>x[1]);if(!rows.length)return;html+='<h4>'+esc(sec)+'</h4>'+rows.map(r=>'<div class="sheet-row"><b>'+esc(r[0])+'</b><span>'+esc(r[1])+'</span></div>').join("");txt+="\n["+sec+"]\n"+rows.map(r=>r[0]+": "+r[1]).join("\n")+"\n"});
    body.innerHTML=html||'<p class="muted">Der Bogen enthält keine Angaben.</p>';get("charAdminSheetText").value=txt;
  }

  async function init(){
    if(!get("charAdmin"))return;
    const user=await guard();if(!user)return;
    try{sessionStorage.setItem("portal_admin_auth","1")}catch{}
    get("charAdminForm").onsubmit=async e=>{
      e.preventDefault();const name=get("charAdminName").value.trim();if(!name)return;
      const list=await remoteChars(),editId=get("charAdminEditId").value,old=editId?list.find(c=>c.id===editId):null;
      const payload={name,player:get("charAdminPlayer").value.trim(),steamId:get("charAdminSteam").value.trim(),race:get("charAdminRace").value,status:get("charAdminStatus").value,warnings:Math.max(0,parseInt(get("charAdminWarnings").value,10)||0),violation:get("charAdminViolation").value.trim(),notes:get("charAdminNotes").value.trim(),updatedAt:new Date().toISOString()};
      let saved,type="created";
      if(editId){const i=list.findIndex(c=>c.id===editId);if(i<0)return;list[i]={...list[i],...payload};saved=list[i];type=payload.violation!==old?.violation||payload.warnings>(Number(old?.warnings)||0)?"violation":"updated"}
      else{saved={id:nextId(),createdAt:new Date().toISOString(),...payload};list.push(saved)}
      await writeChars(list);
      try{await ChronikenSync.saveCharacter(saved)}catch(e){console.warn(e)}
      await notify(type,saved);resetForm();refresh();
    };
    get("charAdminCancel").onclick=resetForm;
    get("charAdminClose").onclick=()=>get("charAdminSheetModal").hidden=true;
    get("charAdminCopy").onclick=async()=>{try{await navigator.clipboard.writeText(get("charAdminSheetText").value);get("charAdminCopyMsg").textContent="✓ Kopiert"}catch{get("charAdminCopyMsg").textContent="Kopieren nicht möglich"}};
    get("charAdminSheetModal").onclick=e=>{if(e.target===get("charAdminSheetModal"))get("charAdminSheetModal").hidden=true};
    await refresh();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();