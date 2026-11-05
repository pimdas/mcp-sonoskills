import {readExact,exactDate} from './exact.mjs';
export const costCategories={trainers:'Docenten & royalties',venues:'Locaties & catering',travel:'Reis & verblijf',equipment:'Materialen & apparatuur',marketing:'Marketing',software:'Software & platformen',personnel:'Personeel',organization:'Organisatie',holding:'Holding'};
const cents=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number.isSafeInteger(Math.round(Number(v)*100))?Math.round(Number(v)*100):null;
export async function fetchCosts(token,division,fetcher=fetch,now=new Date()){
 if(!Number.isSafeInteger(division)||division<1)throw Error('Exact-administratie ontbreekt.');
 const from=`${now.getUTCFullYear()-1}-01-01`,until=`${now.getUTCFullYear()+1}-01-01`;let calls=0;const deadline=Date.now()+180000;
 const bounded=async(...args)=>{for(let attempt=0;attempt<3;attempt++){if(++calls>200||Date.now()>deadline)throw Error('Kostenimport te groot; vorige gegevens zijn bewaard.');const response=await fetcher(...args);if(response.status!==429||attempt===2)return response;const wait=Math.max(1000,Number(response.headers.get('Retry-After')||60)*1000);if(!Number.isFinite(wait)||wait>60000||Date.now()+wait>deadline)throw Error('Exact API-limiet bereikt. Probeer de kosten later opnieuw te synchroniseren.');await new Promise(resolve=>setTimeout(resolve,wait));}};
 const accounts=await readExact(`/api/v1/${division}/financial/GLAccounts?$select=ID,Code,Description,BalanceType,BalanceSide&$filter=BalanceType%20eq%20%27W%27%20and%20BalanceSide%20eq%20%27D%27`,token,bounded);
 const divisions=await readExact(`/api/v1/${division}/system/Divisions?$select=Code,Currency&$filter=Code%20eq%20${division}`,token,bounded),currency=divisions.find(d=>Number(d.Code)===division)?.Currency;
 if(!/^[A-Z]{3}$/.test(currency||''))throw Error('Administratievaluta voor kosten ontbreekt.');
 const ids=new Set(accounts.filter(a=>a.BalanceType==='W'&&a.BalanceSide==='D').map(a=>a.ID));
 const filter=`(Status eq 20 or Status eq 50) and Date ge datetime'${from}T00:00:00' and Date lt datetime'${until}T00:00:00'`;
 const raw=await readExact(`/api/v1/${division}/bulk/Financial/TransactionLines?$filter=${encodeURIComponent(filter)}&$select=ID,EntryID,Date,GLAccount,Account,AccountName,Description,AmountDC,InvoiceNumber,Status`,token,bounded);
 const seen=new Set(),lines=[];
 for(const r of raw){if(!ids.has(r.GLAccount)||![20,50].includes(r.Status)||seen.has(r.ID))continue;const amount=cents(r.AmountDC),date=exactDate(r.Date);if(!r.ID||amount===null||!date)throw Error('Exact gaf een kostenregel met een ongeldig bedrag of datum; vorige gegevens zijn bewaard.');if(date<from||date>=until)continue;seen.add(r.ID);lines.push({id:r.ID,status:r.Status,entryId:r.EntryID,date,glAccount:r.GLAccount,supplierId:r.Account||'',supplier:r.AccountName||'Zonder leverancier',description:r.Description||'',invoice:r.InvoiceNumber==null?'':String(r.InvoiceNumber),cents:amount});}
 return {version:3,accounts:accounts.filter(a=>a.BalanceType==='W'&&a.BalanceSide==='D').map(a=>({id:a.ID,code:a.Code?.trim()||'',name:a.Description||a.Code||a.ID})),lines,currency,from,to:`${now.getUTCFullYear()}-12-31`,syncedAt:now.toISOString()};
}
export function validateCostMapping(input,accounts){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Ongeldige kostenindeling.');const ids=new Set(accounts.map(a=>a.id)),result={};for(const [id,category] of Object.entries(input)){if(!ids.has(id)||(!Object.hasOwn(costCategories,category)&&category!=='ignore'))throw Error('Kies een geldige kostenrekening en categorie.');result[id]=category;}return result;}
export function costsReport(state={},mapping={},filters={},comparison=true){
 const from=filters.from||state.from||'',to=filters.to||state.to||'';
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to))throw Error('Kies een geldige periode.');
 const accounts=new Map((state.accounts||[]).map(a=>[a.id,a])),seen=new Set(),categories={},months={},suppliers={},lines=[];let total=0,unassigned=0,unassignedCount=0;
 for(const l of state.lines||[]){if(seen.has(l.id)||!accounts.has(l.glAccount)||!Number.isSafeInteger(l.cents)||(from&&l.date<from)||(to&&l.date>to))continue;seen.add(l.id);const category=mapping[l.glAccount];if(category==='ignore')continue;if(!Object.hasOwn(costCategories,category)){unassigned+=l.cents;unassignedCount++;continue;}total+=l.cents;categories[category]=(categories[category]||0)+l.cents;const month=l.date.slice(0,7);months[month]=(months[month]||0)+l.cents;const supplier=l.supplierId||'unknown';const group=suppliers[supplier]??={id:supplier,name:l.supplier||'Zonder leverancier',cents:0,count:0};group.cents+=l.cents;group.count++;lines.push({...l,category,accountCode:accounts.get(l.glAccount).code,accountName:accounts.get(l.glAccount).name});}
 let previous=null;
 if(comparison&&from&&to&&state.syncedAt){const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z'),span=end-start+86400000;if(Number.isFinite(span)&&span>0){const beforeFrom=new Date(start-span).toISOString().slice(0,10),beforeTo=new Date(start-86400000).toISOString().slice(0,10);if(beforeFrom>=state.from&&beforeTo<=state.to){const prior=costsReport(state,mapping,{from:beforeFrom,to:beforeTo},false);previous={from:beforeFrom,to:beforeTo,total:prior.total};}}}
 return {previous,ready:!!state.syncedAt,currency:state.currency||null,syncedAt:state.syncedAt||null,coverage:{from:state.from,to:state.to},partial:!!state.syncedAt&&((from&&from<state.from)||(to&&to>state.to)),from,to,total,unassigned,unassignedCount,categories:Object.entries(costCategories).map(([id,name])=>({id,name,cents:categories[id]||0})),months:Object.entries(months).sort().map(([month,cents])=>({month,cents})),suppliers:Object.values(suppliers).sort((a,b)=>b.cents-a.cents),lines:lines.sort((a,b)=>b.date.localeCompare(a.date)),accountCount:accounts.size,mappedCount:[...accounts.keys()].filter(id=>mapping[id]).length};
}

// Suggestions are a reviewable draft, never an automatic accounting decision.
export function suggestCostMapping(accounts=[]){
 const rules=[
  ['trainers',/\b(docent\w*|trainer\w*|royalt\w*|auteurs?recht\w*|sprekers?\w*|instructeurs?\w*)\b/,'Docenten, sprekers of auteursvergoedingen'],
  ['venues',/\b(catering|zaalhuur|cursuslocatie\w*|lesruimte\w*|congresruimte\w*|lunch\w*|cadaver\w*)\b/,'Cursuslocatie of catering'],
  ['travel',/\b(reis\w*|verblijf\w*|hotel\w*|vlieg\w*|vlucht\w*|kilometer\w*|parkeer\w*|taxi\w*|autokosten|brandstof\w*|leaseauto\w*)\b/,'Reizen, vervoer of verblijf'],
  ['equipment',/\b(apparatuur\w*|echosysteem\w*|echografieappar\w*|verbruiksmaterial\w*|lesmateriaal\w*|cursusmateriaal\w*|instrument\w*|inventaris\w*|onderhoudskosten apparatuur)\b/,'Apparatuur, inventaris of lesmateriaal'],
  ['marketing',/\b(marketing\w*|advertent\w*|reclame\w*|promotie\w*|sponsoring|beurskosten|google ads|facebook ads)\b/,'Marketing en promotie'],
  ['software',/\b(software\w*|hosting\w*|domein\w*|licentie\w*|eduframe|mailerlite|railway|saas|ict\w*|automatisering\w*|internetkosten)\b/,'Software, ICT of online platformen'],
  ['personnel',/\b(personeel\w*|loon\w*|salaris\w*|pensioen\w*|sociale lasten|management\w*|directie\w*|bestuurders?\w*)\b/,'Personeelskosten'],
  ['organization',/\b(accountant\w*|administratie\w*|boekhoud\w*|verzeker\w*|bankkosten|betalingsverkeer|kantoor\w*|telefoon\w*|telefonie|porto\w*|juridisch\w*|advieskosten|huisvesting\w*|energie\w*|schoonmaak\w*)\b/,'Algemene organisatiekosten']
 ];
 const suggestions={};for(const a of accounts){const text=String(a.name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(/\b(holding\w*|management\w*|huur(?:kosten)? (?:van )?(?:assets?|activa|apparatuur|inventaris))\b/.test(text)){suggestions[a.id]={category:'holding',reason:'Managementkosten of huur van assets / holding'};continue;}const matches=rules.filter(([,pattern])=>pattern.test(text));if(matches.length===1)suggestions[a.id]={category:matches[0][0],reason:matches[0][2]};}return suggestions;
}
