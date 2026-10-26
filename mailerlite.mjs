const base='https://connect.mailerlite.com/api/subscribers';
export const localDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function importNewsletter(token,fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}){
 const counts={},statuses=['active','unsubscribed','unconfirmed','bounced','junk'],deadline=Date.now()+120000;
 const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw Error('MailerLite: aantallen ophalen duurt te lang. Probeer opnieuw.');return ms;};
 const wait=async ms=>{if(ms>=remaining())throw Error('MailerLite: tijdelijk te druk. Probeer later opnieuw.');await pause(ms);};
 for(const status of statuses){
  onProgress({completed:Object.keys(counts).length,total:statuses.length,phase:'fetching'});
  const url=new URL(base);url.searchParams.set('limit','0');url.searchParams.set('filter[status]',status);
  let response;for(let attempt=0;attempt<3;attempt++){
   await wait(550);response=await fetcher(url.href,{headers:{Authorization:'Bearer '+token,Accept:'application/json','X-Version':'2026-10-26'},redirect:'error',signal:AbortSignal.timeout(Math.min(15000,remaining()))});if(response.ok)break;
   if(![429,500,502,503,504].includes(response.status)||attempt===2)throw Error('MailerLite: aantallen ophalen mislukt (HTTP '+response.status+').');
   const raw=response.headers.get('retry-after'),ms=raw?(Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now()):1000*2**attempt;
   onProgress({completed:Object.keys(counts).length,total:statuses.length,phase:'waiting',retrySeconds:Math.ceil(Math.max(1000,ms||1000)/1000)});await wait(Math.max(1000,ms||1000));
  }
  const payload=await response.json();if(!Number.isSafeInteger(payload.total)||payload.total<0||Array.isArray(payload.data))throw Error('MailerLite: geen geldig telresultaat ontvangen. Er worden geen contacten geïmporteerd.');
  counts[status]=payload.total;
 }
 onProgress({completed:statuses.length,total:statuses.length,phase:'complete'});
 return {counts,total:Object.values(counts).reduce((s,n)=>s+n,0),mode:'counts',syncedAt:new Date().toISOString()};
}
export function recordNewsletter(previous={},result,day=localDay()){
 const history=(previous.history||[]).filter(h=>h.day!==day);history.push({day,active:result.counts.active,total:result.total});history.sort((a,b)=>a.day.localeCompare(b.day));return {...result,history};
}
export function newsletterReport(state={},filters={}){
 const inPeriod=day=>(!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to);
 const history=state.history||[],selected=history.filter(h=>inPeriod(h.day)),baseline=history.filter(h=>filters.from&&h.day<filters.from).at(-1)||selected[0],last=selected.at(-1);
 return {syncedAt:state.syncedAt||null,counts:state.counts||null,total:state.total??null,history:selected,baseline:baseline||null,netGrowth:baseline&&last&&baseline.day!==last.day?last.active-baseline.active:null};
}
