import {localDay} from './mailerlite.mjs';
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export const socialConfig=()=>({token:process.env.META_ACCESS_TOKEN,pageToken:process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN,facebook:process.env.META_FACEBOOK_PAGE_ID,instagram:process.env.META_INSTAGRAM_ACCOUNT_ID});
export async function importSocial(config,previous={},fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))){
 const secrets=new Set([config.token,config.pageToken].filter(Boolean));
 const safe=value=>{let text=String(value||'');for(const secret of secrets)text=text.replaceAll(secret,'[afgeschermd]');return text.replace(/(access_token[=:\s]+)[^\s&,]+/gi,'$1[afgeschermd]').replace(/EAA[A-Za-z0-9_-]{20,}/g,'[afgeschermd]').slice(0,600);};
 const result={accounts:{...previous.accounts}},version='v26.0',deadline=Date.now()+180000;
 async function get(path,token=config.token){const url=new URL(path,'https://graph.facebook.com/'+version+'/');if(url.origin!=='https://graph.facebook.com'||!url.pathname.startsWith('/'+version+'/'))throw Error('Ongeldige Meta-paginering.');url.searchParams.delete('access_token');
  for(let attempt=0;attempt<3;attempt++){const left=deadline-Date.now();if(left<=0)throw Error('Meta-synchronisatie duurt te lang. Probeer opnieuw.');await pause(300);const response=await fetcher(url.href,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(Math.min(15000,left))});let data;try{data=await response.json();}catch{throw Error('Meta gaf een ongeldige response.');}if(response.ok&&!data.error){if(typeof data.access_token==='string')secrets.add(data.access_token);return data;}const code=data.error?.code;if(code===190)throw Error('Meta-token verlopen of ongeldig. Vernieuw META_ACCESS_TOKEN in Railway.');if((response.status===429||response.status>=500||[4,17,32,613].includes(code))&&attempt<2){await pause(1000*2**attempt);continue;}throw Error('Meta '+url.pathname+' geweigerd (HTTP '+response.status+', code '+(code??'onbekend')+(data.error?.error_subcode?', subcode '+data.error.error_subcode:'')+'): '+safe(data.error?.message||'Controleer de leesrechten.'));}
 }
 for(const platform of ['facebook','instagram']){
  const id=config[platform];if(!id)continue;if(!/^\d+$/.test(id))throw Error('Ongeldig Meta-account-ID.');const old=previous.accounts?.[platform]?.id===id?previous.accounts[platform]:{};
  try{
   const fields=platform==='facebook'?'id,name,followers_count':'id,username,followers_count,media_count';const profile=await get(id+'?fields='+fields);if(String(profile.id)!==id||count(profile.followers_count)===null)throw Error('Meta gaf geen geldig volgersaantal.');
   const syncedAt=new Date().toISOString(),history=(old.history||[]).filter(h=>h.day!==localDay());history.push({day:localDay(),followers:profile.followers_count});history.sort((a,b)=>a.day.localeCompare(b.day));
   const next={...old,id,name:profile.name||profile.username||platform,followers:profile.followers_count,mediaCount:count(profile.media_count),syncedAt,history,error:null};
   try{
    let token=config.token;if(platform==='facebook'){token=config.pageToken||(await get(id+'?fields=access_token')).access_token;if(!token)throw Error('Meta geeft geen Facebook-paginatoken terug. Stel META_FACEBOOK_PAGE_ACCESS_TOKEN in Railway in.');secrets.add(token);}
    const fields=platform==='facebook'?'id,created_time,permalink_url,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares':'id,timestamp,permalink,like_count,comments_count';
    let path=id+(platform==='facebook'?'/posts':'/media')+'?limit=100&fields='+encodeURIComponent(fields);const posts=new Map(),visited=new Set();
    while(path){if(visited.has(path)||visited.size>=100)throw Error('Meta-berichtenimport onvolledig; te veel of herhaalde pagina’s.');visited.add(path);const page=await get(path,token);if(!Array.isArray(page.data))throw Error('Meta gaf geen berichtenlijst.');for(const p of page.data){if(!p.id)throw Error('Meta-bericht zonder ID.');const date=p.created_time||p.timestamp;if(!date||!Number.isFinite(Date.parse(date)))throw Error('Meta-bericht zonder geldige datum.');posts.set(String(p.id),{id:String(p.id),date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date)),url:p.permalink_url||p.permalink||'',likes:count(platform==='facebook'?p.reactions?.summary?.total_count:p.like_count),comments:count(platform==='facebook'?p.comments?.summary?.total_count:p.comments_count),shares:platform==='facebook'?count(p.shares?.count??0):null});}path=page.paging?.next||null;}
    next.posts=[...posts.values()];next.postsSyncedAt=syncedAt;next.postsError=null;
   }catch(e){next.postsError=e.name==='TimeoutError'?'Meta-berichten ophalen duurde te lang.':e.message;}
   result.accounts[platform]=next;
  }catch(e){result.accounts[platform]={...old,id,error:e.name==='TimeoutError'?'Meta reageert niet binnen de tijdslimiet.':e.message};}
 }
 return result;
}
export function socialReport(state,filters={},config={}){
 return ['facebook','instagram','linkedin'].map(platform=>{
  const stored=state.accounts?.[platform],a=stored&&stored.id===config[platform]?stored:{},configured=!!config.token&&!!config[platform];const history=(a.history||[]).filter(h=>(!filters.from||h.day>=filters.from)&&(!filters.to||h.day<=filters.to));
  const posts=(a.posts||[]).filter(p=>(!filters.from||p.date>=filters.from)&&(!filters.to||p.date<=filters.to));const sum=key=>a.postsSyncedAt&&!posts.some(p=>p[key]===null)?posts.reduce((s,p)=>s+p[key],0):null;
  const months=[...new Set(history.map(h=>h.day.slice(0,7)))].sort().map(month=>{const points=history.filter(h=>h.day.startsWith(month)),baseline=(a.history||[]).filter(h=>h.day<(filters.from&&filters.from>month+'-01'?filters.from:month+'-01')).at(-1)||points[0],last=points.at(-1);return {month,from:baseline.day,to:last.day,start:baseline.followers,end:last.followers,growth:baseline.day===last.day?null:last.followers-baseline.followers};});
  return {platform,configured,...a,history,months,posts:posts.sort((a,b)=>b.date.localeCompare(a.date)),postCount:a.postsSyncedAt?posts.length:null,likes:sum('likes'),comments:sum('comments'),shares:sum('shares')};
 });
}
