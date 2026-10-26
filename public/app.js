const $=s=>document.querySelector(s);
let status, lastSync=null;
async function api(path,body){const r=await fetch(path,body!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:JSON.stringify(body)}:{});const d=await r.json();if(r.status===401 && path!=='/api/login'){showLogin();throw Error('Log opnieuw in.');}if(!r.ok)throw Error(d.error||'Er ging iets mis.');return d;}
function showLogin(){$('#login').hidden=false;$('#dashboard').hidden=true;}
function element(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function params(){return new URLSearchParams([...new FormData($('#filters'))].filter(([,v])=>v));}
async function load(){
  const d=await api('/api/analytics?'+params());
  for(const key of ['editions','enrollments','returning'])$('#'+key).textContent=status?.syncedAt?d.metrics[key].toLocaleString('nl-NL'):'—';
  $('#occupancy').textContent=d.metrics.occupancy==null?'—':d.metrics.occupancy+'%';
  for(const key of ['course','location']){const select=$(`[name=${key}]`),selected=select.value;select.replaceChildren(element('option',key==='course'?'Alle opleidingen':'Alle locaties'));select.firstChild.value='';for(const item of d.options[key==='course'?'courses':'locations']){const option=element('option',item.name);option.value=item.id;select.append(option);}select.value=selected;}
  $('#rows').replaceChildren();
  const labels={active:'Actief',completed:'Afgerond',planned:'Gepland',canceled:'Geannuleerd'};
  for(const row of d.rows){const tr=element('tr','');for(const text of [row.name,row.location,row.start?new Date(row.start.slice(0,10)+'T12:00:00').toLocaleDateString('nl-NL'):'—',labels[row.status]||row.status,row.participants+(row.capacity?' / '+row.capacity:''),row.occupancy==null?'—':row.occupancy+'%'])tr.append(element('td',text));$('#rows').append(tr);}
  if(!d.rows.length){const tr=element('tr',''),td=element('td',status?.syncedAt?'Geen cursusedities binnen deze selectie.':'Je cursusgegevens verschijnen na de eerste synchronisatie.');td.colSpan=6;tr.append(td);$('#rows').append(tr);}
  $('#finance').replaceChildren();for(const [currency,totals] of Object.entries(d.totals)){for(const [key,label] of [['invoiced','Gefactureerd excl. btw'],['open','Openstaand incl. btw']]){const row=element('div','','finance-row');row.append(element('span',label),element('strong',currency==='ONBEKEND'?totals[key]+' (valuta onbekend)':new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(totals[key])));$('#finance').append(row);}}
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
refresh().then(load).catch(()=>showLogin());setInterval(()=>{if(!$('#dashboard').hidden)refresh().catch(e=>$('#message').textContent=e.message);},5000);
