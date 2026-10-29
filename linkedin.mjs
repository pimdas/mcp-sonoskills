import {localDay} from './mailerlite.mjs';
const metric=(v,signed=false)=>Number.isSafeInteger(v)&&(signed||v>=0)?v:null;

export function linkedInPost(p,organizationId){
 const author=typeof p.author==='string'?/^urn:li:(?:organization|organizationBrand|company):(\d+)$/.exec(p.author):null;
 if(!author||author[1]!==String(organizationId))throw Error('LinkedIn-bericht heeft een ontbrekende of afwijkende organisatie als auteur.');
 if(!/^urn:li:(share|ugcPost):\d+$/.test(p.id||''))throw Error('LinkedIn-bericht heeft een ontbrekend of niet ondersteund bericht-ID.');
 const raw=p.publishedAt??p.createdAt,timestamp=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
 if(!Number.isSafeInteger(timestamp)||timestamp<=0||!Number.isFinite(new Date(timestamp).getTime()))throw Error('LinkedIn-bericht mist zowel een geldige publicatiedatum als aanmaakdatum.');
 return {id:p.id,date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp)),dateSource:p.publishedAt==null?'created':'published',url:'https://www.linkedin.com/feed/update/'+encodeURIComponent(p.id)+'/',likes:null,comments:null,shares:null,impressions:null,clicks:null};
}
export async function importLinkedIn(config,previous={},fetcher=fetch){
 const id=String(config.linkedin||''),old=previous.id===id?previous:{},deadline=Date.now()+180000;
 const failed=message=>({...old,id,error:message});
 if(!/^\d+$/.test(id))return failed('Vul een numeriek LINKEDIN_ORGANIZATION_ID in Railway in.');
 const version=config.linkedinVersion||'202610';if(!/^\d{6}$/.test(version))return failed('Ongeldige LINKEDIN_API_VERSION. Gebruik YYYYMM.');
 async function get(path){
  const url=new URL(path,'https://api.linkedin.com/rest/');if(url.origin!=='https://api.linkedin.com'||!url.pathname.startsWith('/rest/'))throw Error('Ongeldige LinkedIn-paginering.');
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('LinkedIn-import duurde te lang; vorige gegevens blijven bewaard.');
  let response;try{response=await fetcher(url.href,{headers:{Authorization:'Bearer '+config.linkedinToken,'LinkedIn-Version':version,'X-Restli-Protocol-Version':'2.0.0'},redirect:'error',signal:AbortSignal.timeout(Math.min(remaining,15000))});}catch{throw Error('LinkedIn is tijdelijk niet bereikbaar. Probeer later opnieuw.');}
  let detail='';if(response.status===400){try{const error=await response.json();detail=typeof error.message==='string'?error.message.replaceAll(config.linkedinToken,'[afgeschermd]').slice(0,300):'';}catch{}}
  if(!response.ok)throw Error(response.status===401?'LinkedIn-token verlopen of ongeldig. Vernieuw LINKEDIN_ACCESS_TOKEN in Railway.':response.status===403?'LinkedIn weigert toegang. Controleer Community Management API, rw_organization_admin, r_organization_social en je beheerdersrol op de pagina.':response.status===429?'LinkedIn API-limiet bereikt. Probeer later opnieuw.':`LinkedIn ${url.pathname} ophalen mislukt (HTTP ${response.status})${detail?': '+detail:''}.`);
  try{return await response.json();}catch{throw Error('LinkedIn gaf een ongeldig antwoord.');}
 }
 async function list(path){const result=[],seen=new Set();while(path){if(seen.has(path)||seen.size>=50)throw Error('LinkedIn-import onvolledig: te veel of herhaalde pagina’s.');seen.add(path);const page=await get(path);if(!Array.isArray(page.elements))throw Error('LinkedIn gaf geen geldige berichten of statistieken.');result.push(...page.elements);path=page.paging?.links?.find(l=>l.rel==='next')?.href||null;}return result;}
 try{
  const urn='urn:li:organization:'+id,profile=await get('organizations/'+id),size=await get('networkSizes/'+encodeURIComponent(urn)+'?edgeType=COMPANY_FOLLOWED_BY_MEMBER');
  if(String(profile.id)!==id||metric(size.firstDegreeSize)===null)throw Error('LinkedIn gaf geen geldig profiel of volgersaantal.');
  const syncedAt=new Date().toISOString(),history=(old.history||[]).filter(h=>h.day!==localDay());history.push({day:localDay(),followers:size.firstDegreeSize});history.sort((a,b)=>a.day.localeCompare(b.day));
  const next={...old,id,name:profile.localizedName||profile.vanityName||'LinkedIn',followers:size.firstDegreeSize,syncedAt,history,error:null};
  try{
   const raw=await list('posts?'+new URLSearchParams({q:'author',author:urn,count:'100',sortBy:'CREATED'})),posts=new Map();
   for(const p of raw){if(p.lifecycleState!=='PUBLISHED'||p.adContext?.isDsc)continue;const normalized=linkedInPost(p,id);posts.set(normalized.id,normalized);}
   for(const type of ['share','ugcPost']){const ids=[...posts.keys()].filter(id=>id.startsWith('urn:li:'+type+':'));for(let start=0;start<ids.length;start+=20){const batch=ids.slice(start,start+20),q=new URLSearchParams({q:'organizationalEntity',organizationalEntity:urn});q.set(type==='share'?'shares':'ugcPosts','List('+batch.join(',')+')');const stats=await list('organizationalEntityShareStatistics?'+q.toString().replaceAll('%28','(').replaceAll('%29',')').replaceAll('%2C',','));for(const item of stats){const post=posts.get(item.share||item.ugcPost);if(!post||!batch.includes(post.id)||item.organizationalEntity!==urn)throw Error('LinkedIn-statistieken horen niet bij de gevraagde berichten.');const t=item.totalShareStatistics||{};Object.assign(post,{likes:metric(t.likeCount,true),comments:metric(t.commentCount),shares:metric(t.shareCount),impressions:metric(t.impressionCount),clicks:metric(t.clickCount)});}}}
   next.posts=[...posts.values()];next.postsSyncedAt=syncedAt;next.postsError=null;
  }catch(e){next.postsError=e.message;}
  return next;
 }catch(e){return failed(e.message);}
}
