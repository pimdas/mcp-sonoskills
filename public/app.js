const $=s=>document.querySelector(s);
let status, lastSync=null;
const routePaths={all:'/overview',handson:'/handson',elearning:'/online/elearning',ondemand:'/online/on-demand',live:'/online/live',products:'/products',external:'/external',other:'/other',royalties:'/royalties'};
let page='analytics',workspace='all',pendingFilters={};
function readRoute(){
 const url=new URL(location.href);
 if(url.hash==='#connections'){url.pathname='/data-sources';url.hash='';history.replaceState({},'',url);}else if(url.hash==='#courses'){url.pathname=routePaths[normalizeWorkspace(url.searchParams.get('workspace')||'all')];url.hash='';history.replaceState({},'',url);}
 page=url.pathname==='/social'?'social':url.pathname==='/data-sources'?'sources':url.pathname==='/royalties'?'royalties':'analytics';
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
  if(page==='social')return loadSocial();
  if(page==='sources')return loadWorkspaceMapping();
  if(page==='royalties')return loadRoyalties();
  if(workspace==='all')return loadHomeDashboard();
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
  const online=onlineWorkspace();
  $('#orders').closest('article').hidden=online;$('#bookedPlaces').closest('article').hidden=online;
  $('#occupancy').closest('article').hidden=online;$('#confirmed-editions-note').hidden=online;
  $('#enrollment-metric').hidden=!online;$('#enrollments').textContent=status?.syncedAt?d.metrics.enrollments.toLocaleString('nl-NL'):'—';
  $('#chart').closest('section').hidden=online;
  $('#course-list-note').textContent=online?'Inschrijvingen worden direct geregistreerd voor de online cursus en opgeteld over alle edities.':'Verkocht: actieve en aangevraagde orders, opgeteld over alle edities van de cursus. Inschrijvingen geven aan dat de editie bevestigd is; ze tellen niet nogmaals als verkoop.';
  const listing=$('#workspace-template-groups');listing.replaceChildren();
  for(const template of d.templates){
    const details=element('details','','template-card');details.open=opened.has(template.id);
    details.addEventListener('toggle',()=>details.open?opened.add(template.id):opened.delete(template.id));
    const summary=element('summary',''),title=element('div','','template-name');title.append(element('strong',template.name),element('small',`${template.category} · Template #${template.id}${template.code?' · '+template.code:''}`));
    const onlineTemplate=['elearning','ondemand','live'].includes(template.workspace);
    summary.append(title,element('span',`${template.editions.length} edities`,'badge'));
    if(onlineTemplate)summary.append(element('span',`${template.participants} inschrijvingen`,'badge'));
    else summary.append(element('span',`${template.orders} orders`,'badge'),element('span',template.unknownPlaces?'Aantal plaatsen onbekend':`${template.bookedPlaces} plaatsen`,'badge'));details.append(summary);
    if(template.workspace==='elearning'){const action=element('button','Royaltyafspraak instellen','subtle royalty-template-action');action.type='button';action.onclick=async()=>{document.querySelector('[data-workspace=royalties]').click();await loadRoyalties();$('#royalty-agreement').elements.courseId.value=template.id;$('#royalty-agreement').scrollIntoView({behavior:'smooth',block:'center'});$('#royalty-agreement').elements.recipient.focus();};details.append(action);}
    const scroll=element('div','','table-scroll'),table=element('table',''),head=element('thead',''),heading=element('tr','');
    const columns=onlineTemplate?['Editie','Variant','Type','Startdatum','Einddatum','Status','Inschrijvingen']:['Editie','Variant','Type','Locatie','Startdatum','Einddatum','Status','Orders','Geboekte plaatsen','Cursus bevestigd','Inschrijvingen','Bezetting'];
    for(const text of columns)heading.append(element('th',text));head.append(heading);table.append(head);
    const body=element('tbody','');
    for(const row of template.editions){const tr=element('tr','');
      const date=row.type==='flexible'?'Flexibele start':row.start?new Date(row.start.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'Geen startdatum';
      const cells=[`#${row.id}`,row.variant,{fixed:'Vast',flexible:'Flexibel',unknown:'Onbekend'}[row.type],row.type==='flexible'&&row.location==='Onbekend'?'—':row.location,date,row.end?new Date(row.end.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'—',labels[row.status]||row.status,row.orders,row.unknownPlaces?'—':row.bookedPlaces,row.confirmed?'Bevestigd':'Nog niet bevestigd',row.participants+(row.capacity&&row.type!=='flexible'?' / '+row.capacity:''),row.occupancy==null?'—':row.occupancy+'%'];
      for(const text of onlineTemplate?[cells[0],cells[1],cells[2],cells[4],cells[5],cells[6],row.participants]:cells)tr.append(element('td',text));body.append(tr);
    }
    if(!template.editions.length){const tr=element('tr',''),td=element('td','Dit template heeft nog geen edities.');td.colSpan=columns.length;tr.append(td);body.append(tr);}
    table.append(body);scroll.append(table);details.append(scroll);listing.append(details);
  }
  if(!d.templates.length)listing.append(element('p',status?.syncedAt?'Geen templates met edities binnen deze selectie.':'Je templates en edities verschijnen na de eerste synchronisatie.'));
  $('#finance').replaceChildren();for(const [currency,totals] of Object.entries(d.totals)){for(const [key,label] of [['orderValue','Orderwaarde'],['invoiced','Gefactureerd'],['open','Openstaand']]){const row=element('div','','finance-row');row.append(element('span',label),element('strong',totals[key]===null?'Nog niet beschikbaar':currency==='ONBEKEND'?totals[key]+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(totals[key])));$('#finance').append(row);}}
  if(!Object.keys(d.totals).length)$('#finance').append(element('p','Geen gekoppelde orders of facturen in deze selectie.'));
  $('#finance-checks').replaceChildren(...d.finance.warnings.map(w=>element('p',w,'royalty-warning')));
  $('#chart').replaceChildren();const months=Object.entries(d.months).sort(([a],[b])=>a.localeCompare(b));const max=Math.max(1,...months.map(([,v])=>v));for(const [month,count] of months){const wrap=element('div','','bar-wrap'),bar=element('progress','','bar');bar.max=max;bar.value=count;bar.title=`${month}: ${count} orders`;wrap.append(element('span',String(count)),bar,element('span',month));$('#chart').append(wrap);}
  if(!months.length)$('#chart').append(element('p','Nog geen orders om te tonen.'));
}
function saveFilterUrl(){if(!['analytics','social'].includes(page))return;const url=new URL(location.href);url.search='';for(const [k,v] of params())url.searchParams.set(k,v);url.searchParams.set('period',$('#filters [data-period-preset]').value);history.replaceState({},'',url);}
async function refresh(){status=await api('/api/status');const ns=status.newsletter;$('#social-source-status').textContent=status.social.error||(status.social.syncing?'Facebook en Instagram worden opgehaald…':status.social.configured?'Token ingesteld. Bekijk Social media voor de resultaten.':'Voeg de META-variabelen toe in Railway.');$('#social-source-sync').disabled=!status.social.configured||status.social.syncing;$('#newsletter-source-status').textContent=ns.error|| (ns.syncing?(ns.progress?.phase==='groups'?'Groepen ophalen · ':'Aantallen ophalen: ')+(ns.progress?.completed||0)+' van '+(ns.progress?.total||5)+' contactstatussen'+(ns.progress?.phase==='waiting'?' · MailerLite vraagt een wachttijd van '+ns.progress.retrySeconds+' seconden.':'…'):ns.syncedAt?'Laatste synchronisatie: '+new Date(ns.syncedAt).toLocaleString('nl-NL'):ns.configured?'API-token ingesteld; wacht op synchronisatie.':'Voeg MAILERLITE_API_TOKEN toe in Railway.');$('#newsletter-source-badge').textContent=ns.syncing?'Synchroniseren':ns.error?'Mislukt':ns.syncedAt?'Verbonden':ns.configured?'Gereed':'Niet gekoppeld';$('#newsletter-sync').disabled=!ns.configured||ns.syncing;$('#login').hidden=true;$('#dashboard').hidden=false;$('#empty').hidden=!!status.syncedAt;$('#sync').disabled=page==='social'?status.social.syncing||!status.social.configured:status.syncing||!status.configured;$('#sync').textContent=(page==='social'?status.social.syncing:status.syncing)?'Synchroniseren…':'↻ Synchroniseren';$('#source-status').textContent=status.syncing?'Gegevens worden opgehaald…':status.error?'Synchronisatie mislukt':status.configured?'API-key ingesteld':'API-key nog niet ingesteld';$('#source-badge').textContent=status.syncedAt?'Verbonden':status.configured?'Gereed voor import':'Niet gekoppeld';$('#message').textContent=status.error||'';$('#last-sync').textContent=status.syncedAt?'Laatste succesvolle synchronisatie: '+new Date(status.syncedAt).toLocaleString('nl-NL'):'Nog geen synchronisatie uitgevoerd';const key=JSON.stringify([status.syncedAt,status.payments?.ready,status.payments?.syncedAt,status.syncing,status.newsletter,status.social]);if(lastSync!==key){lastSync=key;await load();}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/login',{email:$('#email').value,password:$('#password').value});$('#password').value='';$('#login-error').textContent='';await refresh();await load();}catch(err){$('#login-error').textContent=err.message;}finally{b.disabled=false;}});
$('#logout').onclick=async()=>{await api('/api/logout',{});showLogin();};
$('#social-source-sync').onclick=async()=>{try{await api('/api/social/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#newsletter-sync').onclick=async()=>{try{await api('/api/newsletter/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#sync').onclick=async()=>{try{await api(page==='social'?'/api/social/sync':'/api/sync',{});await refresh();}catch(e){$('#message').textContent=e.message;}};
$('#filters').onsubmit=async e=>{e.preventDefault();try{await load();saveFilterUrl();$('#message').textContent='';}catch(err){$('#message').textContent=err.message;}};
$('#filters').onreset=()=>setTimeout(()=>{load().then(saveFilterUrl).catch(e=>$('#message').textContent=e.message);},0);
$('#export').onclick=()=>{if(!$('#filters').reportValidity())return;window.location.href='/api/export?'+params();};
function showWorkspace(){
  const online=['elearning','ondemand','live'].includes(workspace);
  for(const key of ['category','location']){const select=$('#filters').elements[key];$('#'+key+'-filter').hidden=online||workspace==='all';select.disabled=online||workspace==='all';if(online){select.value='';delete pendingFilters[key];}}

  $('#analysis-filters').hidden=!['analytics','social'].includes(page);$('#social-page').hidden=page!=='social';
  $('#overview').hidden=page!=='analytics'||workspace==='all';$('#home-dashboard').hidden=page!=='analytics'||workspace!=='all';
  for(const name of ['course','sort'])$('#filters').elements[name].closest('label').hidden=workspace==='all';$('#connections').hidden=page!=='sources';$('#royalties').hidden=page!=='royalties';
  const info={royalties:['Royalties','Afspraken en afrekeningen over ontvangen eLearning-omzet.'],all:['Dashboard','De belangrijkste resultaten en omzetverdeling per werkruimte.'],handson:['Hands-on cursussen','Templates en edities uit de categorie Hands-on, met cursusdata en locaties.'],elearning:['Online · eLearning','Alle templates en toegangsduurvarianten uit de categorie eLearning.'],ondemand:['Online · On-demand SonoClasses','Flexibele edities uit On-demand en Live SonoClasses.'],live:['Online · Live SonoClasses','Vaste edities uit Live en On-demand SonoClasses.'],products:['Producten','Alle templates uit de categorie Producten.'],external:['Extern','Partnercursussen voor planning, cursusedata en locaties; zonder omzetoverzicht.'],other:['Overige templates','Templates die nog niet aan een werkruimte zijn gekoppeld.']}[workspace];
  $('#workspace-title').textContent=page==='social'?'Social media':page==='sources'?'Databronnen':info[0];$('#workspace-description').textContent=page==='social'?'Volgers, groei, posts en interacties van SonoSkills.':page==='sources'?'Eduframe-koppeling en categorie-indeling beheren.':info[1];
  $('#from-label').textContent=page==='social'?'Vanaf':bookingWorkspace()?'Geboekt vanaf':'Cursus start vanaf';
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
for(const a of document.querySelectorAll('[data-page]'))a.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(a.getAttribute('href'));};
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

let dashboardMetric='invoiced';
async function loadHomeDashboard(){
 const data=await api('/api/dashboard?'+params()),root=$('#home-dashboard');root.replaceChildren();
 const colors=['#13638b','#e98324','#48b0e4','#082935','#74a6bb','#b8c8d0','#8c77b5'];
 const money=(n,c)=>n===null?'Niet volledig beschikbaar':c==='ONBEKEND'?n.toFixed(2)+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency:c}).format(n);
 root.append(element('p','Periode: cursusstart voor Hands-on, Live en Extern; boekingsdatum voor eLearning, On-demand en Producten. Klik op een financieel kengetal om de verdeling per werkruimte te bekijken. Gefactureerd is na creditnota’s.','note'));
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
  data.workspaces.forEach((w,i)=>{if(w.id==='other'&&!values[i])return;const row=element('a','','revenue-item');const q=params();q.set('workspace',w.id);row.href=routePaths[w.id]+'?'+q;const dot=element('span','','revenue-dot');dot.style.background=colors[i];row.append(dot,element('span',w.name+(w.id==='external'?' · Exact Online, nog niet gekoppeld':'')),element('strong',w.id==='external'?'Nog niet beschikbaar':money(w.totals[currency]?.[dashboardMetric]===null?null:values[i],currency)),element('small',total[dashboardMetric]!==null&&w.id!=='external'&&sum>0&&values.every(v=>v>=0)?(values[i]/sum*100).toLocaleString('nl-NL',{maximumFractionDigits:1})+'%':''));legend.append(row);});layout.append(legend);panel.append(layout);chartHost.append(panel);
 }}renderCharts();
 renderNewsletter(data.newsletter,root);
 renderMonthlyRevenue(data,root,colors,money);
 const advance=element('section','','panel');advance.append(element('h2','Vooruitgefactureerd voor 2027'),element('p','Uitgereikte facturen tot en met '+data.advance2027.cutoff+' voor eigen cursusedities die starten in 2027. Inclusief openstaande bedragen en na creditnota’s. Los van de gekozen dashboardperiode.','note'));
 const advanceMetrics=element('div','','metrics');for(const [currency,t] of Object.entries(data.advance2027.totals))for(const [key,label] of [['invoiced','Vooruitgefactureerd'],['open','Waarvan openstaand']]){const card=element('article','');card.append(element('div',label),element('strong',money(t[key],currency)));advanceMetrics.append(card);}advance.append(advanceMetrics);
 if(!Object.keys(data.advance2027.totals).length)advance.append(element('p','Geen gekoppelde vooruitgefactureerde bedragen gevonden.'));
 advance.append(element('p',data.advance2027.invoiceCount+' facturen meegeteld. Online producten zonder startdatum kunnen niet aan 2027 worden toegewezen. Externe omzet volgt later via Exact Online.','note'));
 if(data.advance2027.undated||data.advance2027.unallocated)advance.append(element('p','Niet alle facturen kunnen worden meegerekend: bij '+data.advance2027.undated+' ontbreekt de factuurdatum en '+data.advance2027.unallocated+' hebben geen volledige koppeling binnen 2027.','royalty-warning'));root.append(advance);
 const issues=data.workspaces.reduce((s,w)=>s+w.unallocated,0);if(issues)root.append(element('p','Er zijn facturen die niet volledig aan een werkruimte kunnen worden toegerekend. Deze bedragen ontbreken in de verdeling.','note'));
}

function renderMonthlyRevenue(data,root,colors,money){
 const monthly=data.monthly,panel=element('section','','panel');panel.append(element('h2','Omzet per maand'),element('p','Gefactureerd na creditnota’s. Vaste cursussen: maand van de cursusstart. Flexibele cursussen: boekingsmaand (bij een losse factuur de factuurdatum). Externe omzet volgt later via Exact Online.','note'));root.append(panel);
 if(!Object.keys(monthly.rows).length)panel.append(element('p','Geen gekoppelde omzet binnen deze periode.'));
 const svgEl=(tag,attrs={},text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;};
 for(const [currency,rows] of Object.entries(monthly.rows)){
  panel.append(element('h3',currency));const months=monthly.months,groups=data.workspaces.filter(w=>w.id!=='external');if(!months.length)continue;
  const positive=months.map(m=>groups.reduce((s,w)=>s+Math.max(0,rows[m]?.[w.id]||0),0)),negative=months.map(m=>groups.reduce((s,w)=>s+Math.min(0,rows[m]?.[w.id]||0),0));const hi=Math.max(1,...positive),lo=Math.min(0,...negative),x=i=>80+(months.length===1?410:i*820/(months.length-1)),y=v=>265-(v-lo)/(hi-lo)*230;
  const svg=svgEl('svg',{viewBox:'0 0 950 320',role:'img','aria-label':'Gestapelde omzet per maand in '+currency}),wrap=element('div','','monthly-chart');wrap.append(svg);panel.append(wrap);
  for(let n=0;n<=4;n++){const value=lo+(hi-lo)*n/4;svg.append(svgEl('line',{x1:80,x2:900,y1:y(value),y2:y(value),stroke:'#cfe4ef'}),svgEl('text',{x:72,y:y(value)+4,'text-anchor':'end',fill:'#466877','font-size':11},new Intl.NumberFormat('nl-NL',{notation:'compact',maximumFractionDigits:1}).format(value)));}
  svg.append(svgEl('line',{x1:80,x2:900,y1:y(0),y2:y(0),stroke:'#466877'}));const pos=months.map(()=>0),neg=months.map(()=>0);
  groups.forEach(w=>{const color=colors[data.workspaces.indexOf(w)];for(const sign of [1,-1]){const base=(sign===1?pos:neg).slice(),top=base.map((v,i)=>v+(sign===1?Math.max(0,rows[months[i]]?.[w.id]||0):Math.min(0,rows[months[i]]?.[w.id]||0)));if(top.every((v,i)=>v===base[i]))continue;const points=top.map((v,i)=>x(i)+','+y(v)).concat(base.map((v,i)=>x(i)+','+y(v)).reverse()).join(' ');svg.append(svgEl('polygon',{points,fill:color,'fill-opacity':0.85}));top.forEach((v,i)=>(sign===1?pos:neg)[i]=v);}
   months.forEach((m,i)=>{const v=rows[m]?.[w.id]||0;if(!v)return;const dot=svgEl('circle',{cx:x(i),cy:y(pos[i]+neg[i]),r:3,fill:color});dot.append(svgEl('title',{},m+' · '+w.name+': '+money(v,currency)));svg.append(dot);});});
  const step=Math.max(1,Math.ceil(months.length/12));months.forEach((m,i)=>{if(i%step===0||i===months.length-1)svg.append(svgEl('text',{x:x(i),y:292,'text-anchor':'middle',fill:'#466877','font-size':11},new Date(m+'-01T12:00:00').toLocaleDateString('nl-NL',{month:'short',year:'2-digit'})));});
  const legend=element('div','','monthly-legend');groups.forEach(w=>{const item=element('span',''),dot=element('span','','revenue-dot');dot.style.background=colors[data.workspaces.indexOf(w)];item.append(dot,element('span',w.name));legend.append(item);});panel.append(legend);
  const details=element('details','');details.append(element('summary','Bedragen per maand'));const table=element('table',''),head=element('tr','');for(const text of ['Maand',...groups.map(w=>w.name),'Totaal'])head.append(element('th',text));table.append(head);for(const m of months){const tr=element('tr','');tr.append(element('td',m));let total=0;for(const w of groups){const v=rows[m]?.[w.id]||0;total+=v;tr.append(element('td',money(v,currency)));}tr.append(element('td',money(total,currency)));table.append(tr);}const scroll=element('div','','table-scroll');scroll.append(table);details.append(scroll);panel.append(details);
 }
 if(monthly.unallocated)panel.append(element('p','Niet alle facturen kunnen aan één maand en werkruimte worden toegewezen. Deze bedragen ontbreken in de grafiek.','note'));
}

function renderNewsletter(n,root){
 const panel=element('section','','panel');panel.append(element('h2','Nieuwsbrief · MailerLite'));root.append(panel);
 if(!n.syncedAt){panel.append(element('p',n.error||(n.configured?'Actuele aantallen worden opgehaald. Je kunt de voortgang volgen onder Databronnen.':'Koppel MailerLite via Databronnen om abonnees en databasegroei te zien.')));return;}
 if(n.error)panel.append(element('p',n.error+' De laatst opgehaalde cijfers worden getoond.','royalty-warning'));
 const cards=element('div','','metrics');for(const [label,value] of [['Actieve abonnees · nu',n.counts.active],['Alle contacten · nu',n.total],['Netto groei actieve abonnees',n.netGrowth]]){const card=element('article','');card.append(element('div',label),element('strong',value===null?'Nog niet beschikbaar':value.toLocaleString('nl-NL')));cards.append(card);}panel.append(cards);
 panel.append(element('p','Actuele aantallen op '+new Date(n.syncedAt).toLocaleString('nl-NL')+'. Netto groei is het verschil tussen gemeten actieve aantallen'+(n.baseline?' vanaf '+n.baseline.day:'')+'. De metingen starten bij het koppelen; eerdere netto groei is niet bekend.','note'));
 const svgEl=(tag,attrs={},text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);if(text!==undefined)node.textContent=text;return node;};
 panel.append(element('h3','Groei van actieve abonnees'));
 const points=n.history;
 if(points.length<2)panel.append(element('p','Na metingen op twee verschillende dagen verschijnt hier de groeigrafiek.'));
 else{const svg=svgEl('svg',{viewBox:'0 0 950 290',role:'img','aria-label':'Actieve nieuwsbriefabonnees per gemeten dag'}),wrap=element('div','','monthly-chart');wrap.append(svg);panel.append(wrap);const start=Date.parse(points[0].day),end=Date.parse(points.at(-1).day),max=Math.max(1,...points.map(p=>p.active)),x=p=>80+820*(Date.parse(p.day)-start)/(end-start),y=p=>240-210*p.active/max;
 for(let i=0;i<=4;i++){const v=max*i/4,py=240-210*i/4;svg.append(svgEl('line',{x1:80,x2:900,y1:py,y2:py,stroke:'#cfe4ef'}),svgEl('text',{x:72,y:py+4,'text-anchor':'end',fill:'#466877','font-size':11},Math.round(v).toLocaleString('nl-NL')));}
 const line=points.map(p=>x(p)+','+y(p)).join(' ');svg.append(svgEl('polygon',{points:'80,240 '+line+' 900,240',fill:'#edf7fd'}),svgEl('polyline',{points:line,fill:'none',stroke:'#13638b','stroke-width':3}));points.forEach((p,i)=>{const dot=svgEl('circle',{cx:x(p),cy:y(p),r:4,fill:'#e98324'});dot.append(svgEl('title',{},p.day+': '+p.active.toLocaleString('nl-NL')+' actief'));svg.append(dot);if(i===0||i===points.length-1||i%Math.max(1,Math.ceil(points.length/8))===0)svg.append(svgEl('text',{x:x(p),y:265,'text-anchor':'middle','font-size':11,fill:'#466877'},p.day));});}
 panel.append(element('h3','Nieuwsbriefgroepen'),element('p','Actuele aantallen per MailerLite-groep. Een contact kan in meerdere groepen staan; de groepsaantallen tellen daarom niet op tot het unieke totaal.','note'));
 if(n.groupsError)panel.append(element('p',n.groupsError+' Synchroniseer MailerLite opnieuw om de groepen op te halen.','royalty-warning'));
 if(n.groups===null||n.groups===undefined)panel.append(element('p','De groepen verschijnen na de volgende MailerLite-synchronisatie.'));
 else if(!n.groups.length)panel.append(element('p','Geen groepen gevonden in MailerLite.'));
 else{const scroll=element('div','','table-scroll'),table=element('table',''),thead=element('thead',''),head=element('tr','');for(const title of ['Groep','Actief','Alle contacten','Uitgeschreven','Onbevestigd','Gebounced','Spam'])head.append(element('th',title));thead.append(head);table.append(thead);const body=element('tbody','');for(const group of n.groups){const row=element('tr','');row.append(element('td',group.name));for(const value of [group.counts.active,group.total,group.counts.unsubscribed,group.counts.unconfirmed,group.counts.bounced,group.counts.junk])row.append(element('td',value.toLocaleString('nl-NL')));body.append(row);}table.append(body);scroll.append(table);panel.append(scroll);}
 const details=element('details','');details.append(element('summary','Contactstatussen'));for(const [key,label] of [['active','Actief'],['unsubscribed','Uitgeschreven'],['unconfirmed','Onbevestigd'],['bounced','Gebounced'],['junk','Spam']])details.append(element('p',label+': '+n.counts[key].toLocaleString('nl-NL')));panel.append(details);
}
