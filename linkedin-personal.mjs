import {createHash} from 'node:crypto';
import {localDay} from './mailerlite.mjs';
import {validDate} from './royalties.mjs';
export const personalLinkedInConfig=()=>({token:process.env.LINKEDIN_PERSONAL_ACCESS_TOKEN,name:process.env.LINKEDIN_PERSONAL_NAME||'Marc Schmitz',version:process.env.LINKEDIN_API_VERSION||'202610'});
const fingerprint=c=>createHash('sha256').update(c.token||'').digest('hex');
const number=v=>Number.isSafeInteger(v)&&v>=0?v:null;
async function read(config,path,fetcher){
 const url=new URL(path,'https://api.linkedin.com/rest/');if(url.origin!=='https://api.linkedin.com'||!url.pathname.startsWith('/rest/'))throw Error('Ongeldige LinkedIn-paginering.');
 let response;try{response=await fetcher(url.href,{headers:{Authorization:'Bearer '+config.token,'LinkedIn-Version':config.version,'X-Restli-Protocol-Version':'2.0.0'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Persoonlijk LinkedIn-profiel tijdelijk niet bereikbaar.');}
 if(!response.ok)throw Error(response.status===401?'Persoonlijk LinkedIn-token verlopen. Vernieuw LINKEDIN_PERSONAL_ACCESS_TOKEN.':response.status===403?'Toegang geweigerd. Laat Marc r_member_postAnalytics en r_member_profileAnalytics toestaan.':response.status===429?'LinkedIn API-limiet bereikt. Probeer later opnieuw.':`Persoonlijke LinkedIn-statistieken ophalen mislukt (HTTP ${response.status}).`);
 let json;try{json=await response.json();}catch{throw Error('LinkedIn gaf een ongeldig antwoord.');}if(!Array.isArray(json.elements))throw Error('LinkedIn gaf geen geldige statistieken.');return json;
}
export async function importPersonalFollowers(config,previous={},fetcher=fetch){
 if(!config.token)return previous;const key=fingerprint(config),old=previous.tokenKey===key?previous:{};
 try{const data=await read(config,'memberFollowersCount?q=me',fetcher),followers=data.elements.length===1?number(data.elements[0].memberFollowersCount):null;if(followers===null)throw Error('LinkedIn gaf geen geldig persoonlijk volgersaantal.');const history=(old.history||[]).filter(h=>h.day!==localDay());history.push({day:localDay(),followers});history.sort((a,b)=>a.day.localeCompare(b.day));return {tokenKey:key,followers,history,syncedAt:new Date().toISOString(),error:null};}catch(e){return {...old,tokenKey:key,error:e.message};}
}
const cache=new Map(),pending=new Map();
export function clearPersonalLinkedInCache(){cache.clear();}
const dateTuple=day=>{const [year,month,date]=day.split('-').map(Number);return `(year:${year},month:${month},day:${date})`;};
export async function personalLinkedInReport(config,stored={},filters={},fetcher=fetch){
 const base={name:config.name,configured:!!config.token,followers:null,history:[],growth:null,metrics:{},errors:[]};if(!config.token)return base;
 const from=filters.from||localDay().slice(0,4)+'-01-01',to=filters.to||localDay();if(!validDate(from)||!validDate(to)||from>to)return {...base,errors:['Kies een geldige periode.']};
 const key=fingerprint(config),profile=stored.tokenKey===key?stored:{},history=(profile.history||[]).filter(h=>h.day>=from&&h.day<=to),baseline=(profile.history||[]).filter(h=>h.day<from).at(-1)||history[0],last=history.at(-1);
 Object.assign(base,{from,to,followers:profile.followers??null,syncedAt:profile.syncedAt,history,growth:baseline&&last&&baseline.day!==last.day?last.followers-baseline.followers:null,errors:profile.error?[profile.error]:[]});
 const cacheKey=JSON.stringify([key,config.version,from,to]),cached=cache.get(cacheKey);if(cached&&Date.now()-cached.at<300000)return {...base,...cached.value};
 if(!pending.has(cacheKey))pending.set(cacheKey,(async()=>{
  const endDate=new Date(to+'T12:00:00Z');endDate.setUTCDate(endDate.getUTCDate()+1);const end=endDate.toISOString().slice(0,10),range=`(start:${dateTuple(from)},end:${dateTuple(end)})`,metrics={},errors=[];
  for(const type of ['IMPRESSION','MEMBERS_REACHED','REACTION','COMMENT','RESHARE']){
   try{let path=`memberCreatorPostAnalytics?q=me&queryType=${type}&aggregation=TOTAL&dateRange=${range}`;const values=[],seen=new Set();while(path){if(seen.has(path)||seen.size>=20)throw Error('LinkedIn-statistieken onvolledig door paginering.');seen.add(path);const json=await read(config,path,fetcher);values.push(...json.elements);path=json.paging?.links?.find(l=>l.rel==='next')?.href||null;}
    if(values.length!==1)throw Error(`LinkedIn gaf geen eenduidig totaal voor ${type}.`);const row=values[0],metricType=typeof row.metricType==='string'?row.metricType:Object.values(row.metricType||{})[0];if(metricType!==type||number(row.count)===null)throw Error(`LinkedIn gaf geen geldig totaal voor ${type}.`);metrics[type]=row.count;
   }catch(e){metrics[type]=null;errors.push(e.message);}
  }
  const value={metrics,metricErrors:[...new Set(errors)],metricsSyncedAt:new Date().toISOString()};cache.set(cacheKey,{at:Date.now(),value});while(cache.size>100)cache.delete(cache.keys().next().value);return value;
 })().finally(()=>pending.delete(cacheKey)));
 return {...base,...await pending.get(cacheKey)};
}
