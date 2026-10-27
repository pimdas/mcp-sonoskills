const $=s=>document.querySelector(s);
let status, lastSync=null;
const routePaths={all:'/overview',handson:'/handson',elearning:'/online/elearning',ondemand:'/online/on-demand',live:'/online/live',products:'/products',external:'/external',other:'/other',royalties:'/royalties'};
let page='analytics',workspace='all',pendingFilters={};
function readRoute(){
 const url=new URL(location.href);
 if(url.hash==='#connections'){url.pathname='/data-sources';url.hash='';history.replaceState({},'',url);}else if(url.hash==='#courses'){url.pathname=routePaths[normalizeWorkspace(url.searchParams.get('workspace')||'all')];url.hash='';history.replaceState({},'',url);}
 page=url.pathname==='/marketing/nieuwsbrief'?'newsletter':url.pathname==='/marketing/reviews'?'reviews':['/social','/marketing','/marketing/social-media'].includes(url.pathname)?'social':url.pathname==='/data-sources'?'sources':url.pathname==='/royalties'?'royalties':'analytics';
 workspace=normalizeWorkspace(page==='analytics'?(Object.entries(routePaths).find(([,path])=>path===url.pathname)?.[0]||url.searchParams.get('workspace')||'all'):page==='royalties'?'royalties':url.searchParams.get('workspace')||'all');
 pendingFilters=Object.fromEntries(url.searchParams);
}
readRoute();
function normalizeWorkspace(value){const key=({fixed:'handson',flexible:'elearning'})[value]||value;return ['all','handson','elearning','ondemand','live','products','external','royalties','other'].includes(key)?key:'all';}
const onlineWorkspace=()=>['elearning','ondemand','live'].includes(workspace);
const bookingWorkspace=()=>['elearning','ondemand','products'].includes(workspace);
const opened=new Set();
let mappingLoaded=false;
async function api(path,body){const r=await fetch(path,body!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:JSON.stringify(body)}:{});const d=await r.json();if(r.status===401 && path!=='/api/login'){showLogin();throw Error('Log opnieuw in.');}if(!r.ok)throw Error(d.error||'Er ging iets mis.');return d;}
function showLogin(){$('#login').hidden=false;$('#dashboard').hidden=true;}
function element(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function params(){return new URLSearchParams([['workspace',workspace],...[...new FormData($('#filters'))].filter(([,v])=>v)]);}
async function load(){
  if(['social','newsletter','reviews'].includes(page))return loadSocial(page);
  if(page==='sources'){await loadWorkspaceMapping();return loadExact();}
  if(page==='royalties')return loadRoyalties();
  if(workspace==='all')return loadHomeDashboard();
  const d=await api('/api/analytics?'+params());
  $('#external-finance').hidden=workspace!=='external';if(workspace==='external')await renderExternalFinance();
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
  const online=onlineWorkspace();
  $('#editions-label').textContent=online?'Opties':'Cursusedities';
  $('#orders').closest('article').hidden=online;$('#bookedPlaces').closest('article').hidden=online;
  $('#occupancy').closest('article').hidden=online;$('#confirmed-editions-note').hidden=online;
  $('#enrollment-metric').hidden=!online;$('#enrollments').textContent=status?.syncedAt?d.metrics.enrollments.toLocaleString('nl-NL'):'—';
  $('#chart').closest('section').hidden=online;
  $('#course-list-note').textContent=online?'Inschrijvingen worden direct geregistreerd voor de online cursus en opgeteld over alle opties.':'Verkocht: actieve en aangevraagde orders, opgeteld over alle edities van de cursus. Inschrijvingen geven aan dat de editie bevestigd is; ze tellen niet nogmaals als verkoop.';
  const listing=$('#workspace-template-groups');listing.replaceChildren();
  for(const template of d.templates){
    const details=element('details','','template-card');details.open=opened.has(template.id);
    details.addEventListener('toggle',()=>details.open?opened.add(template.id):opened.delete(template.id));
    const summary=element('summary',''),title=element('div','','template-name');title.append(element('strong',template.name),element('small',`${template.category} · Template #${template.id}${template.code?' · '+template.code:''}`));
    const onlineTemplate=['elearning','ondemand','live'].includes(template.workspace);
    summary.append(title,element('span',`${template.editions.length} ${onlineTemplate?(template.editions.length===1?'optie':'opties'):(template.editions.length===1?'editie':'edities')}`,'badge'));
    if(onlineTemplate)summary.append(element('span',`${template.participants} inschrijvingen`,'badge'));
    else summary.append(element('span',`${template.orders} orders`,'badge'),element('span',template.unknownPlaces?'Aantal plaatsen onbekend':`${template.bookedPlaces} plaatsen`,'badge'));details.append(summary);
    if(template.workspace==='elearning'){const action=element('button','Royaltyafspraak instellen','subtle royalty-template-action');action.type='button';action.onclick=async()=>{document.querySelector('[data-workspace=royalties]').click();await loadRoyalties();$('#royalty-agreement').elements.courseId.value=template.id;$('#royalty-agreement').scrollIntoView({behavior:'smooth',block:'center'});$('#royalty-agreement').elements.recipient.focus();};details.append(action);}
    const scroll=element('div','','table-scroll'),table=element('table',''),head=element('thead',''),heading=element('tr','');
    const columns=onlineTemplate?['Optie','Variant','Type','Startdatum','Einddatum','Status','Inschrijvingen']:['Editie','Variant','Type','Locatie','Startdatum','Einddatum','Status','Orders','Geboekte plaatsen','Cursus bevestigd','Inschrijvingen','Bezetting'];
    for(const text of columns)heading.append(element('th',text));head.append(heading);table.append(head);
    const body=element('tbody','');
    for(const row of template.editions){const tr=element('tr','');
      const date=row.type==='flexible'?'Flexibele start':row.start?new Date(row.start.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'Geen startdatum';
      const cells=[`#${row.id}`,row.variant,{fixed:'Vast',flexible:'Flexibel',unknown:'Onbekend'}[row.type],row.type==='flexible'&&row.location==='Onbekend'?'—':row.location,date,row.end?new Date(row.end.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'—',labels[row.status]||row.status,row.orders,row.unknownPlaces?'—':row.bookedPlaces,row.confirmed?'Bevestigd':'Nog niet bevestigd',row.participants+(row.capacity&&row.type!=='flexible'?' / '+row.capacity:''),row.occupancy==null?'—':row.occupancy+'%'];
      for(const text of onlineTemplate?[cells[0],cells[1],cells[2],cells[4],cells[5],cells[6],row.participants]:cells)tr.append(element('td',text));body.append(tr);
    }
    if(!template.editions.length){const tr=element('tr',''),td=element('td',onlineTemplate?'Deze cursus heeft nog geen opties.':'Deze cursus heeft nog geen edities.');td.colSpan=columns.length;tr.append(td);body.append(tr);}
    table.append(body);scroll.append(table);details.append(scroll);listing.append(details);
  }
  if(!d.templates.length)listing.append(element('p',status?.syncedAt?(online?'Geen cursussen met opties binnen deze selectie.':'Geen cursussen met edities binnen deze selectie.'):(online?'Je cursussen en opties verschijnen na de eerste synchronisatie.':'Je cursussen en edities verschijnen na de eerste synchronisatie.')));
  $('#finance').replaceChildren();for(const [currency,totals] of Object.entries(d.totals)){for(const [key,label] of [['orderValue','Orderwaarde'],['invoiced','Gefactureerd'],['open','Openstaand']]){const row=element('div','','finance-row');row.append(element('span',label),element('strong',totals[key]===null?'Nog niet beschikbaar':currency==='ONBEKEND'?totals[key]+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(totals[key])));$('#finance').append(row);}}
  if(!Object.keys(d.totals).length)$('#finance').append(element('p','Geen gekoppelde orders of facturen in deze selectie.'));
  $('#finance-checks').replaceChildren(...d.finance.warnings.map(w=>element('p',w,'royalty-warning')));
  $('#chart').replaceChildren();const months=Object.entries(d.months).sort(([a],[b])=>a.localeCompare(b));const max=Math.max(1,...months.map(([,v])=>v));for(const [month,count] of months){const wrap=element('div','','bar-wrap'),bar=element('progress','','bar');bar.max=max;bar.value=count;bar.title=`${month}: ${count} orders`;wrap.append(element('span',String(count)),bar,element('span',month));$('#chart').append(wrap);}
  if(!months.length)$('#chart').append(element('p','Nog geen orders om te tonen.'));
}
function saveFilterUrl(){if(!['analytics','social','newsletter'].includes(page))return;const url=new URL(location.href);url.search='';for(const [k,v] of params())url.searchParams.set(k,v);url.searchParams.set('period',$('#filters [data-period-preset]').value);history.replaceState({},'',url);}
function updateSyncButton(){if(!status)return;const ns=status.newsletter;$('#sync').disabled=page==='reviews'?false:page==='newsletter'?ns.syncing||!ns.configured:page==='social'?status.social.syncing||!status.social.configured:status.syncing||!status.configured;$('#sync').textContent=page==='reviews'?'↻ Vernieuwen':(page==='newsletter'?ns.syncing:page==='social'?status.social.syncing:status.syncing)?'Synchroniseren…':'↻ Synchroniseren';}
async function refresh(){status=await api('/api/status');$('#exact-status').textContent=status.exactConnected?'Exact is gekoppeld. Beheer klanten en facturen hieronder.':'Voeg EXACT_CLIENT_ID en EXACT_CLIENT_SECRET toe in Railway en koppel Exact.';$('#exact-badge').textContent=status.exactConnected?'Verbonden':'Niet gekoppeld';const ns=status.newsletter;$('#social-source-status').textContent=status.social.error||(status.social.syncing?'Facebook en Instagram worden opgehaald…':status.social.configured?'Token ingesteld. Bekijk Marketing voor de resultaten.':'Voeg de META-variabelen toe in Railway.');$('#social-source-sync').disabled=!status.social.configured||status.social.syncing;$('#newsletter-source-status').textContent=ns.error|| (ns.syncing?(ns.progress?.phase==='groups'?'Groepen ophalen · ':'Aantallen ophalen: ')+(ns.progress?.completed||0)+' van '+(ns.progress?.total||5)+' contactstatussen'+(ns.progress?.phase==='waiting'?' · MailerLite vraagt een wachttijd van '+ns.progress.retrySeconds+' seconden.':'…'):ns.syncedAt?'Laatste synchronisatie: '+new Date(ns.syncedAt).toLocaleString('nl-NL'):ns.configured?'API-token ingesteld; wacht op synchronisatie.':'Voeg MAILERLITE_API_TOKEN toe in Railway.');$('#newsletter-source-badge').textContent=ns.syncing?'Synchroniseren':ns.error?'Mislukt':ns.syncedAt?'Verbonden':ns.configured?'Gereed':'Niet gekoppeld';$('#newsletter-sync').disabled=!ns.configured||ns.syncing;$('#login').hidden=true;$('#dashboard').hidden=false;$('#empty').hidden=!!status.syncedAt;updateSyncButton();$('#source-status').textContent=status.syncing?'Gegevens worden opgehaald…':status.error?'Synchronisatie mislukt':status.configured?'API-key ingesteld':'API-key nog niet ingesteld';$('#source-badge').textContent=status.syncedAt?'Verbonden':status.configured?'Gereed voor import':'Niet gekoppeld';$('#message').textContent=['social','newsletter','reviews'].includes(page)?'':status.error||'';$('#last-sync').hidden=['social','newsletter','reviews'].includes(page);$('#last-sync').textContent=status.syncedAt?'Laatste succesvolle synchronisatie: '+new Date(status.syncedAt).toLocaleString('nl-NL'):'Nog geen synchronisatie uitgevoerd';const key=JSON.stringify(page==='social'?status.social:page==='newsletter'?status.newsletter:page==='reviews'?'reviews':[status.syncedAt,status.payments?.ready,status.payments?.syncedAt,status.syncing]);if(lastSync!==key){lastSync=key;await load();}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/login',{email:$('#email').value,password:$('#password').value});$('#password').value='';$('#login-error').textContent='';await refresh();await load();}catch(err){$('#login-error').textContent=err.message;}finally{b.disabled=false;}});
$('#logout').onclick=async()=>{await api('/api/logout',{});showLogin();};
$('#social-source-sync').onclick=async()=>{try{await api('/api/social/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#newsletter-sync').onclick=async()=>{try{await api('/api/newsletter/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#sync').onclick=async()=>{try{if(page==='reviews'){const button=$('#sync');button.disabled=true;try{await load();}finally{button.disabled=false;}return;}await api(page==='social'?'/api/social/sync':page==='newsletter'?'/api/newsletter/sync':'/api/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#filters').onsubmit=async e=>{e.preventDefault();try{await load();saveFilterUrl();$('#message').textContent='';}catch(err){$('#message').textContent=err.message;}};
$('#filters').onreset=()=>setTimeout(()=>{load().then(saveFilterUrl).catch(e=>$('#message').textContent=e.message);},0);
$('#export').onclick=()=>{if(!$('#filters').reportValidity())return;window.location.href='/api/export?'+params();};
let onlineMenuOpen=false;
try{onlineMenuOpen=localStorage.getItem('sonoskills-online-menu')==='open';}catch{}
function setOnlineMenu(open){
 onlineMenuOpen=open;$('#online-toggle').setAttribute('aria-expanded',String(open));$('#online-links').hidden=!open;
}
$('#online-toggle').onclick=()=>{setOnlineMenu(!onlineMenuOpen);try{localStorage.setItem('sonoskills-online-menu',onlineMenuOpen?'open':'closed');}catch{}};
let marketingMenuOpen=false;
try{marketingMenuOpen=localStorage.getItem('sonoskills-marketing-menu')==='open';}catch{}
function setMarketingMenu(open){marketingMenuOpen=open;$('#marketing-toggle').setAttribute('aria-expanded',String(open));$('#marketing-links').hidden=!open;}
$('#marketing-toggle').onclick=()=>{setMarketingMenu(!marketingMenuOpen);try{localStorage.setItem('sonoskills-marketing-menu',marketingMenuOpen?'open':'closed');}catch{}};
function showWorkspace(){
  const marketing=['social','newsletter','reviews'].includes(page);
  setMarketingMenu(marketing||marketingMenuOpen);$('#marketing-toggle').classList.toggle('active-parent',marketing);
  $('#last-sync').hidden=marketing;updateSyncButton();
  setOnlineMenu((page==='analytics'&&onlineWorkspace())||onlineMenuOpen);
  $('#online-toggle').classList.toggle('active-parent',page==='analytics'&&onlineWorkspace());
  const online=['elearning','ondemand','live'].includes(workspace);
  for(const key of ['category','location']){const select=$('#filters').elements[key];$('#'+key+'-filter').hidden=online||workspace==='all';select.disabled=online||workspace==='all';if(online){select.value='';delete pendingFilters[key];}}

  $('#course-filter-fields').hidden=workspace==='all'||page!=='analytics';
  $('#analysis-filters').hidden=!['analytics','social','newsletter'].includes(page);$('#social-page').hidden=!marketing;
  $('#overview').hidden=page!=='analytics'||workspace==='all';$('#home-dashboard').hidden=page!=='analytics'||workspace!=='all';
  for(const name of ['course','sort'])$('#filters').elements[name].closest('label').hidden=workspace==='all';$('#connections').hidden=page!=='sources';$('#royalties').hidden=page!=='royalties';
  const info={royalties:['Royalties','Afspraken en afrekeningen over ontvangen eLearning-omzet.'],all:['Dashboard','De belangrijkste resultaten en omzetverdeling per werkruimte.'],handson:['Hands-on cursussen','Cursussen en edities uit de categorie Hands-on, met cursusdata en locaties.'],elearning:['Online · eLearning','Alle cursussen en toegangsduurvarianten uit de categorie eLearning.'],ondemand:['Online · On-demand SonoClasses','Flexibele opties uit On-demand en Live SonoClasses.'],live:['Online · Live SonoClasses','Opties met een vaste datum uit Live en On-demand SonoClasses.'],products:['Producten','Alle cursussen uit de categorie Producten.'],external:['Extern','Partnercursussen en externe facturen uit Exact Online.'],other:['Overige cursussen','Cursussen die nog niet aan een werkruimte zijn gekoppeld.']}[workspace];
  $('#workspace-title').textContent=marketing?({social:'Marketing · Social media',newsletter:'Marketing · Nieuwsbrief',reviews:'Marketing · Reviews'})[page]:page==='sources'?'Databronnen':info[0];$('#workspace-description').textContent=marketing?({social:'Volgers, groei, posts en interacties van SonoSkills.',newsletter:'De SonoSkills- en Free Webinar-groepen in MailerLite.',reviews:'Het aantal Google-beoordelingen en de gemiddelde sterrenscore.'})[page]:page==='sources'?'Eduframe-koppeling en categorie-indeling beheren.':info[1];
  $('#from-label').textContent=marketing?'Vanaf':bookingWorkspace()?'Geboekt vanaf':'Cursus start vanaf';
  $('#third-label').textContent=bookingWorkspace()?'Bevestigde edities':'Boekingsbezetting';
  $('#third-description').textContent=bookingWorkspace()?'Met bevestigde inschrijvingen':'Geboekte plaatsen / capaciteit';
  $('#period-note').textContent=online?(bookingWorkspace()?'Periode: boekingsdatum. Cursussen en opties blijven zichtbaar; aantallen en facturen horen bij orders uit deze periode.':'Periode: startdatum van de optie. Bij een datumselectie vallen opties zonder startdatum buiten de selectie.'):workspace==='external'?'Cursusselectie: startdatum van de editie. Externe facturen: factuurdatum.':bookingWorkspace()?'Periode: boekingsdatum. Cursussen en edities blijven zichtbaar; aantallen en facturen horen bij orders uit deze boekingsperiode.':'Periode: startdatum van de editie. Bij een datumselectie vallen edities zonder startdatum buiten de selectie.';
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
for(const a of document.querySelectorAll('[data-page]'))a.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(a.getAttribute('href'));};
window.addEventListener('popstate',()=>{readRoute();restorePeriod();showWorkspace();window.scrollTo(0,0);load().catch(e=>$('#message').textContent=e.message);});
$('#filters').elements.sort.onchange=()=>{if($('#filters').reportValidity())$('#filters').requestSubmit();};
$('#filters').elements.category.onchange=()=>{$('#filters').elements.course.value='';};
restorePeriod();showWorkspace();refresh().catch(()=>showLogin());setInterval(()=>{if(!$('#dashboard').hidden)refresh().catch(e=>$('#message').textContent=e.message);},5000);

async function loadWorkspaceMapping(){
 const d=await api('/api/workspaces');$('#workspace-category-fields').replaceChildren();
 for(const def of d.definitions){const label=element('label',def.name),select=element('select','');select.multiple=true;select.size=5;select.name=def.id;for(const c of d.categories){const o=element('option',c.name);o.value=c.id;o.selected=def.categoryIds.includes(c.id);select.append(o);}label.append(select);$('#workspace-category-fields').append(label);}
 mappingLoaded=true;
}
$('#workspace-mapping').onsubmit=async e=>{e.preventDefault();const mapping={};for(const s of e.target.querySelectorAll('select'))mapping[s.name]=[...s.selectedOptions].map(o=>Number(o.value));try{await api('/api/workspaces',{mapping});$('#workspace-mapping-message').textContent='Indeling opgeslagen. Synchroniseer om ook de betalingsimport aan de eLearning-categorie aan te passen.';for(const key of ['category','course','location'])$('#filters').elements[key].value='';await load();}catch(err){$('#workspace-mapping-message').textContent=err.message;}};
$('#workspace-auto').onclick=async()=>{try{await api('/api/workspaces',{mapping:{}});await loadWorkspaceMapping();await load();$('#workspace-mapping-message').textContent='Automatische categorie-indeling hersteld.';}catch(e){$('#workspace-mapping-message').textContent=e.message;}};

let dashboardMetric='invoiced';
async function loadHomeDashboard(){
 const data=await api('/api/dashboard?'+params()),root=$('#home-dashboard');root.replaceChildren();
 const colors=['#13638b','#e98324','#48b0e4','#082935','#74a6bb','#b8c8d0','#8c77b5'];
 const money=(n,c)=>n===null?'Niet volledig beschikbaar':c==='ONBEKEND'?n.toFixed(2)+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency:c}).format(n);
 root.append(element('p','Periode: cursusstart voor Hands-on en Live; boekingsdatum voor eLearning, On-demand en Producten; factuurdatum voor Extern. Klik op een financieel kengetal om de verdeling per werkruimte te bekijken. Gefactureerd is na creditnota’s. De orderwaarde bevat voor Extern het netto gefactureerde bedrag uit Exact; nog niet gefactureerde opdrachten zijn daarin niet opgenomen.','note'));
 const metricNames={invoiced:'Gefactureerd',open:'Openstaand',orderValue:'Orderwaarde'},metricButtons=[],chartHost=element('div','');
 const metrics=element('div','','metrics');
 for(const [c,t] of Object.entries(data.totals))for(const [key,label] of [['invoiced','Gefactureerd'],['open','Openstaand'],['orderValue','Orderwaarde']]){const card=element('button','','metric-select');card.type='button';card.dataset.metric=key;card.setAttribute('aria-pressed',String(dashboardMetric===key));card.append(element('span',label),element('strong',money(t[key],c)),element('small','Bekijk verdeling →'));card.onclick=()=>{dashboardMetric=key;renderCharts();};metricButtons.push(card);metrics.append(card);}
 const own=data.workspaces.filter(w=>w.id!=='external');
 for(const [label,n] of [['Cursussen',new Set(own.flatMap(w=>w.courseIds)).size],['Hands-on orders',data.workspaces[0].metrics.orders],['Online inschrijvingen',data.workspaces.filter(w=>['elearning','ondemand','live'].includes(w.id)).reduce((s,w)=>s+w.metrics.enrollments,0)]]){const card=element('article','');card.append(element('div',label),element('strong',n.toLocaleString('nl-NL')));metrics.append(card);}root.append(metrics);
 if(!Object.keys(data.totals).length)root.append(element('p','Nog geen financiële gegevens in deze periode.','empty'));
 root.append(chartHost);
 function renderCharts(){chartHost.replaceChildren();for(const button of metricButtons)button.setAttribute('aria-pressed',String(button.dataset.metric===dashboardMetric));
 for(const [currency,total] of Object.entries(data.totals)){
  const panel=element('section','','panel'),layout=element('div','','revenue-layout'),legend=element('div','','revenue-legend');panel.setAttribute('aria-live','polite');panel.append(element('h2',metricNames[dashboardMetric]+' · verdeling · '+currency));
  const values=data.workspaces.map(w=>w.totals[currency]?.[dashboardMetric]??0),sum=values.reduce((s,v)=>s+v,0);let start=0;
  if(total[dashboardMetric]!==null&&sum>0&&values.every(v=>v>=0)){const pie=element('div','','revenue-pie');const stops=values.map((v,i)=>{const end=start+v/sum*100;const stop=colors[i]+' '+start+'% '+end+'%';start=end;return stop;});pie.style.background='conic-gradient('+stops.join(',')+')';pie.setAttribute('role','img');pie.setAttribute('aria-label','Omzetverdeling; bedragen en percentages staan in de legenda.');layout.append(pie);}else layout.append(element('p',total[dashboardMetric]===null?'De verdeling is niet volledig beschikbaar omdat er bedragen ontbreken.':sum===0?'Geen bedragen voor deze selectie.':'Negatieve bedragen: zie de bedragen per werkruimte.'));
  data.workspaces.forEach((w,i)=>{if(w.id==='other'&&!values[i])return;const row=element('a','','revenue-item');const q=params();q.set('workspace',w.id);row.href=routePaths[w.id]+'?'+q;const dot=element('span','','revenue-dot');dot.style.background=colors[i];row.append(dot,element('span',w.name+(w.id==='external'?' · Exact Online':'')),element('strong',money(w.totals[currency]?.[dashboardMetric]===null?null:values[i],currency)),element('small',total[dashboardMetric]!==null&&sum>0&&values.every(v=>v>=0)?(values[i]/sum*100).toLocaleString('nl-NL',{maximumFractionDigits:1})+'%':''));legend.append(row);});layout.append(legend);panel.append(layout);chartHost.append(panel);
 }}renderCharts();

 renderMonthlyRevenue(data,root,colors,money);
 const advance=element('section','','panel');advance.append(element('h2','Vooruitgefactureerd voor 2027'),element('p','Uitgereikte facturen tot en met '+data.advance2027.cutoff+' voor eigen cursusedities die starten in 2027. Inclusief openstaande bedragen en na creditnota’s. Los van de gekozen dashboardperiode.','note'));
 const advanceMetrics=element('div','','metrics');for(const [currency,t] of Object.entries(data.advance2027.totals))for(const [key,label] of [['invoiced','Vooruitgefactureerd'],['open','Waarvan openstaand']]){const card=element('article','');card.append(element('div',label),element('strong',money(t[key],currency)));advanceMetrics.append(card);}advance.append(advanceMetrics);
 if(!Object.keys(data.advance2027.totals).length)advance.append(element('p','Geen gekoppelde vooruitgefactureerde bedragen gevonden.'));
 advance.append(element('p',data.advance2027.invoiceCount+' facturen meegeteld. Online producten zonder startdatum kunnen niet aan 2027 worden toegewezen. Externe omzet gebruikt de factuurdatum uit Exact Online.','note'));
 if(data.advance2027.undated||data.advance2027.unallocated)advance.append(element('p','Niet alle facturen kunnen worden meegerekend: bij '+data.advance2027.undated+' ontbreekt de factuurdatum en '+data.advance2027.unallocated+' hebben geen volledige koppeling binnen 2027.','royalty-warning'));root.append(advance);
 const issues=data.workspaces.reduce((s,w)=>s+w.unallocated,0);if(issues)root.append(element('p','Er zijn facturen die niet volledig aan een werkruimte kunnen worden toegerekend. Deze bedragen ontbreken in de verdeling.','note'));
}

function renderMonthlyRevenue(data,root,colors,money){
 const monthly=data.monthly,panel=element('section','','panel');panel.append(element('h2','Omzet per maand'),element('p','Gefactureerd na creditnota’s. Vaste cursussen: maand van de cursusstart. Flexibele cursussen: boekingsmaand (bij een losse factuur de factuurdatum). Externe omzet gebruikt de factuurdatum uit Exact Online.','note'));root.append(panel);
 if(!Object.keys(monthly.rows).length)panel.append(element('p','Geen gekoppelde omzet binnen deze periode.'));
 const svgEl=(tag,attrs={},text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;};
 for(const [currency,rows] of Object.entries(monthly.rows)){
  panel.append(element('h3',currency));const months=monthly.months,groups=data.workspaces;if(!months.length)continue;
  const positive=months.map(m=>groups.reduce((s,w)=>s+Math.max(0,rows[m]?.[w.id]||0),0)),negative=months.map(m=>groups.reduce((s,w)=>s+Math.min(0,rows[m]?.[w.id]||0),0));const hi=Math.max(1,...positive),lo=Math.min(0,...negative),x=i=>80+(months.length===1?410:i*820/(months.length-1)),y=v=>265-(v-lo)/(hi-lo)*230;
  const svg=svgEl('svg',{viewBox:'0 0 950 320',role:'group','aria-label':'Gestapelde omzet per maand in '+currency}),wrap=element('div','','monthly-chart');wrap.append(svg);panel.append(wrap);
  for(let n=0;n<=4;n++){const value=lo+(hi-lo)*n/4;svg.append(svgEl('line',{x1:80,x2:900,y1:y(value),y2:y(value),stroke:'#cfe4ef'}),svgEl('text',{x:72,y:y(value)+4,'text-anchor':'end',fill:'#466877','font-size':11},new Intl.NumberFormat('nl-NL',{notation:'compact',maximumFractionDigits:1}).format(value)));}
  svg.append(svgEl('line',{x1:80,x2:900,y1:y(0),y2:y(0),stroke:'#466877'}));const pos=months.map(()=>0),neg=months.map(()=>0);
  groups.forEach(w=>{const color=colors[data.workspaces.indexOf(w)];for(const sign of [1,-1]){const base=(sign===1?pos:neg).slice(),top=base.map((v,i)=>v+(sign===1?Math.max(0,rows[months[i]]?.[w.id]||0):Math.min(0,rows[months[i]]?.[w.id]||0)));if(top.every((v,i)=>v===base[i]))continue;const points=top.map((v,i)=>x(i)+','+y(v)).concat(base.map((v,i)=>x(i)+','+y(v)).reverse()).join(' ');svg.append(svgEl('polygon',{points,fill:color,'fill-opacity':0.85}));top.forEach((v,i)=>(sign===1?pos:neg)[i]=v);}
   months.forEach((m,i)=>{const v=rows[m]?.[w.id]||0;if(!v)return;const dot=svgEl('circle',{cx:x(i),cy:y(pos[i]+neg[i]),r:3,fill:color});dot.append(svgEl('title',{},m+' · '+w.name+': '+money(v,currency)));svg.append(dot);});});
  const step=Math.max(1,Math.ceil(months.length/12));months.forEach((m,i)=>{if(i%step===0||i===months.length-1)svg.append(svgEl('text',{x:x(i),y:292,'text-anchor':'middle',fill:'#466877','font-size':11},new Date(m+'-01T12:00:00').toLocaleDateString('nl-NL',{month:'short',year:'2-digit'})));});
  const tooltip=element('div','','revenue-tooltip');tooltip.hidden=true;tooltip.setAttribute('role','tooltip');tooltip.id='revenue-tooltip-'+currency;
  const stage=element('div','','revenue-chart-stage');stage.append(svg,tooltip);wrap.append(stage);
  const guide=svgEl('line',{y1:35,y2:265,stroke:'#082935','stroke-width':1,'stroke-dasharray':'4 4','pointer-events':'none',visibility:'hidden'});svg.append(guide);
  const hide=()=>{tooltip.hidden=true;guide.setAttribute('visibility','hidden');};
  months.forEach((m,i)=>{
   const left=i===0?80:(x(i-1)+x(i))/2,right=i===months.length-1?900:(x(i)+x(i+1))/2;
   const monthLabel=new Date(m+'-01T12:00:00').toLocaleDateString('nl-NL',{month:'long',year:'numeric'}),total=groups.reduce((sum,w)=>sum+(rows[m]?.[w.id]||0),0);
   const target=svgEl('rect',{x:months.length===1?80:left,y:30,width:months.length===1?820:Math.max(1,right-left),height:240,fill:'transparent',tabindex:0,'aria-label':monthLabel+' · Totaal '+money(total,currency),'aria-describedby':tooltip.id});
   const show=()=>{tooltip.replaceChildren(element('strong',monthLabel));for(const w of groups){const row=element('div','','revenue-tooltip-row'),label=element('span',''),dot=element('span','','revenue-dot');dot.style.background=colors[data.workspaces.indexOf(w)];label.append(dot,element('span',w.name));row.append(label,element('span',money(rows[m]?.[w.id]||0,currency)));tooltip.append(row);}const sum=element('div','','revenue-tooltip-row revenue-tooltip-total');sum.append(element('strong','Totaal'),element('strong',money(total,currency)));tooltip.append(sum);tooltip.hidden=false;const width=stage.clientWidth;tooltip.style.left=Math.max(10,Math.min(width-tooltip.offsetWidth-10,x(i)/950*width+12))+'px';guide.setAttribute('x1',x(i));guide.setAttribute('x2',x(i));guide.setAttribute('visibility','visible');};
   target.addEventListener('pointerenter',show);target.addEventListener('pointerleave',hide);target.addEventListener('focus',show);target.addEventListener('blur',hide);target.addEventListener('click',show);target.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});svg.append(target);
  });
  const legend=element('div','','monthly-legend');groups.forEach(w=>{const item=element('span',''),dot=element('span','','revenue-dot');dot.style.background=colors[data.workspaces.indexOf(w)];item.append(dot,element('span',w.name));legend.append(item);});panel.append(legend);
  const details=element('details','');details.append(element('summary','Bedragen per maand'));const table=element('table',''),head=element('tr','');for(const text of ['Maand',...groups.map(w=>w.name),'Totaal'])head.append(element('th',text));table.append(head);for(const m of months){const tr=element('tr','');tr.append(element('td',m));let total=0;for(const w of groups){const v=rows[m]?.[w.id]||0;total+=v;tr.append(element('td',money(v,currency)));}tr.append(element('td',money(total,currency)));table.append(tr);}const scroll=element('div','','table-scroll');scroll.append(table);details.append(scroll);panel.append(details);
 }
 if(monthly.unallocated)panel.append(element('p','Niet alle facturen kunnen aan één maand en werkruimte worden toegewezen. Deze bedragen ontbreken in de grafiek.','note'));
}

function renderNewsletter(n,root){
 const panel=element('section','','panel newsletter-panel');panel.append(element('h2','Nieuwsbrief · MailerLite'));root.append(panel);
 if(!n.syncedAt){panel.append(element('p',n.error||'Nog geen nieuwsbriefgegevens beschikbaar. Synchroniseer MailerLite via Databronnen.','note'));return;}
 if(n.error)panel.append(element('p',n.error,'royalty-warning'));
 if(n.groupsError)panel.append(element('p',n.groupsError,'royalty-warning'));
 const number=v=>v==null?'Nog niet beschikbaar':v.toLocaleString('nl-NL');
 const cards=element('div','','metrics newsletter-key-groups');
 for(const key of n.keyGroups||[]){const card=element('article','');card.append(element('div',key.name),element('strong',number(key.group?.counts.active)),element('small','Actieve abonnees · nu'));card.append(element('p',key.group?'Groei in periode: '+(key.netGrowth>0?'+':'')+number(key.netGrowth):'Groep niet gevonden. Synchroniseer MailerLite.','note'));cards.append(card);}panel.append(cards);
 panel.append(element('p','Bijgewerkt: '+new Date(n.syncedAt).toLocaleString('nl-NL')+'. Groepen kunnen overlappen; aantallen worden niet opgeteld.','note'));
 const details=element('details','','marketing-details');details.append(element('summary','Groei, overige groepen en contactstatussen'));panel.append(details);
 for(const key of n.keyGroups||[]){details.append(element('h3',key.name+' · groei'));if(key.netGrowth===null)details.append(element('p','Groei verschijnt na metingen op twee verschillende dagen. Eerdere groepshistorie is niet beschikbaar.','note'));else details.append(element('p','Netto groei: '+(key.netGrowth>0?'+':'')+number(key.netGrowth)+(key.baseline?' · gemeten vanaf '+key.baseline.day:'')+'.','note'));
 if(key.history.length){const scroll=element('div','','table-scroll'),table=element('table',''),head=element('tr','');for(const title of ['Meetdatum','Actieve abonnees'])head.append(element('th',title));const thead=element('thead','');thead.append(head);table.append(thead);const body=element('tbody','');for(const h of key.history){const row=element('tr','');row.append(element('td',h.day),element('td',number(h.active)));body.append(row);}table.append(body);scroll.append(table);details.append(scroll);}}
 const keyIds=new Set((n.keyGroups||[]).map(k=>k.group?.id).filter(Boolean)),others=(n.groups||[]).filter(g=>!keyIds.has(g.id));
 details.append(element('h3','Overige groepen'));if(!others.length)details.append(element('p',n.groups?'Geen overige groepen.':'Groepen zijn nog niet beschikbaar.','note'));
 for(const g of others)details.append(element('p',g.name+': '+number(g.counts.active)+' actief · '+number(g.total)+' contacten'));
 const all=element('details','');all.append(element('summary','Gehele MailerLite-database'));all.append(element('p','Alle contacten: '+number(n.total)+' · Actieve abonnees: '+number(n.counts.active)));
 for(const [key,label] of [['unsubscribed','Uitgeschreven'],['unconfirmed','Onbevestigd'],['bounced','Gebounced'],['junk','Spam']])all.append(element('p',label+': '+number(n.counts[key])));details.append(all);
}

$('#exact-connect').addEventListener('click',async()=>{try{const result=await api('/api/exact/connect',{});window.location.assign(result.url);}catch(e){$('#exact-status').textContent=e.message;}});

async function loadExact(){
 const root=$('#exact-settings');root.replaceChildren();const d=await api('/api/exact');if(!d.connected)return;
 const section=element('div','','panel');root.append(section);section.append(element('h3','Externe omzet uit Exact Online'));
 const info=element('p',d.error|| (d.syncing?'Facturen ophalen…':d.syncedAt?'Bijgewerkt: '+new Date(d.syncedAt).toLocaleString('nl-NL'):'Haal eerst klanten en facturen op.'),'note');section.append(info);
 const sync=element('button','↻ Klanten en facturen ophalen','subtle');sync.type='button';sync.disabled=d.syncing;sync.onclick=async()=>{try{await api('/api/exact/sync',{});info.textContent='Facturen ophalen…';sync.disabled=true;setTimeout(loadExact,3000);}catch(e){info.textContent=e.message;}};section.append(sync);if(d.syncing){setTimeout(()=>{if(page==='sources')loadExact();},3000);return;}if(!d.syncedAt)return;
 const form=element('form','');section.append(form);form.append(element('p','Selecteer klanten voor externe omzet. Definitieve facturen tellen op factuurdatum, exclusief btw.','note'));
 const customers=element('div','','exact-customer-picker');const heading=element('h4','Klanten selecteren');const searchLabel=element('label','Zoek op naam of klantnummer');const search=element('input','');search.type='search';search.placeholder='Zoek een klant…';search.autocomplete='off';searchLabel.append(search);const results=element('div','','exact-customer-results'),chosen=element('div','','exact-customer-chosen'),count=element('p','','note');results.setAttribute('aria-live','polite');customers.append(heading,searchLabel,results,count,chosen);form.append(customers);
 const sorted=[...d.accounts].sort((a,b)=>(a.name||'').localeCompare(b.name||'')),byId=new Map(sorted.map(a=>[a.id,a])),selectedCustomers=new Set(d.selected);const customerName=a=>a?.name||a?.code||a?.id||'Onbekende klant';
 function renderSelected(){chosen.replaceChildren();count.textContent=selectedCustomers.size?selectedCustomers.size+' geselecteerde klant'+(selectedCustomers.size===1?'':'en'):'Nog geen klanten geselecteerd.';for(const id of selectedCustomers){const name=customerName(byId.get(id))||id,tag=element('span','','exact-customer-tag'),remove=element('button','×');remove.type='button';remove.setAttribute('aria-label',name+' verwijderen');remove.onclick=()=>{selectedCustomers.delete(id);renderSelected();renderResults();};tag.append(document.createTextNode(name),remove);chosen.append(tag);}}
 function renderResults(){results.replaceChildren();const term=search.value.trim().toLocaleLowerCase('nl');if(!term)return;const matches=sorted.filter(a=>!selectedCustomers.has(a.id)&&[a.name,a.code].some(v=>String(v||'').toLocaleLowerCase('nl').includes(term)));if(!matches.length){results.append(element('p','Geen klanten gevonden.','note'));return;}for(const a of matches.slice(0,30)){const button=element('button','','exact-customer-option');button.type='button';button.append(element('span',customerName(a)),element('small',a.code||''));button.onclick=()=>{selectedCustomers.add(a.id);search.value='';renderSelected();renderResults();search.focus();};results.append(button);}if(matches.length>30)results.append(element('p','Meer resultaten: verfijn je zoekopdracht.','note'));}search.addEventListener('input',renderResults);renderSelected();
 const details=element('details','');details.append(element('summary','Facturen bekijken en uitzonderingen instellen'));form.append(details);details.append(element('p','Een vinkje betekent dat de factuur kan meetellen wanneer de klant is geselecteerd. De cursuskoppeling is optioneel.','note'));
 for(const i of [...d.invoices].sort((a,b)=>(b.date||'').localeCompare(a.date||''))){const row=element('div','','connection'),label=element('label',''),check=element('input','');check.type='checkbox';check.name='invoice';check.value=i.id;check.checked=!d.excluded.includes(i.id);label.append(check,document.createTextNode(' '+(i.date||'Geen datum')+' · '+(i.customer||'Onbekende klant')+' · '+(i.number||'')+' · '+String(i.amount??'onbekend')+' '+(i.currency||'')));row.append(label);const select=element('select','');select.dataset.invoice=i.id;const blank=element('option','Geen cursus gekoppeld');blank.value='';select.append(blank);for(const course of d.editions){const o=element('option',course.name);o.value=course.id;o.selected=d.links[i.id]===course.id;select.append(o);}row.append(select);details.append(row);}
 const save=element('button','Selectie opslaan');save.type='submit';form.append(save);const message=element('p','','note');form.append(message);form.onsubmit=async e=>{e.preventDefault();const selected=[...selectedCustomers],excluded=[...form.querySelectorAll('[name=invoice]:not(:checked)')].map(x=>x.value),links=Object.fromEntries([...form.querySelectorAll('select[data-invoice]')].filter(x=>x.value).map(x=>[x.dataset.invoice,x.value]));try{await api('/api/exact/settings',{selected,excluded,links});message.textContent='Selectie opgeslagen.';}catch(err){message.textContent=err.message;}};
}

async function renderExternalFinance(){
 const root=$('#external-finance');root.replaceChildren(element('h2','Externe omzet per klant'));
 const data=await api('/api/exact');if(!data.connected||!data.syncedAt){root.append(element('p','Koppel en synchroniseer Exact via Databronnen.','note'));return;}
 const q=params(),selected=new Set(data.selected),excluded=new Set(data.excluded),seen=new Set();
 const invoices=data.invoices.filter(i=>{if(seen.has(i.id))return false;seen.add(i.id);return selected.has(i.customerId)&&!excluded.has(i.id)&&i.status===50&&/^\d{4}-\d{2}-\d{2}$/.test(i.date||'')&&(!q.get('from')||i.date>=q.get('from'))&&(!q.get('to')||i.date<=q.get('to'));});
 root.append(element('p','Factuurdatum binnen de gekozen periode. Bedragen exclusief btw, na creditfacturen. Cursusfilters gelden niet voor dit overzicht.','note'));
 const names=new Map(data.accounts.map(a=>[a.id,a.name||a.code||'Onbekende klant'])),groups=new Map(),totals={},valid=i=>i.amount!=null&&i.amount!==''&&Number.isFinite(Number(i.amount))&&/^[A-Z]{3}$/.test(i.currency||'');let missing=0;
 for(const i of invoices){const group=groups.get(i.customerId)||{name:names.get(i.customerId)||i.customer||'Onbekende klant',invoices:[],totals:{}};group.invoices.push(i);groups.set(i.customerId,group);if(valid(i)){const cents=Math.round(Number(i.amount)*100);group.totals[i.currency]=(group.totals[i.currency]||0)+cents;totals[i.currency]=(totals[i.currency]||0)+cents;}else missing++;}
 const money=(c,n)=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:c}).format(n/100),amounts=values=>Object.entries(values).sort(([a],[b])=>a.localeCompare(b)).map(([c,n])=>money(c,n)).join(' · ')||'Niet beschikbaar';
 const summary=element('div','','external-summary');summary.append(element('span','Totaal externe omzet'),element('strong',amounts(totals)),element('small',invoices.length+' facturen · '+groups.size+' klanten'));root.append(summary);
 if(missing)root.append(element('p',missing+' factuur/facturen met een ontbrekend of ongeldig bedrag of valuta tellen niet mee in de totalen.','royalty-warning'));
 if(!invoices.length){root.append(element('p','Geen externe facturen in deze periode.','note'));return;}
 const searchLabel=element('label','Zoek een klant'),search=element('input','');search.type='search';search.placeholder='Klantnaam…';searchLabel.append(search);searchLabel.className='external-search';root.append(searchLabel);
 const list=element('div','','external-customers');root.append(list);const currencies=Object.keys(totals);const rows=[...groups.values()].sort((a,b)=>currencies.length===1?((b.totals[currencies[0]]||0)-(a.totals[currencies[0]]||0)||a.name.localeCompare(b.name)):a.name.localeCompare(b.name));
 if(currencies.length>1)root.append(element('p','Verschillende valuta worden apart getoond; klanten zijn alfabetisch gesorteerd.','note'));
 function render(){list.replaceChildren();const term=search.value.trim().toLocaleLowerCase('nl');const matches=rows.filter(r=>r.name.toLocaleLowerCase('nl').includes(term));if(!matches.length){list.append(element('p','Geen klanten gevonden.','note'));return;}for(const g of matches){const details=element('details','','external-customer'),summary=element('summary','');summary.append(element('strong',g.name),element('span',g.invoices.length+' factuur'+(g.invoices.length===1?'':'en')),element('strong',amounts(g.totals)));details.append(summary);const scroll=element('div','','table-scroll'),table=element('table',''),head=element('tr','');for(const label of ['Datum','Factuurnummer','Omschrijving','Cursus','Bedrag'])head.append(element('th',label));const thead=element('thead','');thead.append(head);table.append(thead);const body=element('tbody','');for(const i of [...g.invoices].sort((a,b)=>b.date.localeCompare(a.date))){const row=element('tr',''),course=data.editions.find(e=>e.id===data.links[i.id]);for(const v of [i.date,String(i.number||'—'),i.description||'—',course?.name||'—',valid(i)?money(i.currency,Math.round(Number(i.amount)*100)):'Niet beschikbaar'])row.append(element('td',v));body.append(row);}table.append(body);scroll.append(table);details.append(scroll);list.append(details);}}search.addEventListener('input',render);render();
}
