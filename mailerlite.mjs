const base='https://connect.mailerlite.com/api/subscribers';
export const localDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function importNewsletter(token,fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}){
 const counts={},statuses=['active','unsubscribed','unconfirmed','bounced','junk'],deadline=Date.now()+120000;
 const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw Error('MailerLite: aantallen ophalen duurt te lang. Probeer opnieuw.');return ms;};
 const wait=async ms=>{if(ms>=remaining())throw Error('MailerLite: tijdelijk te druk. Probeer later opnieuw.');await pause(ms);};
 const request=async url=>{
  let response;for(let attempt=0;attempt<3;attempt++){
   await wait(550);response=await fetcher(url.href,{headers:{Authorization:'Bearer '+token,Accept:'application/json','X-Version':'2026-10-26'},redirect:'error',signal:AbortSignal.timeout(Math.min(15000,remaining()))});if(response.ok)break;
   if(![429,500,502,503,504].includes(response.status)||attempt===2)throw Error('MailerLite: aantallen ophalen mislukt (HTTP '+response.status+').');
   const raw=response.headers.get('retry-after'),ms=raw?(Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now()):1000*2**attempt;
   onProgress({completed:Object.keys(counts).length,total:statuses.length,phase:'waiting',retrySeconds:Math.ceil(Math.max(1000,ms||1000)/1000)});await wait(Math.max(1000,ms||1000));
  }
  return response.json();
 };
 for(const status of statuses){
  onProgress({completed:Object.keys(counts).length,total:statuses.length,phase:'fetching'});
  const url=new URL(base);url.searchParams.set('limit','0');url.searchParams.set('filter[status]',status);
  const payload=await request(url);if(!Number.isSafeInteger(payload.total)||payload.total<0||Array.isArray(payload.data))throw Error('MailerLite: geen geldig telresultaat ontvangen. Er worden geen contacten geïmporteerd.');
  counts[status]=payload.total;
 }
 let groups=null,groupsError=null;
 try{
  const result=new Map(),visited=new Set();let next='https://connect.mailerlite.com/api/groups?limit=100';
  while(next){
   onProgress({completed:statuses.length,total:statuses.length,phase:'groups'});
   const url=new URL(next);if(url.origin!=='https://connect.mailerlite.com'||url.pathname!=='/api/groups'||visited.has(url.href)||visited.size>=100)throw Error('MailerLite: ongeldige groepspaginering.');visited.add(url.href);
   const payload=await request(url);if(!Array.isArray(payload.data))throw Error('MailerLite: ongeldige groepsgegevens.');
   for(const g of payload.data){if(g.id==null||typeof g.name!=='string')throw Error('MailerLite: ongeldige groep.');const counts={};for(const status of statuses){const value=g[status==='active'?'active_count':status+'_count'];if(!Number.isSafeInteger(value)||value<0)throw Error('MailerLite: ongeldig groepsaantal.');counts[status]=value;}result.set(String(g.id),{id:String(g.id),name:g.name,counts,total:Object.values(counts).reduce((s,n)=>s+n,0)});}
   next=payload.links?.next||null;
  }
  groups=[...result.values()].sort((a,b)=>b.counts.active-a.counts.active||a.name.localeCompare(b.name,'nl'));
 }catch(e){groupsError=e.name==='TimeoutError'?'MailerLite: ophalen groepen duurde te lang.':e.message;}
 onProgress({completed:statuses.length,total:statuses.length,phase:'complete'});
 return {counts,groups,groupsError,total:Object.values(counts).reduce((s,n)=>s+n,0),mode:'counts',syncedAt:new Date().toISOString()};
}
export function recordNewsletter(previous={},result,day=localDay()){
 const history=(previous.history||[]).filter(h=>h.day!==day);history.push({day,active:result.counts.active,total:result.total,groups:(result.groups||[]).map(g=>({id:g.id,name:g.name,active:g.counts.active}))});history.sort((a,b)=>a.day.localeCompare(b.day));return {...result,history};
}
export function newsletterReport(state={},filters={}){
 const inPeriod=day=>(!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to);
 const history=state.history||[],selected=history.filter(h=>inPeriod(h.day)),baseline=history.filter(h=>filters.from&&h.day<filters.from).at(-1)||selected[0],last=selected.at(-1);
 const keyGroups=['SonoSkills','SonoSkills - Free Webinar'].map(name=>{const normalize=v=>v.trim().replace(/[–—]/g,'-').replace(/\s+/g,' ').toLowerCase().replace(/^(sonoskills - free) webinars$/, '$1 webinar');const matches=(state.groups||[]).filter(g=>normalize(g.name)===normalize(name));const group=matches.length===1?matches[0]:null;const points=group?history.flatMap(h=>{const g=h.groups?.find(g=>g.id===group.id);return g?[{day:h.day,active:g.active}]:[];}):[];const selected=points.filter(h=>inPeriod(h.day)),baseline=points.filter(h=>filters.from&&h.day<filters.from).at(-1)||selected[0],last=selected.at(-1);return {name,group,history:selected,baseline:baseline||null,netGrowth:baseline&&last&&baseline.day!==last.day?last.active-baseline.active:null};});
 return {keyGroups,syncedAt:state.syncedAt||null,counts:state.counts||null,groups:state.groups??null,groupsError:state.groupsError||null,total:state.total??null,history:selected,baseline:baseline||null,netGrowth:baseline&&last&&baseline.day!==last.day?last.active-baseline.active:null};
}
