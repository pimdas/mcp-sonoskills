const base='https://connect.mailerlite.com/api/subscribers';
export const localDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function importNewsletter(token,fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}){
 const counts={active:0,unsubscribed:0,unconfirmed:0,bounced:0,junk:0},created={},seen=new Set(),pages=new Set();let url=base+'?limit=1000',unknownDates=0;const deadline=Date.now()+15*60*1000;
 const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw Error('MailerLite: import duurt langer dan 15 minuten. Probeer opnieuw; eerdere gegevens zijn bewaard.');return ms;};
 const pauseRetry=async ms=>{if(ms>=remaining())throw Error('MailerLite: wachttijd overschrijdt de importlimiet. Probeer later opnieuw.');await pause(ms);};
 while(url){
  remaining();onProgress({contacts:seen.size,pages:pages.size,phase:'fetching',updatedAt:new Date().toISOString()});
  const target=new URL(url);if(target.origin!=='https://connect.mailerlite.com'||target.pathname!=='/api/subscribers'||pages.has(target.href))throw Error('MailerLite: ongeldige paginering.');pages.add(target.href);if(pages.size>10000)throw Error('MailerLite: te veel pagina’s; import afgebroken.');
  let response;for(let attempt=0;attempt<4;attempt++){await pauseRetry(550);response=await fetcher(target.href,{headers:{Authorization:'Bearer '+token,Accept:'application/json','X-Version':'2026-10-26'},redirect:'error',signal:AbortSignal.timeout(Math.min(30000,remaining()))});if(response.ok)break;if(response.status===422&&target.searchParams.get('limit')==='1000'){target.searchParams.set('limit','100');continue;}if(![429,500,502,503,504].includes(response.status)||attempt===3)throw Error('MailerLite: ophalen mislukt (HTTP '+response.status+').');const raw=response.headers.get('retry-after');const wait=raw?(Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now()):1000*2**attempt;onProgress({contacts:seen.size,pages:pages.size-1,phase:'waiting',retrySeconds:Math.ceil((wait||1000)/1000),updatedAt:new Date().toISOString()});await pauseRetry(wait);}
  if(!response.ok)throw Error('MailerLite: ophalen mislukt (HTTP '+response.status+').');
  const before=seen.size;const payload=await response.json();if(!Array.isArray(payload.data))throw Error('MailerLite: ongeldige response.');
  for(const row of payload.data){if(row.id==null)throw Error('MailerLite: contact-ID ontbreekt.');const id=String(row.id);if(seen.has(id))continue;seen.add(id);if(!Object.hasOwn(counts,row.status))throw Error('MailerLite: onbekende contactstatus.');counts[row.status]++;const day=row.created_at?.slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(day||''))created[day]=(created[day]||0)+1;else unknownDates++;}
  url=payload.links?.next||null;
  if(url&&seen.size===before)throw Error('MailerLite: paginering levert geen nieuwe contacten op; import afgebroken.');
  onProgress({contacts:seen.size,pages:pages.size,phase:'fetching',updatedAt:new Date().toISOString()});
 }
 return {counts,total:seen.size,created,unknownDates,syncedAt:new Date().toISOString()};
}
export function recordNewsletter(previous={},result,day=localDay()){
 const history=(previous.history||[]).filter(h=>h.day!==day);history.push({day,active:result.counts.active,total:result.total});history.sort((a,b)=>a.day.localeCompare(b.day));return {...result,history};
}
export function newsletterReport(state={},filters={}){
 const inPeriod=day=>(!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to),monthly={};for(const [day,n] of Object.entries(state.created||{}))if(inPeriod(day))monthly[day.slice(0,7)]=(monthly[day.slice(0,7)]||0)+n;
 const history=state.history||[],selected=history.filter(h=>inPeriod(h.day)),baseline=history.filter(h=>filters.from&&h.day<filters.from).at(-1)||selected[0],last=selected.at(-1);
 return {syncedAt:state.syncedAt||null,counts:state.counts||null,total:state.total??null,monthly,createdInPeriod:Object.values(monthly).reduce((s,n)=>s+n,0),history:selected,baseline:baseline||null,netGrowth:baseline&&last&&baseline.day!==last.day?last.active-baseline.active:null,unknownDates:state.unknownDates||0};
}
