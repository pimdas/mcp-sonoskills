const $=s=>document.querySelector(s);
let status, lastSync=null;
let workspace=new URL(location.href).searchParams.get('workspace')||'all';
workspace=normalizeWorkspace(workspace);
function normalizeWorkspace(value){const key=({fixed:'handson',flexible:'elearning'})[value]||value;return ['all','handson','elearning','ondemand','live','products','external','royalties','other'].includes(key)?key:'all';}
const bookingWorkspace=()=>['elearning','ondemand','products'].includes(workspace);
const opened=new Set();
let mappingLoaded=false;
async function api(path,body){const r=await fetch(path,body!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:JSON.stringify(body)}:{});const d=await r.json();if(r.status===401 && path!=='/api/login'){showLogin();throw Error('Log opnieuw in.');}if(!r.ok)throw Error(d.error||'Er ging iets mis.');return d;}
function showLogin(){$('#login').hidden=false;$('#dashboard').hidden=true;}
function element(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function params(){return new URLSearchParams([['workspace',workspace],...[...new FormData($('#filters'))].filter(([,v])=>v)]);}
async function load(){
  if(workspace==='royalties')return loadRoyalties();
  const d=await api('/api/analytics?'+params());
  for(const key of ['templates','editions','enrollments','returning'])$('#'+key).textContent=status?.syncedAt?d.metrics[key].toLocaleString('nl-NL'):'—';
  $('#occupancy').textContent=bookingWorkspace()?(status?.syncedAt?d.metrics.students.toLocaleString('nl-NL'):'—'):(d.metrics.occupancy==null?'—':d.metrics.occupancy+'%');
  const missing=d.workspaceMapping.filter(w=>!w.categoryIds.length).map(w=>w.name);$('#migration-note').hidden=!missing.length;$('#migration-note').textContent=missing.length?'Nog geen categorie gekoppeld voor: '+missing.join(', ')+'. Controleer de indeling onder Databronnen.':'';$('#other-workspace').hidden=!d.unassigned;$('#finance-panel').hidden=!d.financeEnabled;
  for(const key of ['category','course','location']){
    const select=$(`[name=${key}]`),selected=select.value;
    select.replaceChildren(element('option',{category:'Alle categorieën',course:'Alle templates',location:'Alle locaties'}[key]));select.firstChild.value='';
    if(key==='category'){const option=element('option','Zonder categorie');option.value='none';select.append(option);}
    for(const item of d.options[{category:'categories',course:'courses',location:'locations'}[key]]){const option=element('option',item.name);option.value=item.id;select.append(option);}select.value=selected;
  }
  const labels={active:'Actief',completed:'Afgerond',planned:'Gepland',canceled:'Geannuleerd'};
  $('#template-groups').replaceChildren();let previous=null;
  for(const template of d.templates){
    if(template.category!==previous){$('#template-groups').append(element('h3',template.category,'category-title'));previous=template.category;}
    const details=element('details','','template-card');details.open=opened.has(template.id);
    details.addEventListener('toggle',()=>details.open?opened.add(template.id):opened.delete(template.id));
    const summary=element('summary',''),title=element('div','','template-name');title.append(element('strong',template.name),element('small',`Template #${template.id}${template.code?' · '+template.code:''}`));
    summary.append(title,element('span',`${template.editions.length} edities`,'badge'),element('span',`${template.participants} inschrijvingen`,'badge'));details.append(summary);
    if(template.workspace==='elearning'){const action=element('button','Royaltyafspraak instellen','subtle royalty-template-action');action.type='button';action.onclick=async()=>{document.querySelector('[data-workspace=royalties]').click();await loadRoyalties();$('#royalty-agreement').elements.courseId.value=template.id;$('#royalty-agreement').scrollIntoView({behavior:'smooth',block:'center'});$('#royalty-agreement').elements.recipient.focus();};details.append(action);}
    const scroll=element('div','','table-scroll'),table=element('table',''),head=element('thead',''),heading=element('tr','');
    for(const text of ['Editie','Variant','Type','Locatie','Startdatum','Einddatum','Status','Deelnemers','Bezetting'])heading.append(element('th',text));head.append(heading);table.append(head);
    const body=element('tbody','');
    for(const row of template.editions){const tr=element('tr','');
      const date=row.type==='flexible'?'Flexibele start':row.start?new Date(row.start.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'Geen startdatum';
      for(const text of [`#${row.id}`,row.variant,{fixed:'Vast',flexible:'Flexibel',unknown:'Onbekend'}[row.type],row.type==='flexible'&&row.location==='Onbekend'?'—':row.location,date,row.end?new Date(row.end.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'—',labels[row.status]||row.status,row.participants+(row.capacity&&row.type!=='flexible'?' / '+row.capacity:''),row.occupancy==null?'—':row.occupancy+'%'])tr.append(element('td',text));body.append(tr);
    }
    if(!template.editions.length){const tr=element('tr',''),td=element('td','Dit template heeft nog geen edities.');td.colSpan=9;tr.append(td);body.append(tr);}
    table.append(body);scroll.append(table);details.append(scroll);$('#template-groups').append(details);
  }
  if(!d.templates.length)$('#template-groups').append(element('p',status?.syncedAt?'Geen templates met edities binnen deze selectie.':'Je templates en edities verschijnen na de eerste synchronisatie.'));
  $('#finance').replaceChildren();for(const [currency,totals] of Object.entries(d.totals)){for(const [key,label] of [['invoiced','Gefactureerd'],['open','Openstaand']]){const row=element('div','','finance-row');row.append(element('span',label),element('strong',currency==='ONBEKEND'?totals[key]+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(totals[key])));$('#finance').append(row);}}
  if(!Object.keys(d.totals).length)$('#finance').append(element('p','Nog geen facturen in deze selectie.'));
  $('#chart').replaceChildren();const months=Object.entries(d.months).sort(([a],[b])=>a.localeCompare(b));const max=Math.max(1,...months.map(([,v])=>v));for(const [month,count] of months){const wrap=element('div','','bar-wrap'),bar=element('progress','','bar');bar.max=max;bar.value=count;bar.title=`${month}: ${count} inschrijvingen`;wrap.append(element('span',String(count)),bar,element('span',month));$('#chart').append(wrap);}
  if(!months.length)$('#chart').append(element('p','Nog geen inschrijvingen om te tonen.'));
}
async function refresh(){status=await api('/api/status');$('#login').hidden=true;$('#dashboard').hidden=false;$('#empty').hidden=!!status.syncedAt;$('#sync').disabled=status.syncing||!status.configured;$('#sync').textContent=status.syncing?'Synchroniseren…':'↻ Synchroniseren';$('#source-status').textContent=status.syncing?'Gegevens worden opgehaald…':status.error?'Synchronisatie mislukt':status.configured?'API-key ingesteld':'API-key nog niet ingesteld';$('#source-badge').textContent=status.syncedAt?'Verbonden':status.configured?'Gereed voor import':'Niet gekoppeld';$('#message').textContent=status.error||'';$('#last-sync').textContent=status.syncedAt?'Laatste succesvolle synchronisatie: '+new Date(status.syncedAt).toLocaleString('nl-NL'):'Nog geen synchronisatie uitgevoerd';if(lastSync!==status.syncedAt){lastSync=status.syncedAt;await load();}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/login',{email:$('#email').value,password:$('#password').value});$('#password').value='';$('#login-error').textContent='';await refresh();await load();if(!mappingLoaded)await loadWorkspaceMapping();}catch(err){$('#login-error').textContent=err.message;}finally{b.disabled=false;}});
$('#logout').onclick=async()=>{await api('/api/logout',{});showLogin();};
$('#sync').onclick=async()=>{try{await api('/api/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#filters').onsubmit=async e=>{e.preventDefault();try{await load();$('#message').textContent='';}catch(err){$('#message').textContent=err.message;}};
$('#filters').onreset=()=>setTimeout(()=>load().catch(e=>$('#message').textContent=e.message),0);
$('#export').onclick=()=>{window.location.href='/api/export?'+params();};
function showWorkspace(){
  for(const id of ['overview','courses'])$('#'+id).hidden=workspace==='royalties';
  $('#royalties').hidden=workspace!=='royalties';
  const info={royalties:['Royalties','Afspraken en afrekeningen over ontvangen eLearning-omzet.'],all:['Overzicht','Eigen templates en edities; externe cursussen staan apart.'],handson:['Hands-on cursussen','Templates en edities uit de categorie Hands-on, met cursusdata en locaties.'],elearning:['Online · eLearning','Alle templates en toegangsduurvarianten uit de categorie eLearning.'],ondemand:['Online · On-demand solo classes','Templates en edities uit de categorie On-demand solo classes.'],live:['Online · Live solo classes','Live online cursussen en hun geplande edities.'],products:['Producten','Alle templates uit de categorie Producten.'],external:['Extern','Partnercursussen voor planning, cursusedata en locaties; zonder omzetoverzicht.'],other:['Overige templates','Templates die nog niet aan een werkruimte zijn gekoppeld.']}[workspace];
  $('#workspace-title').textContent=info[0];$('#workspace-description').textContent=info[1];
  $('#from-label').textContent=bookingWorkspace()?'Geboekt vanaf':'Cursus start vanaf';
  $('#third-label').textContent=bookingWorkspace()?'Unieke deelnemers':'Gemiddelde bezetting';
  $('#third-description').textContent=bookingWorkspace()?'Binnen de gekozen boekingsperiode':'Gewogen naar capaciteit';
  $('#period-note').textContent=workspace==='external'?'Externe cursussen worden apart getoond en tellen niet mee in het eigen omzetoverzicht. Periode: startdatum van de editie.':bookingWorkspace()?'Periode: boekingsdatum. Templates en edities blijven zichtbaar; aantallen en facturen horen bij orders uit deze boekingsperiode.':'Periode: startdatum van de editie. Bij een datumselectie vallen edities zonder startdatum buiten de selectie.';
  for(const b of document.querySelectorAll('[data-workspace]')){b.classList.toggle('selected',b.dataset.workspace===workspace);b.setAttribute('aria-pressed',String(b.dataset.workspace===workspace));}
}
for(const b of document.querySelectorAll('[data-workspace]'))b.onclick=async()=>{
  workspace=b.dataset.workspace;opened.clear();for(const key of ['category','course','location'])$('#filters').elements[key].value='';showWorkspace();
  const url=new URL(location.href);url.searchParams.set('workspace',workspace);history.pushState({},'',url);
  try{await load();}catch(e){$('#message').textContent=e.message;}
};
window.addEventListener('popstate',()=>{workspace=new URL(location.href).searchParams.get('workspace')||'all';workspace=normalizeWorkspace(workspace);showWorkspace();load().catch(e=>$('#message').textContent=e.message);});
$('#filters').elements.category.onchange=()=>{$('#filters').elements.course.value='';};
showWorkspace();refresh().then(async()=>{await load();await loadWorkspaceMapping();}).catch(()=>showLogin());setInterval(()=>{if(!$('#dashboard').hidden)refresh().catch(e=>$('#message').textContent=e.message);},5000);

async function loadWorkspaceMapping(){
 const d=await api('/api/workspaces');$('#workspace-category-fields').replaceChildren();
 for(const def of d.definitions){const label=element('label',def.name),select=element('select','');select.multiple=true;select.size=5;select.name=def.id;for(const c of d.categories){const o=element('option',c.name);o.value=c.id;o.selected=def.categoryIds.includes(c.id);select.append(o);}label.append(select);$('#workspace-category-fields').append(label);}
 mappingLoaded=true;
}
$('#workspace-mapping').onsubmit=async e=>{e.preventDefault();const mapping={};for(const s of e.target.querySelectorAll('select'))mapping[s.name]=[...s.selectedOptions].map(o=>Number(o.value));try{await api('/api/workspaces',{mapping});$('#workspace-mapping-message').textContent='Indeling opgeslagen. Synchroniseer om ook de betalingsimport aan de eLearning-categorie aan te passen.';for(const key of ['category','course','location'])$('#filters').elements[key].value='';await load();}catch(err){$('#workspace-mapping-message').textContent=err.message;}};
$('#workspace-auto').onclick=async()=>{try{await api('/api/workspaces',{mapping:{}});await loadWorkspaceMapping();await load();$('#workspace-mapping-message').textContent='Automatische categorie-indeling hersteld.';}catch(e){$('#workspace-mapping-message').textContent=e.message;}};
