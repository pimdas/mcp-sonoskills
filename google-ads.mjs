import {createHash,sign} from 'node:crypto';
const api='https://googleads.googleapis.com/v25';
const scope='https://www.googleapis.com/auth/adwords';
const cache=new Map(),pending=new Map();let tokenCache;
const shift=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function googleAdsPeriod(filters={},today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'}).format(new Date())){
 const valid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 const from=filters.from||today.slice(0,4)+'-01-01',requestedTo=filters.to||today;
 if(!valid(from)||!valid(requestedTo)||from>requestedTo)throw Error('Kies een geldige datumperiode.');
 const to=requestedTo<today?requestedTo:shift(today,-1),days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
 if(days>1096)throw Error('Kies voor Google Ads een periode van maximaal drie jaar.');
 return {from,to,requestedTo,days,previousFrom:shift(from,-Math.max(0,days)),previousTo:shift(from,-1),empty:days<=0};
}
const normalizeId=v=>String(v||'').replace(/[\s-]/g,'');
export function validateAdsSettings(input){
 const result={customerId:normalizeId(input?.customerId),loginCustomerId:normalizeId(input?.loginCustomerId)};
 if((result.customerId&&!/^\d{10}$/.test(result.customerId))||(result.loginCustomerId&&!/^\d{10}$/.test(result.loginCustomerId)))throw Error('Gebruik een Google Ads-klantnummer van 10 cijfers, bijvoorbeeld 123-456-7890.');
 return result;
}
export function googleAdsConfig(settings={}){return {...settings,customerId:settings.customerId||process.env.GOOGLE_ADS_CUSTOMER_ID||'',loginCustomerId:settings.loginCustomerId||process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID||'',json:process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON||process.env.GA4_SERVICE_ACCOUNT_JSON||''};}
export function googleAdsSetup(config=googleAdsConfig()){
 let credentials;try{credentials=JSON.parse(config.json);}catch{}
 return {customerId:config.customerId||'',loginCustomerId:config.loginCustomerId||'',credentialsConfigured:!!config.json,serviceAccountEmail:credentials?.type==='service_account'?credentials.client_email||'':'',projectId:credentials?.project_id||'',configured:!!(config.customerId&&config.json)};
}
const metricNames=['impressions','clicks','costMicros','conversions'];
function readMetrics(row){const m=row.metrics;if(!m||typeof m!=='object')throw Error('Google Ads geeft ongeldige meetwaarden terug.');const out={};for(const key of metricNames){const n=Number(m[key]??0);if(!Number.isFinite(n)||n<0||(key!=='conversions'&&!Number.isSafeInteger(n)))throw Error('Google Ads geeft ongeldige meetwaarden terug.');out[key]=n;}return out;}
function summarize(rows){const total=Object.fromEntries(metricNames.map(k=>[k,0]));for(const r of rows)for(const k of metricNames)total[k]+=r[k];if(!Number.isSafeInteger(total.costMicros))throw Error('Google Ads geeft een te groot kostentotaal terug.');return {...total,cost:total.costMicros/1e6,ctr:total.impressions?total.clicks/total.impressions:null,averageCpc:total.clicks?total.costMicros/1e6/total.clicks:null,costPerConversion:total.conversions?total.costMicros/1e6/total.conversions:null};}
class AdsError extends Error{constructor(message){super(message);}}
function providerError(data,status){
 const errors=(Array.isArray(data)?data: [data]).flatMap(d=>(d?.error?.details||[]).flatMap(x=>x.errors||[]));
 const codes=new Set(errors.flatMap(e=>Object.values(e.errorCode||{})));
 if(codes.has('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION')||codes.has('ACTION_NOT_PERMITTED'))return 'Dit Google Cloud-project heeft nog geen toegang tot productiegegevens van Google Ads. Vraag Explorer-toegang aan bij de Google Ads API in Google Cloud.';
 if(codes.has('USER_PERMISSION_DENIED'))return 'Het serviceaccount heeft geen toegang tot dit Google Ads-account. Voeg het bij Toegang en beveiliging toe met de rol Alleen-lezen en controleer het klantnummer.';
 if(codes.has('CUSTOMER_NOT_ENABLED'))return 'Dit Google Ads-account is nog niet actief of is niet toegankelijk. Controleer het klantnummer en de accountstatus.';
 if(codes.has('INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION'))return 'Het opgegeven manageraccount heeft geen toegang tot dit Ads-account. Controleer het managerklantnummer.';
 if((Array.isArray(data)?data:[data]).some(d=>d?.error?.details?.some(x=>x.reason==='SERVICE_DISABLED')))return 'Schakel de Google Ads API in voor het Google Cloud-project van dit serviceaccount.';
 if(status===403)return 'Google Ads weigert toegang. Controleer de accounttoegang, of de Google Ads API is ingeschakeld en of het Cloud-project productie-toegang heeft.';
 if(status===401||status===400&&data?.error==='invalid_grant')return 'Google Ads kan het serviceaccount niet aanmelden. Controleer de serviceaccountsleutel.';
 if(status===429)return 'Google Ads heeft de aanvraaglimiet bereikt. Probeer over enkele minuten opnieuw.';
 return 'Google Ads ophalen is mislukt (HTTP '+status+'). Probeer opnieuw; controleer de koppeling als dit aanhoudt.';
}
export async function googleAdsReport(filters={},config=googleAdsConfig(),fetcher=fetch){
 const setup=googleAdsSetup(config);if(!setup.configured)return {configured:false,setup};
 try{
  const ids=validateAdsSettings(config);let credentials;try{credentials=JSON.parse(config.json);}catch{throw new AdsError('De Google-serviceaccountsleutel bevat geen geldig JSON-bestand.');}
  if(credentials.type!=='service_account'||!credentials.client_email?.endsWith('.gserviceaccount.com')||!credentials.private_key?.includes('BEGIN PRIVATE KEY'))throw new AdsError('Gebruik een geldige Google-serviceaccountsleutel voor Google Ads.');
  googleAdsPeriod(filters); // Reject invalid dates before any provider calls.
  const fingerprint=createHash('sha256').update(config.json+ids.customerId+ids.loginCustomerId).digest('hex'),key=fingerprint+JSON.stringify([filters.from||'',filters.to||'']);
  const hit=cache.get(key);if(fetcher===fetch&&hit&&hit.until>Date.now())return hit.data;if(fetcher===fetch&&pending.has(key))return pending.get(key);
  const task=(async()=>{
   const signal=AbortSignal.timeout(45000);
   async function request(url,options){for(let attempt=0;attempt<2;attempt++){const response=await fetcher(url,{...options,redirect:'error',signal});if(response.ok)return response.json();let detail;try{detail=await response.json();}catch{}if((response.status===429||response.status>=500)&&attempt===0){await new Promise(r=>setTimeout(r,500));continue;}throw new AdsError(providerError(detail,response.status));}}
   let token=fetcher===fetch&&tokenCache?.fingerprint===fingerprint&&tokenCache.until>Date.now()?tokenCache.token:null;
   if(!token){const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),now=Math.floor(Date.now()/1000),unsigned=encode({alg:'RS256',typ:'JWT',kid:credentials.private_key_id})+'.'+encode({iss:credentials.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});let jwt;try{jwt=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),credentials.private_key).toString('base64url');}catch{throw new AdsError('De privésleutel voor Google Ads is ongeldig.');}
    const result=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}).toString()});if(typeof result.access_token!=='string')throw new AdsError('Google Ads heeft geen toegangstoken teruggegeven.');token=result.access_token;if(fetcher===fetch)tokenCache={fingerprint,token,until:Date.now()+Math.max(0,Math.min(Number(result.expires_in)||0,3600)-60)*1000};
   }
   async function query(query){const headers={Authorization:'Bearer '+token,'Content-Type':'application/json',...(ids.loginCustomerId?{'login-customer-id':ids.loginCustomerId}:{})};const chunks=await request(api+'/customers/'+ids.customerId+'/googleAds:searchStream',{method:'POST',headers,body:JSON.stringify({query})});if(!Array.isArray(chunks)||chunks.some(c=>!c||c.results&&!Array.isArray(c.results)))throw new AdsError('Google Ads geeft ongeldige rapportgegevens terug.');return chunks.flatMap(c=>c.results||[]);}
   const customer=(await query('SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer'))[0]?.customer;
   if(!customer?.currencyCode||!customer.timeZone||!/^\d{10}$/.test(customer.id||''))throw new AdsError('Google Ads heeft geen geldig advertentieaccount teruggegeven.');
   if(customer.manager)throw new AdsError('Dit klantnummer is een manageraccount. Vul het klantnummer van het advertentieaccount in; het managerklantnummer kan in het optionele veld.');
   let today;try{today=new Intl.DateTimeFormat('sv-SE',{timeZone:customer.timeZone}).format(new Date());}catch{throw new AdsError('Google Ads geeft een ongeldige accounttijdzone terug.');}
   const period=googleAdsPeriod(filters,today);if(period.empty)return {configured:true,empty:true,period,account:{id:customer.id,name:customer.descriptiveName||'',currency:customer.currencyCode,timeZone:customer.timeZone}};
   const metrics='metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions';const dateWhere=(from,to)=>"segments.date BETWEEN '"+from+"' AND '"+to+"'";
   const campaigns=(await query('SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, '+metrics+' FROM campaign WHERE '+dateWhere(period.from,period.to))).map(r=>{if(!r.campaign?.id)throw new AdsError('Google Ads geeft een campagne zonder identificatie terug.');return {id:r.campaign.id,name:r.campaign.name||'Naamloos',status:r.campaign.status,channel:r.campaign.advertisingChannelType,...summarize([readMetrics(r)])};}).sort((a,b)=>b.costMicros-a.costMicros||a.name.localeCompare(b.name,'nl'));
   if(new Set(campaigns.map(c=>c.id)).size!==campaigns.length)throw new AdsError('Google Ads geeft dubbele campagnes terug; het rapport is niet opgeteld.');
   const previous=summarize((await query('SELECT '+metrics+' FROM customer WHERE '+dateWhere(period.previousFrom,period.previousTo))).map(readMetrics));
   const goalRows=await query('SELECT segments.conversion_action, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions FROM customer WHERE '+dateWhere(period.from,period.to));
   const goals=new Map();for(const row of goalRows){const count=Number(row.metrics?.conversions??0);if(!Number.isFinite(count)||count<0)throw new AdsError('Google Ads geeft ongeldige conversiecijfers terug.');const id=row.segments?.conversionAction;if(!id||count===0)continue;const goal=goals.get(id)||{id,name:row.segments.conversionActionName||'Naamloos',category:row.segments.conversionActionCategory||'UNKNOWN',conversions:0};goal.conversions+=count;goals.set(id,goal);}
   const data={configured:true,period,account:{id:customer.id,name:customer.descriptiveName||'',currency:customer.currencyCode,timeZone:customer.timeZone},totals:summarize(campaigns),previous,campaigns,goals:[...goals.values()].sort((a,b)=>b.conversions-a.conversions),fetchedAt:new Date().toISOString()};
   if(fetcher===fetch){if(cache.size>=30)cache.delete(cache.keys().next().value);cache.set(key,{data,until:Date.now()+300000});}return data;
  })();if(fetcher===fetch)pending.set(key,task);try{return await task;}finally{if(fetcher===fetch)pending.delete(key);}
 }catch(e){const safe=e instanceof AdsError||/^(Kies|Gebruik een Google Ads-klantnummer|Google Ads geeft)/.test(e.message||'');return {configured:true,error:safe?e.message:'Google Ads is tijdelijk niet beschikbaar. Probeer opnieuw.'};}
}
