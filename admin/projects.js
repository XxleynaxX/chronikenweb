(async()=>{
  const auth=await guard();
  if(!auth)return;

  const modal=document.getElementById('modal');
  const form=document.getElementById('form');
  const idEl=document.getElementById('id');
  const nameEl=document.getElementById('name');
  const descriptionEl=document.getElementById('description');
  const statusEl=document.getElementById('status');
  const newBtn=document.getElementById('new');
  const cancelBtn=document.getElementById('cancel');
  const listEl=document.getElementById('list');

  let list=[];

  function showError(message){
    let box=document.getElementById('projectError');
    if(!box){
      box=document.createElement('div');
      box.id='projectError';
      box.style.cssText='margin-bottom:15px;padding:12px 14px;border:1px solid #7f1d1d;background:#2a1115;color:#fecaca;border-radius:10px;';
      listEl.parentNode.insertBefore(box,listEl);
    }
    box.textContent='❌ '+message;
    box.hidden=false;
  }

  function clearError(){
    const box=document.getElementById('projectError');
    if(box)box.hidden=true;
  }

  async function load(){
    clearError();
    try{
      const data=await api('/admin/projects');
      list=Array.isArray(data.projects)?data.projects:[];

      // Fallback: falls der Backend-Deploy die Statistik noch nicht liefert,
      // berechnen wir sie direkt aus den gespeicherten Aufgaben.
      let tasks=[];
      try{
        const taskData=await api('/admin/tasks');
        tasks=Array.isArray(taskData.tasks)?taskData.tasks:[];
      }catch{}
      const stats={};
      tasks.forEach(t=>{
        const id=String(t.project_id||'');
        if(!id)return;
        if(!stats[id])stats[id]={task_count:0,done_count:0,working_count:0,open_count:0};
        stats[id].task_count++;
        if(t.status==='done')stats[id].done_count++;
        else if(t.status==='working')stats[id].working_count++;
        else if(t.status==='open')stats[id].open_count++;
      });
      list=list.map(p=>{
        const s=stats[String(p.id)]||{};
        return {...p,
          task_count:Number(p.task_count)||Number(s.task_count)||0,
          done_count:Number(p.done_count)||Number(s.done_count)||0,
          working_count:Number(p.working_count)||Number(s.working_count)||0,
          open_count:Number(p.open_count)||Number(s.open_count)||0
        };
      });
      listEl.innerHTML=list.length
        ? list.map(p=>'<div class="row" style="padding:15px 0;border-bottom:1px solid #29203b;display:flex;justify-content:space-between;gap:15px"><div><strong>'+esc(p.name)+'</strong><div class="muted">'+esc(p.description||'')+' · '+esc(p.status)+'</div><div class="muted" style="margin-top:7px">→ '+Number(p.task_count||0)+' Aufgaben &nbsp; · &nbsp; ✓ '+Number(p.done_count||0)+' erledigt &nbsp; · &nbsp; 🔧 '+Number(p.working_count||0)+' in Arbeit &nbsp; · &nbsp; ○ '+Number(p.open_count||0)+' offen</div></div><div><button type="button" class="btn small" data-e="'+p.id+'">Bearbeiten</button> <button type="button" class="btn small" data-d="'+p.id+'">Löschen</button></div></div>').join('')
        : '<div class="muted">Noch keine Projekte.</div>';

      list.forEach(p=>{
        document.querySelector('[data-e="'+p.id+'"]')?.addEventListener('click',()=>openProject(p));
        document.querySelector('[data-d="'+p.id+'"]')?.addEventListener('click',async()=>{
          if(!confirm('Projekt löschen?'))return;
          try{
            await api('/admin/projects/'+encodeURIComponent(p.id),{method:'DELETE'});
            await load();
          }catch(e){showError(e.message||'Projekt konnte nicht gelöscht werden.');}
        });
      });
    }catch(e){
      showError(e.message||'Projekte konnten nicht geladen werden.');
    }
  }

  function openProject(p={}){
    idEl.value=p.id||'';
    nameEl.value=p.name||'';
    descriptionEl.value=p.description||'';
    statusEl.value=p.status||'active';
    modal.hidden=false;
    nameEl.focus();
  }

  newBtn?.addEventListener('click',()=>openProject());
  cancelBtn?.addEventListener('click',()=>{modal.hidden=true;});

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    clearError();

    const name=nameEl.value.trim();
    if(!name){
      showError('Bitte einen Projektnamen eingeben.');
      nameEl.focus();
      return;
    }

    const projectId=idEl.value.trim();
    const body={
      name,
      description:descriptionEl.value.trim(),
      status:statusEl.value
    };

    const button=form.querySelector('button[type="submit"]');
    if(button)button.disabled=true;

    try{
      await api(projectId
        ? '/admin/projects/'+encodeURIComponent(projectId)
        : '/admin/projects',{
          method:projectId?'PUT':'POST',
          body:JSON.stringify(body)
        });

      modal.hidden=true;
      await load();
    }catch(e){
      showError(e.message||'Projekt konnte nicht gespeichert werden.');
    }finally{
      if(button)button.disabled=false;
    }
  });

  await load();
})();