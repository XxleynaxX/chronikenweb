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
  const RULE_SECTION_NUMBERS={bau:1,rp:2,erp:3,gefangenschaft:4,stadt:5,charakter:6,magie:7,abwesenheit:8,chat:9,begriffe:10};

  function letterFromNumber(n){
    let result="";
    n=Number(n)||1;
    while(n>0){n--;result=String.fromCharCode(65+(n%26))+result;n=Math.floor(n/26)}
    return result;
  }

  function categoryRuleId(category,n){
    const section=RULE_SECTION_NUMBERS[category];
    return section ? "R-"+section+"-"+letterFromNumber(n) : "";
  }

  async function loadRuleIndex(){
    /*
      Die Regel-ID-Auflösung kommt bewusst direkt von regeln.html.
      Damit verwendet die Charakterverwaltung exakt dasselbe ID-System
      wie die öffentliche Regelseite und nicht eine zweite, abweichende
      Kopie der Regelnummerierung.
    */
    try{
      const iframe=document.createElement("iframe");
      iframe.hidden=true;
      iframe.setAttribute("aria-hidden","true");
      iframe.src="../regeln.html?ruleIndex="+Date.now();

      const index=await new Promise(resolve=>{
        let finished=false;
        const finish=value=>{
          if(finished)return;
          finished=true;
          try{iframe.remove()}catch{}
          resolve(value||{});
        };

        const read=()=>{
          try{
            const doc=iframe.contentDocument;
            if(!doc)return finish({});
            const ids=doc.querySelectorAll(".inline-rule-id");
            if(!ids.length)return null;

            const result={};
            ids.forEach(span=>{
              const id=(span.textContent||"").trim().toUpperCase();
              if(!/^R-\d+-[A-Z]+$/.test(id))return;

              const li=span.closest("li");
              if(!li)return;

              const clone=li.cloneNode(true);
              clone.querySelectorAll(".inline-rule-id").forEach(x=>x.remove());

              const text=(clone.textContent||"")
                .replace(/\s+/g," ")
                .trim();

              if(text)result[id]={
                id,
                category:"",
                title:"Regel",
                text
              };
            });

            finish(result);
          }catch(e){
            console.warn("Regelindex aus regeln.html konnte nicht gelesen werden:",e);
            finish({});
          }
        };

        iframe.addEventListener("load",()=>{
          let tries=0;
          const wait=()=>{
            tries++;
            const doc=iframe.contentDocument;
            const ids=doc?.querySelectorAll(".inline-rule-id");
            if(ids?.length)return read();
            if(tries>=40)return finish({});
            setTimeout(wait,150);
          };
          wait();
        });

        document.body.appendChild(iframe);
      });

      if(Object.keys(index).length){
        return index;
      }

      console.warn("Regel-ID-System lieferte keine Regel-IDs.");
      return {};
    }catch(e){
      console.warn("Regelindex konnte nicht geladen werden:",e);
      return {};
    }
  }

  let ruleIndex={};

  function parseViolationIds(value){
    return [...new Set(String(value||"").toUpperCase().split(/[,,;\s]+/).map(x=>x.trim()).filter(Boolean))];
  }

  function resolveViolations(value){
    const ids=parseViolationIds(value);
    return ids.map(id=>ruleIndex[id]||{id,text:"Unbekannte Regel-ID"});
  }

  function violationTexts(char){
    if(Array.isArray(char?.violationTexts)&&char.violationTexts.length){
      return char.violationTexts.map(x=>String(x).trim()).filter(Boolean);
    }
    if(Array.isArray(char?.violationDetails)&&char.violationDetails.length){
      const details=char.violationDetails.map(x=>String(x).replace(/^[A-Z0-9-]+\s*·\s*/,"").trim()).filter(Boolean);
      if(details.length)return details;
    }
    const ids=Array.isArray(char?.violationIds)&&char.violationIds.length
      ?char.violationIds
      :parseViolationIds(char?.violation||"");
    return ids.map(id=>ruleIndex[id]?.text||"").filter(Boolean);
  }

  async function violationTextsForNotification(char){
    // Beim Speichern werden die Regeltexte bereits im Datensatz abgelegt.
    // Falls ein älterer Datensatz diese Texte noch nicht besitzt, wird die
    // aktuelle Regelseite einmal direkt nach dem ID-System durchsucht.
    let texts=violationTexts(char);
    if(texts.length)return texts;

    ruleIndex=await loadRuleIndex();
    texts=violationTexts(char);
    return texts;
  }

  function updateViolationPreview(){
    const field=get("charAdminViolation"), preview=get("charAdminViolationResolved");
    if(!field||!preview)return;
    const ids=parseViolationIds(field.value);
    if(!ids.length){preview.textContent="";return}
    const resolved=resolveViolations(field.value);
    preview.innerHTML=resolved.map(r=>r.text==="Unbekannte Regel-ID"
      ? '<div style="color:#fb7185"><strong>'+esc(r.id)+'</strong> · Unbekannte Regel-ID</div>'
      : '<div><strong class="char-id">'+esc(r.id)+'</strong> · '+esc(r.text)+'</div>').join("");
  }


  async function notify(type,char){
    try{
      const violations=await violationTextsForNotification(char);
      const fields=[
        {name:"ID",value:char.id||"—",inline:true},
        {name:"Charakter",value:char.name||"—",inline:true},
        {name:"Spieler",value:char.player||"—",inline:true},
        {name:"Steam-ID",value:char.steamId||"—",inline:true},
        {name:"Volk",value:char.race||"—",inline:true},
        {name:"Status",value:char.status||"aktiv",inline:true},
        {name:"Verwarnungen",value:String(char.warnings??0),inline:true}
      ];

      // In Discord genauso anzeigen wie unter "Registrierte Charakterbögen":
      // nur der eigentliche Regeltext, niemals die Regel-ID.
      if(violations.length){
        fields.push({
          name:"Regelverstoß",
          value:violations.join("\n").slice(0,1800),
          inline:false
        });
      }

      await fetch(CHARACTER_PROXY_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          username:"Chroniken Admin",
          embeds:[{
            title:type==="created"?"🆕 Charakter angelegt":type==="violation"?"⚠️ Regelverstoß / Verwarnung":type==="deleted"?"🗑️ Charakter gelöscht":"✏️ Charakter bearbeitet",
            color:type==="violation"?0xe11d48:type==="deleted"?0x6b7280:type==="created"?0x22c55:0xa855f7,
            fields,
            footer:{text:"Chroniken · Charakterverwaltung"},
            timestamp:new Date().toISOString()
          }]
        })
      });
    }catch(e){console.warn("Charakter-Proxy:",e)}
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
      const violationText=violationTexts(c).length?violationTexts(c).map(x=>esc(x)).join("<br>"):"—";
      return '<tr><td><strong class="char-id">'+esc(c.id)+'</strong></td><td><strong>'+esc(c.name)+'</strong><div class="muted">'+esc(c.race||"")+'</div></td><td>'+esc(c.player||"—")+'</td><td>'+esc(c.steamId||"—")+'</td><td><span class="warn-badge '+(w===0?"zero":"")+'">'+w+'</span></td><td>'+violationText+'</td><td>'+esc(c.status||"aktiv")+'</td><td class="char-actions"><button class="btn small" data-sheet="'+esc(c.id)+'">Bogen</button><button class="btn small" data-edit="'+esc(c.id)+'">Bearbeiten</button><button class="btn small danger" data-delete="'+esc(c.id)+'">Löschen</button></td></tr>'
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
    get("charAdminWarnings").value=c.warnings??0;get("charAdminStatus").value=c.status||"aktiv";get("charAdminViolation").value=c.violationIds?.join(", ")||c.violation||"";updateViolationPreview();get("charAdminNotes").value=c.notes||"";
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
      const violationInput=get("charAdminViolation").value.trim();
      const violationIds=parseViolationIds(violationInput);
      const resolvedViolations=resolveViolations(violationInput);
      const resolvedKnown=resolvedViolations.filter(r=>r.text && r.text!=="Unbekannte Regel-ID");
      const violationDetails=resolvedKnown.map(r=>r.id+" · "+r.text);
      const violationTextsStored=resolvedKnown.map(r=>r.text);
      const payload={name,player:get("charAdminPlayer").value.trim(),steamId:get("charAdminSteam").value.trim(),race:get("charAdminRace").value,status:get("charAdminStatus").value,warnings:Math.max(0,parseInt(get("charAdminWarnings").value,10)||0),violation:violationIds.join(", "),violationIds,violationDetails,violationTexts:violationTextsStored,notes:get("charAdminNotes").value.trim(),updatedAt:new Date().toISOString()};
      let saved,type="created";
      if(editId){const i=list.findIndex(c=>c.id===editId);if(i<0)return;list[i]={...list[i],...payload};saved=list[i];type=payload.violation!==old?.violation||payload.warnings>(Number(old?.warnings)||0)?"violation":"updated"}
      else{saved={id:nextId(),createdAt:new Date().toISOString(),...payload};list.push(saved)}
      await writeChars(list);
      try{await ChronikenSync.saveCharacter(saved)}catch(e){console.warn(e)}
      await notify(type,saved);resetForm();refresh();
    };
    get("charAdminViolation").addEventListener("input",updateViolationPreview);
    ruleIndex=await loadRuleIndex();
    updateViolationPreview();
    get("charAdminCancel").onclick=resetForm;
    get("charAdminClose").onclick=()=>get("charAdminSheetModal").hidden=true;
    get("charAdminCopy").onclick=async()=>{try{await navigator.clipboard.writeText(get("charAdminSheetText").value);get("charAdminCopyMsg").textContent="✓ Kopiert"}catch{get("charAdminCopyMsg").textContent="Kopieren nicht möglich"}};
    get("charAdminSheetModal").onclick=e=>{if(e.target===get("charAdminSheetModal"))get("charAdminSheetModal").hidden=true};
    await refresh();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();