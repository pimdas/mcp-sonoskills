const $=s=>document.querySelector(s);
let status, lastSync=null;
const routePaths={all:'/overview',handson:'/handson',elearning:'/online/elearning',ondemand:'/online/on-demand',live:'/online/live',products:'/products',external:'/external',other:'/other',royalties:'/royalties'};
let page='analytics',workspace='all',pendingFilters={};
function readRoute(){
 const url=new URL(location.href);
 if(url.hash==='#connections'){url.pathname='/data-sources';url.hash='';history.replaceState({},'',url);}else if(url.hash==='#courses'){url.pathname=routePaths[normalizeWorkspace(url.searchParams.get('workspace')||'all')];url.hash='';history.replaceState({},'',url);}
 page=url.pathname==='/data-sources'?'sources':url.pathname==='/royalties'?'royalties':'analytics';
 workspace=normalizeWorkspace(page==='analytics'?(Object.entries(routePaths).find(([,path])=>path===url.pathname)?.[0]||url.searchParams.get('workspace')||'all'):page==='royalties'?'royalties':url.searchParams.get('workspace')||'all');
 pendingFilters=Object.fromEntries(url.searchParams);
}
readRoute();
function normalizeWorkspace(value){const key=({fixed:'handson',flexible:'elearning'})[value]||value;return ['all','handson','elearning','ondemand','live','products','external','royalties','other'].includes(key)?key:'all';}
const bookingWorkspace=()=>['elearning','ondemand','products'].includes(workspace);
const opened=new Set();
let mappingLoaded=false;
async function api(path,body){const r=await fetch(path,body!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:JSON.stringify(body)}:{});const d=await r.json();if(r.status===401 && path!=='/api/login'){showLogin();throw Error('Log opnieuw in.');}if(!r.ok)throw Error(d.error||'Er ging iets mis.');return d;}
function showLogin(){$('#login').hidden=false;$('#dashboard').hidden=true;}
function element(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function params(){return new URLSearchParams([['workspace',workspace],...[...new FormData($('#filters'))].filter(([,v])=>v)]);}
async function load(){
  if(page==='sources')return loadWorkspaceMapping();
  if(page==='royalties')return loadRoyalties();
  const d=await api('/api/analytics?'+params());
  for(const key of ['templates','editions','orders'])$('#'+key).textContent=status?.syncedAt?d.metrics[key].toLocaleString('nl-NL'):'—';
  $('#bookedPlaces').textContent=status?.syncedAt&&!d.metrics.unknownPlaces?d.metrics.bookedPlaces.toLocaleString('nl-NL'):'—';
  $('#confirmed-editions-note').textContent=`${d.metrics.confirmedEditions} bevestigd · ${d.metrics.editions-d.metrics.confirmedEditions} nog niet bevestigd`;
  $('#order-warnings').replaceChildren(...d.orderWarnings.map(w=>element('p',w,'royalty-warning')));
  $('#occupancy').textContent=bookingWorkspace()?(status?.syncedAt?d.metrics.confirmedEditions.toLocaleString('nl-NL'):'—'):(d.metrics.occupancy==null?'—':d.metrics.occupancy+'%');
  const missing=d.workspaceMapping.filter(w=>!w.categoryIds.length).map(w=>w.name);$('#migration-note').hidden=!missing.length;$('#migration-note').textContent=missing.length?'Nog geen categorie gekoppeld voor: '+missing.join(', ')+'. Controleer de indeling onder Databronnen.':'';$('#other-workspace').hidden=!d.unassigned;$('#finance-panel').hidden=!d.financeEnabled;
  for(const key of ['category','course','location']){
    const select=$(`[name=${key}]`),selected=pendingFilters[key]??select.value;
    select.replaceChildren(element('option',{category:'Alle categorieën',course:'Alle cursussen',location:'Alle locaties'}[key]));select.firstChild.value='';
    if(key==='category'){const option=element('option','Zonder categorie');option.value='none';select.append(option);}
    for(const item of d.options[{category:'categories',course:'courses',location:'locations'}[key]]){const option=element('option',item.name);option.value=item.id;select.append(option);}select.value=selected;
  }
  pendingFilters={};
  const labels={active:'Actief',completed:'Afgerond',planned:'Gepland',canceled:'Geannuleerd'};
  const listing=$('#workspace-template-groups');listing.replaceChildren();
  for(const template of d.templates){
    const details=element('details','','template-card');details.open=opened.has(template.id);
    details.addEventListener('toggle',()=>details.open?opened.add(template.id):opened.delete(template.id));
    const summary=element('summary',''),title=element('div','','template-name');title.append(element('strong',template.name),element('small',`${template.category} · Template #${template.id}${template.code?' · '+template.code:''}`));
    summary.append(title,element('span',`${template.editions.length} edities`,'badge'),element('span',`${template.orders} orders`,'badge'));summary.append(element('span',template.unknownPlaces?'Aantal plaatsen onbekend':`${template.bookedPlaces} plaatsen`,'badge'));details.append(summary);
    if(template.workspace==='elearning'){const action=element('button','Royaltyafspraak instellen','subtle royalty-template-action');action.type='button';action.onclick=async()=>{document.querySelector('[data-workspace=royalties]').click();await loadRoyalties();$('#royalty-agreement').elements.courseId.value=template.id;$('#royalty-agreement').scrollIntoView({behavior:'smooth',block:'center'});$('#royalty-agreement').elements.recipient.focus();};details.append(action);}
    const scroll=element('div','','table-scroll'),table=element('table',''),head=element('thead',''),heading=element('tr','');
    for(const text of ['Editie','Variant','Type','Locatie','Startdatum','Einddatum','Status','Orders','Geboekte plaatsen','Cursus bevestigd','Inschrijvingen','Bezetting'])heading.append(element('th',text));head.append(heading);table.append(head);
    const body=element('tbody','');
    for(const row of template.editions){const tr=element('tr','');
      const date=row.type==='flexible'?'Flexibele start':row.start?new Date(row.start.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'Geen startdatum';
      for(const text of [`#${row.id}`,row.variant,{fixed:'Vast',flexible:'Flexibel',unknown:'Onbekend'}[row.type],row.type==='flexible'&&row.location==='Onbekend'?'—':row.location,date,row.end?new Date(row.end.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'—',labels[row.status]||row.status,row.orders,row.unknownPlaces?'—':row.bookedPlaces,row.confirmed?'Bevestigd':'Nog niet bevestigd',row.participants+(row.capacity&&row.type!=='flexible'?' / '+row.capacity:''),row.occupancy==null?'—':row.occupancy+'%'])tr.append(element('td',text));body.append(tr);
    }
    if(!template.editions.length){const tr=element('tr',''),td=element('td','Dit template heeft nog geen edities.');td.colSpan=12;tr.append(td);body.append(tr);}
    table.append(body);scroll.append(table);details.append(scroll);listing.append(details);
  }
  if(!d.templates.length)listing.append(element('p',status?.syncedAt?'Geen templates met edities binnen deze selectie.':'Je templates en edities verschijnen na de eerste synchronisatie.'));
  $('#finance').replaceChildren();for(const [currency,totals] of Object.entries(d.totals)){for(const [key,label] of [['orderValue','Orderwaarde'],['invoiced','Gefactureerd'],['open','Openstaand']]){const row=element('div','','finance-row');row.append(element('span',label),element('strong',currency==='ONBEKEND'?totals[key]+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(totals[key])));$('#finance').append(row);}}
  if(!Object.keys(d.totals).length)$('#finance').append(element('p','Nog geen facturen in deze selectie.'));
  $('#chart').replaceChildren();const months=Object.entries(d.months).sort(([a],[b])=>a.localeCompare(b));const max=Math.max(1,...months.map(([,v])=>v));for(const [month,count] of months){const wrap=element('div','','bar-wrap'),bar=element('progress','','bar');bar.max=max;bar.value=count;bar.title=`${month}: ${count} orders`;wrap.append(element('span',String(count)),bar,element('span',month));$('#chart').append(wrap);}
  if(!months.length)$('#chart').append(element('p','Nog geen orders om te tonen.'));
}
function saveFilterUrl(){if(page!=='analytics')return;const url=new URL(location.href);url.search='';for(const [k,v] of params())url.searchParams.set(k,v);url.searchParams.set('period',$('#filters [data-period-preset]').value);history.replaceState({},'',url);}
async function refresh(){status=await api('/api/status');$('#login').hidden=true;$('#dashboard').hidden=false;$('#empty').hidden=!!status.syncedAt;$('#sync').disabled=status.syncing||!status.configured;$('#sync').textContent=status.syncing?'Synchroniseren…':'↻ Synchroniseren';$('#source-status').textContent=status.syncing?'Gegevens worden opgehaald…':status.error?'Synchronisatie mislukt':status.configured?'API-key ingesteld':'API-key nog niet ingesteld';$('#source-badge').textContent=status.syncedAt?'Verbonden':status.configured?'Gereed voor import':'Niet gekoppeld';$('#message').textContent=status.error||'';$('#last-sync').textContent=status.syncedAt?'Laatste succesvolle synchronisatie: '+new Date(status.syncedAt).toLocaleString('nl-NL'):'Nog geen synchronisatie uitgevoerd';if(lastSync!==status.syncedAt){lastSync=status.syncedAt;await load();}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/login',{email:$('#email').value,password:$('#password').value});$('#password').value='';$('#login-error').textContent='';await refresh();await load();}catch(err){$('#login-error').textContent=err.message;}finally{b.disabled=false;}});
$('#logout').onclick=async()=>{await api('/api/logout',{});showLogin();};
$('#sync').onclick=async()=>{try{await api('/api/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#filters').onsubmit=async e=>{e.preventDefault();try{await load();saveFilterUrl();$('#message').textContent='';}catch(err){$('#message').textContent=err.message;}};
$('#filters').onreset=()=>setTimeout(()=>{load().then(saveFilterUrl).catch(e=>$('#message').textContent=e.message);},0);
$('#export').onclick=()=>{if(!$('#filters').reportValidity())return;window.location.href='/api/export?'+params();};
function showWorkspace(){
  const online=['elearning','ondemand','live'].includes(workspace);
  for(const key of ['category','location']){const select=$('#filters').elements[key];$('#'+key+'-filter').hidden=online;select.disabled=online;if(online){select.value='';delete pendingFilters[key];}}

  $('#analysis-filters').hidden=page!=='analytics';
  $('#overview').hidden=page!=='analytics';$('#connections').hidden=page!=='sources';$('#royalties').hidden=page!=='royalties';
  const info={royalties:['Royalties','Afspraken en afrekeningen over ontvangen eLearning-omzet.'],all:['Overzicht','Eigen templates en edities; externe cursussen staan apart.'],handson:['Hands-on cursussen','Templates en edities uit de categorie Hands-on, met cursusdata en locaties.'],elearning:['Online · eLearning','Alle templates en toegangsduurvarianten uit de categorie eLearning.'],ondemand:['Online · On-demand SonoClasses','Templates en edities uit de categorie On-demand SonoClasses.'],live:['Online · Live SonoClasses','Live online cursussen en hun geplande edities.'],products:['Producten','Alle templates uit de categorie Producten.'],external:['Extern','Partnercursussen voor planning, cursusedata en locaties; zonder omzetoverzicht.'],other:['Overige templates','Templates die nog niet aan een werkruimte zijn gekoppeld.']}[workspace];
  $('#workspace-title').textContent=page==='sources'?'Databronnen':info[0];$('#workspace-description').textContent=page==='sources'?'Eduframe-koppeling en categorie-indeling beheren.':info[1];
  $('#from-label').textContent=bookingWorkspace()?'Geboekt vanaf':'Cursus start vanaf';
  $('#third-label').textContent=bookingWorkspace()?'Bevestigde edities':'Boekingsbezetting';
  $('#third-description').textContent=bookingWorkspace()?'Met bevestigde inschrijvingen':'Geboekte plaatsen / capaciteit';
  $('#period-note').textContent=workspace==='external'?'Externe cursussen worden apart getoond en tellen niet mee in het eigen omzetoverzicht. Periode: startdatum van de editie.':bookingWorkspace()?'Periode: boekingsdatum. Templates en edities blijven zichtbaar; aantallen en facturen horen bij orders uit deze boekingsperiode.':'Periode: startdatum van de editie. Bij een datumselectie vallen edities zonder startdatum buiten de selectie.';
  for(const a of document.querySelectorAll('[data-page]')){a.classList.toggle('selected',a.dataset.page===page);if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  for(const b of document.querySelectorAll('[data-workspace]')){b.classList.toggle('selected',(page==='analytics'||page==='royalties')&&b.dataset.workspace===workspace);b.setAttribute('aria-pressed',String((page==='analytics'||page==='royalties')&&b.dataset.workspace===workspace));}
}
async function navigate(path){
 history.pushState({},'',path);readRoute();opened.clear();
 for(const key of ['category','course','location'])$('#filters').elements[key].value='';
 restorePeriod();showWorkspace();window.scrollTo(0,0);
 try{await load();}catch(e){$('#message').textContent=e.message;}
}
function restorePeriod(){
 $('#filters').elements.sort.value=['name','sales_desc','sales_asc','upcoming'].includes(pendingFilters.sort)?pendingFilters.sort:'name';
 const select=$('#filters [data-period-preset]');select.value=['month','quarter','year','custom'].includes(pendingFilters.period)?pendingFilters.period:(pendingFilters.from||pendingFilters.to?'custom':'year');
 if(select.value==='custom'){for(const key of ['from','to'])$('#filters').elements[key].value=pendingFilters[key]||'';}
 $('#filters').updatePeriod();
}
for(const b of document.querySelectorAll('[data-workspace]')){b.href=routePaths[b.dataset.workspace];b.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(routePaths[b.dataset.workspace]);};}
for(const a of document.querySelectorAll('[data-page]'))a.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate('/data-sources');};
window.addEventListener('popstate',()=>{readRoute();restorePeriod();showWorkspace();window.scrollTo(0,0);load().catch(e=>$('#message').textContent=e.message);});
$('#filters').elements.sort.onchange=()=>{if($('#filters').reportValidity())$('#filters').requestSubmit();};
$('#filters').elements.category.onchange=()=>{$('#filters').elements.course.value='';};
restorePeriod();showWorkspace();refresh().then(async()=>{await load();}).catch(()=>showLogin());setInterval(()=>{if(!$('#dashboard').hidden)refresh().catch(e=>$('#message').textContent=e.message);},5000);

async function loadWorkspaceMapping(){
 const d=await api('/api/workspaces');$('#workspace-category-fields').replaceChildren();
 for(const def of d.definitions){const label=element('label',def.name),select=element('select','');select.multiple=true;select.size=5;select.name=def.id;for(const c of d.categories){const o=element('option',c.name);o.value=c.id;o.selected=def.categoryIds.includes(c.id);select.append(o);}label.append(select);$('#workspace-category-fields').append(label);}
 mappingLoaded=true;
}
$('#workspace-mapping').onsubmit=async e=>{e.preventDefault();const mapping={};for(const s of e.target.querySelectorAll('select'))mapping[s.name]=[...s.selectedOptions].map(o=>Number(o.value));try{await api('/api/workspaces',{mapping});$('#workspace-mapping-message').textContent='Indeling opgeslagen. Synchroniseer om ook de betalingsimport aan de eLearning-categorie aan te passen.';for(const key of ['category','course','location'])$('#filters').elements[key].value='';await load();}catch(err){$('#workspace-mapping-message').textContent=err.message;}};
$('#workspace-auto').onclick=async()=>{try{await api('/api/workspaces',{mapping:{}});await loadWorkspaceMapping();await load();$('#workspace-mapping-message').textContent='Automatische categorie-indeling hersteld.';}catch(e){$('#workspace-mapping-message').textContent=e.message;}};
