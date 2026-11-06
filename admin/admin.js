const ADMIN_API=(window.CHRONIKEN_ADMIN_API||'https://chronikenweb-1.onrender.com').replace(/\/$/,'');
async function api(path,options={}){const r=await fetch(ADMIN_API+path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'API-Fehler '+r.status);return d}
async function me(){return api('/auth/me')}
function login(){location.href=ADMIN_API+'/auth/login?return='+encodeURIComponent(location.href.split('#')[0])}
async function guard(){try{const m=await me();if(!m.ok||!m.admin)throw new Error('no-admin');document.querySelectorAll('#app').forEach(x=>x.hidden=false);document.querySelector('#locked')?.setAttribute('hidden','');const u=document.querySelector('#user');if(u)u.textContent='👤 '+(m.name||'Admin');return m}catch(e){const a=document.querySelector('#app');if(a)a.hidden=true;const l=document.querySelector('#locked');if(l)l.hidden=false;document.querySelector('#login')?.addEventListener('click',login);return null}}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function statusText(s){return({open:'Offen',working:'In Arbeit',waiting:'Wartet',blocked:'Blockiert',done:'Fertig'})[s]||s}
function priorityText(s){return({low:'Niedrig',normal:'Normal',high:'Hoch',critical:'Kritisch'})[s]||s}
function fmtDate(v){if(!v)return'Keine Frist';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}