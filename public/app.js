const $=s=>document.querySelector(s);
let status, lastSync=null;
let workspace=new URL(location.href).searchParams.get('workspace')||'all';
if(!['all','fixed','flexible','royalties'].includes(workspace))workspace='all';
const opened=new Set();
async function api(path,body){const r=await fetch(path,body!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:JSON.stringify(body)}:{});const d=await r.json();if(r.status===401 && path!=='/api/login'){showLogin();throw Error('Log opnieuw in.');}if(!r.ok)throw Error(d.error||'Er ging iets mis.');return d;}
function showLogin(){$('#login').hidden=false;$('#dashboard').hidden=true;}
function element(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function params(){return new URLSearchParams([['workspace',workspace],...[...new FormData($('#filters'))].filter(([,v])=>v)]);}
async function load(){
  if(workspace==='royalties')return loadRoyalties();
  const d=await api('/api/analytics?'+params());
  for(const key of ['templates','editions','enrollments','returning'])$('#'+key).textContent=status?.syncedAt?d.metrics[key].toLocaleString('nl-NL'):'—';
  $('#occupancy').textContent=workspace==='flexible'?(status?.syncedAt?d.metrics.students.toLocaleString('nl-NL'):'—'):(d.metrics.occupancy==null?'—':d.metrics.occupancy+'%');
  $('#migration-note').hidden=!d.unknownTypes;$('#migration-note').textContent=`Van ${d.unknownTypes} edities is het type nog niet bekend. Synchroniseer om deze in de juiste werkruimte te plaatsen.`;
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
    if(template.editions.some(e=>e.type==='flexible')){const action=element('button','Royaltyafspraak instellen','subtle royalty-template-action');action.type='button';action.onclick=async()=>{document.querySelector('[data-workspace=royalties]').click();await loadRoyalties();$('#royalty-agreement').elements.courseId.value=template.id;$('#royalty-agreement').scrollIntoView({behavior:'smooth',block:'center'});$('#royalty-agreement').elements.recipient.focus();};details.append(action);}
    const scroll=element('div','','table-scroll'),table=element('table',''),head=element('thead',''),heading=element('tr','');
    for(const text of ['Editie','Variant','Type','Locatie','Startdatum','Status','Deelnemers','Bezetting'])heading.append(element('th',text));head.append(heading);table.append(head);
    const body=element('tbody','');
    for(const row of template.editions){const tr=element('tr','');
      const date=row.type==='flexible'?'Flexibele start':row.start?new Date(row.start.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'Geen startdatum';
      for(const text of [`#${row.id}`,row.variant,{fixed:'Vast',flexible:'Flexibel',unknown:'Onbekend'}[row.type],row.type==='flexible'&&row.location==='Onbekend'?'—':row.location,date,labels[row.status]||row.status,row.participants+(row.capacity&&row.type!=='flexible'?' / '+row.capacity:''),row.occupancy==null?'—':row.occupancy+'%'])tr.append(element('td',text));body.append(tr);
    }
    table.append(body);scroll.append(table);details.append(scroll);$('#template-groups').append(details);
  }
  if(!d.templates.length)$('#template-groups').append(element('p',status?.syncedAt?'Geen templates met edities binnen deze selectie.':'Je templates en edities verschijnen na de eerste synchronisatie.'));
  $('#finance').replaceChildren();for(const [currency,totals] of Object.entries(d.totals)){for(const [key,label] of [['invoiced','Gefactureerd'],['open','Openstaand']]){const row=element('div','','finance-row');row.append(element('span',label),element('strong',currency==='ONBEKEND'?totals[key]+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(totals[key])));$('#finance').append(row);}}
  if(!Object.keys(d.totals).length)$('#finance').append(element('p','Nog geen facturen in deze selectie.'));
  $('#chart').replaceChildren();const months=Object.entries(d.months).sort(([a],[b])=>a.localeCompare(b));const max=Math.max(1,...months.map(([,v])=>v));for(const [month,count] of months){const wrap=element('div','','bar-wrap'),bar=element('progress','','bar');bar.max=max;bar.value=count;bar.title=`${month}: ${count} inschrijvingen`;wrap.append(element('span',String(count)),bar,element('span',month));$('#chart').append(wrap);}
  if(!months.length)$('#chart').append(element('p','Nog geen inschrijvingen om te tonen.'));
}
async function refresh(){status=await api('/api/status');$('#login').hidden=true;$('#dashboard').hidden=false;$('#empty').hidden=!!status.syncedAt;$('#sync').disabled=status.syncing||!status.configured;$('#sync').textContent=status.syncing?'Synchroniseren…':'↻ Synchroniseren';$('#source-status').textContent=status.syncing?'Gegevens worden opgehaald…':status.error?'Synchronisatie mislukt':status.configured?'API-key ingesteld':'API-key nog niet ingesteld';$('#source-badge').textContent=status.syncedAt?'Verbonden':status.configured?'Gereed voor import':'Niet gekoppeld';$('#message').textContent=status.error||'';$('#last-sync').textContent=status.syncedAt?'Laatste succesvolle synchronisatie: '+new Date(status.syncedAt).toLocaleString('nl-NL'):'Nog geen synchronisatie uitgevoerd';if(lastSync!==status.syncedAt){lastSync=status.syncedAt;await load();}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/login',{email:$('#email').value,password:$('#password').value});$('#password').value='';$('#login-error').textContent='';await refresh();await load();}catch(err){$('#login-error').textContent=err.message;}finally{b.disabled=false;}});
$('#logout').onclick=async()=>{await api('/api/logout',{});showLogin();};
$('#sync').onclick=async()=>{try{await api('/api/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#filters').onsubmit=async e=>{e.preventDefault();try{await load();$('#message').textContent='';}catch(err){$('#message').textContent=err.message;}};
$('#filters').onreset=()=>setTimeout(()=>load().catch(e=>$('#message').textContent=e.message),0);
$('#export').onclick=()=>{window.location.href='/api/export?'+params();};
function showWorkspace(){
  for(const id of ['overview','courses'])$('#'+id).hidden=workspace==='royalties';
  $('#royalties').hidden=workspace!=='royalties';
  const info={royalties:['Royalties','Afspraken en afrekeningen over ontvangen eLearning-omzet.'],all:['Alle cursussen','Alle categorieën, templates en edities bij elkaar.'],fixed:['Vaste cursussen','Templates en edities met een vaste cursusdatum.'],flexible:['Flexibele cursussen','Templates en edities met een flexibele start, zoals online cursussen.']}[workspace];
  $('#workspace-title').textContent=info[0];$('#workspace-description').textContent=info[1];
  $('#from-label').textContent=workspace==='flexible'?'Geboekt vanaf':'Cursus start vanaf';
  $('#third-label').textContent=workspace==='flexible'?'Unieke deelnemers':'Gemiddelde bezetting';
  $('#third-description').textContent=workspace==='flexible'?'Binnen de gekozen boekingsperiode':'Gewogen naar capaciteit';
  $('#period-note').textContent=workspace==='flexible'?'Periode: boekingsdatum. Templates en edities blijven zichtbaar; aantallen en facturen horen bij orders uit deze boekingsperiode.':'Periode: startdatum van de editie. Bij een datumselectie vallen edities zonder startdatum buiten de selectie.';
  for(const b of document.querySelectorAll('[data-workspace]')){b.classList.toggle('selected',b.dataset.workspace===workspace);b.setAttribute('aria-pressed',String(b.dataset.workspace===workspace));}
}
for(const b of document.querySelectorAll('[data-workspace]'))b.onclick=async()=>{
  workspace=b.dataset.workspace;opened.clear();$('#filters').elements.course.value='';$('#filters').elements.location.value='';showWorkspace();
  const url=new URL(location.href);url.searchParams.set('workspace',workspace);history.pushState({},'',url);
  try{await load();}catch(e){$('#message').textContent=e.message;}
};
window.addEventListener('popstate',()=>{workspace=new URL(location.href).searchParams.get('workspace')||'all';if(!['all','fixed','flexible','royalties'].includes(workspace))workspace='all';showWorkspace();load().catch(e=>$('#message').textContent=e.message);});
$('#filters').elements.category.onchange=()=>{$('#filters').elements.course.value='';};
showWorkspace();refresh().then(load).catch(()=>showLogin());setInterval(()=>{if(!$('#dashboard').hidden)refresh().catch(e=>$('#message').textContent=e.message);},5000);
