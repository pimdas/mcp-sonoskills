import {createHash,sign} from 'node:crypto';
const scope='https://www.googleapis.com/auth/analytics.readonly';
export const ga4Configured=()=>!!(process.env.GA4_PROPERTY_ID&&process.env.GA4_SERVICE_ACCOUNT_JSON);
const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'}).format(new Date());
const shift=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function ga4Period(filters={},today=day()){
 const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 const from=filters.from||today.slice(0,4)+'-01-01',requestedTo=filters.to||today;
 if(!valid(from)||!valid(requestedTo)||from>requestedTo)throw Error('Kies een geldige datumperiode.');
 const to=requestedTo<today?requestedTo:shift(today,-1),days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
 if(days>1096)throw Error('Kies voor Website een periode van maximaal drie jaar.');
 return {from,to,requestedTo,days,previousFrom:shift(from,-Math.max(0,days)),previousTo:shift(from,-1),empty:days<=0};
}
const cache=new Map(),pending=new Map();let tokenCache=null;
export async function websiteReport(filters={},config={property:process.env.GA4_PROPERTY_ID,json:process.env.GA4_SERVICE_ACCOUNT_JSON},fetcher=fetch){
 if(!config.property||!config.json)return {configured:false};
 try{
  if(!/^\d+$/.test(config.property))throw Error('Controleer GA4_PROPERTY_ID: gebruik het numerieke Property-ID.');
  let credentials;try{credentials=JSON.parse(config.json);}catch{throw Error('GA4_SERVICE_ACCOUNT_JSON bevat geen geldig JSON-bestand.');}
  if(credentials.type!=='service_account'||!credentials.client_email?.endsWith('.gserviceaccount.com')||!credentials.private_key?.includes('BEGIN PRIVATE KEY'))throw Error('Gebruik de volledige JSON-sleutel van het Google-serviceaccount.');
  const period=ga4Period(filters);if(period.empty)return {configured:true,period,empty:true};
  const fingerprint=createHash('sha256').update(config.property+config.json).digest('hex'),key=fingerprint+period.from+period.to;
  const cached=cache.get(key);if(fetcher===fetch&&cached&&cached.until>Date.now())return cached.data;
  if(fetcher===fetch&&pending.has(key))return pending.get(key);
  const task=(async()=>{
   const signal=AbortSignal.timeout(45000);
   async function request(url,options){for(let attempt=0;attempt<2;attempt++){const response=await fetcher(url,{...options,signal,redirect:'error'});if(response.ok)return response.json();if((response.status===429||response.status>=500)&&attempt===0){await new Promise(r=>setTimeout(r,600));continue;}if(response.status===403)throw Error('Google Analytics weigert toegang. Controleer of de Data API actief is en het serviceaccount Kijker is op deze property.');if(response.status===401)throw Error('Google Analytics: de serviceaccountsleutel is ongeldig.');throw Error('Google Analytics ophalen mislukt (HTTP '+response.status+'). Controleer de koppeling en probeer opnieuw.');}}
   let token=fetcher===fetch&&tokenCache?.fingerprint===fingerprint&&tokenCache.until>Date.now()?tokenCache.token:null;
   if(!token){const now=Math.floor(Date.now()/1000),encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const unsigned=encode({alg:'RS256',typ:'JWT',kid:credentials.private_key_id})+'.'+encode({iss:credentials.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});let jwt;try{jwt=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),credentials.private_key).toString('base64url');}catch{throw Error('De privésleutel in GA4_SERVICE_ACCOUNT_JSON is ongeldig.');}const result=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}).toString()});if(typeof result.access_token!=='string')throw Error('Google Analytics: geen toegangstoken ontvangen.');token=result.access_token;if(fetcher===fetch)tokenCache={fingerprint,token,until:Date.now()+Math.max(0,Math.min(Number(result.expires_in)||0,3600)-60)*1000};}
   const warnings=new Set();let timeZone=null;
   async function report(from,to,dimensions,metrics,extra={}){
    const data=await request('https://analyticsdata.googleapis.com/v1beta/properties/'+config.property+':runReport',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({dateRanges:[{startDate:from,endDate:to}],dimensions:dimensions.map(name=>({name})),metrics:metrics.map(name=>({name})),...extra})});
    if(data.metadata?.subjectToThresholding)warnings.add('Google past privacydrempels toe; sommige gegevens kunnen ontbreken.');if(data.metadata?.dataLossFromOtherRow)warnings.add('Google bundelt een deel van de gegevens onder (other).');if(data.metadata?.samplingMetadatas?.length)warnings.add('Google gebruikt een steekproef voor dit rapport.');timeZone=data.metadata?.timeZone||timeZone;
    if(data.rows&&!Array.isArray(data.rows))throw Error('Google Analytics geeft ongeldige rapportgegevens terug.');
    return (data.rows||[]).map(row=>{const values={};dimensions.forEach((name,i)=>values[name]=row.dimensionValues?.[i]?.value||'');metrics.forEach((name,i)=>{const raw=row.metricValues?.[i]?.value,value=Number(raw);if(raw==null||!Number.isFinite(value)||value<0)throw Error('Google Analytics geeft ongeldige meetwaarden terug.');values[name]=value;});return values;});
   }
   const metrics=['activeUsers','newUsers','sessions','screenPageViews','keyEvents','engagementRate'],zero=Object.fromEntries(metrics.map(k=>[k,0]));
   const totals=(await report(period.from,period.to,[],metrics))[0]||zero;
   const previous=(await report(period.previousFrom,period.previousTo,[],metrics))[0]||zero;
   const trend=await report(period.from,period.to,['date'],['activeUsers','sessions'],{limit:1100,orderBys:[{dimension:{dimensionName:'date'}}]});
   const channels=await report(period.from,period.to,['sessionDefaultChannelGroup'],['sessions','keyEvents'],{limit:30,orderBys:[{metric:{metricName:'sessions'},desc:true}]});
   const pages=await report(period.from,period.to,['hostName','pagePath'],['screenPageViews'],{limit:20,orderBys:[{metric:{metricName:'screenPageViews'},desc:true}]});
   const events=await report(period.from,period.to,['eventName'],['keyEvents'],{limit:20,metricFilter:{filter:{fieldName:'keyEvents',numericFilter:{operation:'GREATER_THAN',value:{int64Value:'0'}}}},orderBys:[{metric:{metricName:'keyEvents'},desc:true}]});
   const data={configured:true,property:config.property,period,timeZone,totals,previous,trend,channels,pages,events,warnings:[...warnings],fetchedAt:new Date().toISOString()};
   if(fetcher===fetch){if(cache.size>=30)cache.delete(cache.keys().next().value);cache.set(key,{data,until:Date.now()+300000});}return data;
  })();
  if(fetcher===fetch)pending.set(key,task);try{return await task;}finally{pending.delete(key);}
 }catch(e){const safe=e.message?.startsWith('Google')||/^(Kies|Controleer|GA4_|Gebruik|De privésleutel)/.test(e.message||'');return {configured:true,error:safe?e.message:'Google Analytics is tijdelijk niet beschikbaar. Probeer opnieuw.'};}
}
