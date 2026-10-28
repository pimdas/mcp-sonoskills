import {invoiceIndex} from './finance.mjs';
import {workspaceIndex} from './workspaces.mjs';
import {randomUUID} from 'node:crypto';
export class InputError extends Error {}
const fail=message=>{throw new InputError(message);};
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===value;}
export function cents(value){const s=String(value??'');if(!/^-?\d+(\.\d{1,2})?$/.test(s))return null;const negative=s.startsWith('-');const [whole,dec='']=s.replace('-','').split('.');const n=Number(whole)*100+Number(dec.padEnd(2,'0'));return Number.isSafeInteger(n)?(negative?-n:n):null;}
export const round=n=>Math.sign(n)*Math.round(Math.abs(n)/10000);
const range=(date,from,to)=>(!from||date>=from)&&(!to||date<=to);
export function emptyState(){return {parties:[],agreements:[],settlements:[],manualRevenue:[]};}
export function templateOptions(data,config={}){const index=workspaceIndex(data,config);return (data.courses||[]).filter(c=>index.classify(c)==='elearning').map(c=>({id:c.id,name:c.name||c.title||`Template ${c.id}`})).sort((a,b)=>a.name.localeCompare(b.name));}
// Only a uniquely linked template is eligible; never split a bundle by participant count.
export function invoiceTargets(data){
 const editions=new Map((data.planned_courses||[]).map(e=>[e.id,e]));
 return invoiceIndex(data).map(({invoice,editionIds,unresolved})=>{
  const ids=[...editionIds],templates=new Set(ids.map(id=>editions.get(id)?.course_id).filter(id=>id!=null));
  return {invoice,courseId:templates.size===1&&!unresolved?[...templates][0]:null,editionIds:ids,courseIds:[...templates],ambiguous:unresolved||templates.size!==1};
 });
}

export const manualLocked=(state,id)=>state.settlements.some(s=>s.lines.some(l=>l.manualId===id));
export function historicalPaymentOverlap(data,entry,targetIndex){const targets=targetIndex||new Map(invoiceTargets(data).map(t=>[t.invoice.id,t]));return (data.payments||[]).some(p=>p.status==='paid'&&p.currency===entry.currency&&typeof p.date==='string'&&p.date.slice(0,10)>=entry.from&&p.date.slice(0,10)<=entry.to&&targets.get(p.invoice_id)?.invoice.status!=='concept'&&targets.get(p.invoice_id)?.courseIds.includes(entry.courseId));}

export function saveAgreement(state,input,data,config={}){
 const id=input.id||randomUUID(),old=state.agreements.find(a=>a.id===id);
 if(input.id&&!old)fail('Afspraak niet gevonden.');
 const courseId=Number(input.courseId);if(!templateOptions(data,config).some(t=>t.id===courseId))fail('Kies een template in de categorie eLearning.');
 const name=String(input.recipient||'').trim();if(!name||name.length>160)fail('Vul een ontvanger in (maximaal 160 tekens).');
 const pct=String(input.percentage??'').replace(',','.');if(!/^\d{1,3}(\.\d{1,2})?$/.test(pct))fail('Vul een percentage in met maximaal twee decimalen.');
 const bps=Math.round(Number(pct)*100);if(bps<=0||bps>10000)fail('Het percentage moet groter zijn dan 0 en maximaal 100.');
 const from=input.from,to=input.to||null;if(!validDate(from)||(to&&!validDate(to))||(to&&to<from))fail('Vul een geldige ingangsdatum en eventuele einddatum in.');
 let party=state.parties.find(p=>p.name.toLocaleLowerCase('nl')===name.toLocaleLowerCase('nl'));
 if(!party)party={id:randomUUID(),name};
 const frozen=old&&state.settlements.some(s=>s.lines.some(l=>l.agreementId===old.id));
 if(frozen){
  if(old.courseId!==courseId||old.partyId!==party.id||old.bps!==bps||old.from!==from)fail('Deze afspraak is al gebruikt in een afrekening. Alleen de einddatum kan nog worden aangepast.');
  if(to&&state.settlements.some(s=>s.lines.some(l=>l.agreementId===old.id&&l.date>to)))fail('De einddatum mag geen reeds afgerekende betalingen uitsluiten.');
 }
 if(state.agreements.some(a=>a.id!==id&&a.courseId===courseId&&a.partyId===party.id&&a.from<=(to||'9999-12-31')&&from<=(a.to||'9999-12-31')))fail('Er bestaat al een overlappende afspraak voor deze ontvanger en dit template.');
 if(!state.parties.some(p=>p.id===party.id))state.parties.push(party);
 const a={id,courseId,partyId:party.id,bps,from,to,createdAt:old?.createdAt||new Date().toISOString()};
 state.agreements=state.agreements.filter(a=>a.id!==id);state.agreements.push(a);return a;
}
export function removeAgreement(state,id){if(state.settlements.some(s=>s.lines.some(l=>l.agreementId===id)))fail('Deze afspraak is al gebruikt. Sluit de afspraak af met een einddatum.');if(!state.agreements.some(a=>a.id===id))fail('Afspraak niet gevonden.');state.agreements=state.agreements.filter(a=>a.id!==id);}
export function report(data,state,filters={},config={}){
 const from=filters.from||'',to=filters.to||'';
 if((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to))fail('Kies een geldige periode.');
 const courses=new Map((data.courses||[]).map(c=>[c.id,c.name||c.title||`Template ${c.id}`]));
 const parties=new Map(state.parties.map(p=>[p.id,p.name]));
 const targets=invoiceTargets(data),targetMap=new Map(targets.map(t=>[t.invoice.id,t]));
 const warnings=[],desired=new Map(),seen=new Set();
 const contains=(start,end)=>(!from||start>=from)&&(!to||end<=to);
 const overlaps=(start,end)=>(!from||end>=from)&&(!to||start<=to);
 const matches=l=>(!filters.courseId||String(l.courseId)===String(filters.courseId))&&(!filters.partyId||l.partyId===filters.partyId)&&(l.source==='manual'?contains(l.periodFrom,l.periodTo):range(l.date,from,to));
 const eligible=new Set(templateOptions(data,config).map(c=>c.id));
 for(const t of targets){if(t.ambiguous&&t.courseIds.some(id=>eligible.has(id)&&state.agreements.some(a=>a.courseId===id)))warnings.push(`Factuur ${t.invoice.number||t.invoice.id}: order bevat meerdere templates of een onbekende editie; niet automatisch toegerekend.`);}
 for(const p of data.payments||[]){
  if(seen.has(p.id))continue;seen.add(p.id);
  if(p.status!=='paid')continue;
  const target=targetMap.get(p.invoice_id);if(!target||target.ambiguous||target.invoice.status==='concept'||!eligible.has(target.courseId))continue;
  const agreements=state.agreements.filter(a=>a.courseId===target.courseId);if(!agreements.length)continue;
  const amount=cents(p.amount),date=typeof p.date==='string'?p.date.slice(0,10):'';
  if(amount==null||!validDate(date)||!p.currency||p.currency!==target.invoice.currency){warnings.push(`Betaling #${p.id}: controleer bedrag, datum of valuta; niet meegerekend.`);continue;}
  for(const a of agreements){if(!range(date,a.from,a.to))continue;
   const key=`${p.id}:${a.courseId}:${a.partyId}:${p.currency}:${date}`;
   const numerator=amount*a.bps;if(!Number.isSafeInteger(numerator)){warnings.push(`Betaling #${p.id}: bedrag te groot voor automatische berekening.`);continue;}
   desired.set(key,{key,source:'eduframe',sourceName:'Eduframe',paymentId:p.id,invoiceId:p.invoice_id,invoiceNumber:target.invoice.number||String(p.invoice_id),editionIds:target.editionIds,courseId:a.courseId,template:courses.get(a.courseId),partyId:a.partyId,recipient:parties.get(a.partyId),agreementId:a.id,bps:a.bps,date,currency:p.currency,baseCents:amount,numerator});
  }
 }
 const manualEntries=(state.manualRevenue||[]).filter(e=>!e.voidedAt);
 for(const entry of manualEntries){
  const relevantCourse=!filters.courseId||String(entry.courseId)===String(filters.courseId),agreements=state.agreements.filter(a=>a.courseId===entry.courseId),priorLines=state.settlements.flatMap(s=>s.lines.filter(l=>l.manualId===entry.id));
  const relevantParty=!filters.partyId||agreements.some(a=>a.partyId===filters.partyId)||priorLines.some(l=>l.partyId===filters.partyId),relevant=relevantCourse&&relevantParty&&overlaps(entry.from,entry.to);
  const label=`Handmatige omzet ${entry.reference} (${entry.from} t/m ${entry.to})`;
  if(!eligible.has(entry.courseId)){if(relevant)warnings.push(`${label}: de cursus staat niet meer in eLearning. Controleer de indeling.`);continue;}
  if(relevant&&!contains(entry.from,entry.to))warnings.push(`${label}: de selectie bevat slechts een deel van deze omzetperiode. Kies de volledige periode of splits de invoer in afzonderlijke maanden.`);
  const root=entry.correctsId?manualEntries.find(e=>e.id===entry.correctsId):entry;
  const rootNet=root?manualEntries.filter(e=>e.id===root.id||e.correctsId===root.id).reduce((sum,e)=>sum+e.amountCents,0):0;
  if(relevant&&entry.sourceType==='historical'&&!entry.correctsId&&rootNet!==0&&historicalPaymentOverlap(data,entry,targetMap))warnings.push(`${label}: er staan inmiddels ook Eduframe-betalingen in deze historische periode. Controleer dubbele omzet en corrigeer of splits de handmatige invoer.`);
  const partyIds=new Set(agreements.map(a=>a.partyId));
  if(relevant&&!partyIds.size)warnings.push(`${label}: er is nog geen royaltyafspraak voor deze cursus.`);
  for(const partyId of partyIds){
   const a=agreements.find(a=>a.partyId===partyId&&a.from<=entry.from&&(!a.to||a.to>=entry.to));
   if(!a){if(relevant&&(!filters.partyId||filters.partyId===partyId))warnings.push(`${label}: geen ongewijzigde royaltyafspraak voor ${parties.get(partyId)} over de volledige periode. Splits de invoer bij een tariefwijziging of voeg een afspraak voor het ontbrekende tijdvak toe.`);continue;}
   const numerator=entry.amountCents*a.bps;if(!Number.isSafeInteger(numerator))fail('Handmatige omzet is te groot voor een veilige royaltyberekening.');
   const key=`manual:${entry.id}:${entry.courseId}:${partyId}:${entry.currency}`;
   desired.set(key,{key,source:'manual',sourceType:entry.sourceType,sourceName:entry.sourceName,manualId:entry.id,correctsId:entry.correctsId||null,reference:entry.reference,periodFrom:entry.from,periodTo:entry.to,paymentId:null,invoiceId:null,invoiceNumber:entry.reference,editionIds:[],courseId:entry.courseId,template:courses.get(entry.courseId),partyId,recipient:parties.get(partyId),agreementId:a.id,bps:a.bps,date:entry.to,currency:entry.currency,baseCents:entry.amountCents,numerator});
  }
 }
 const settled=new Map();
 for(const s of state.settlements)for(const l of s.lines){const prev=settled.get(l.key);settled.set(l.key,{...l,baseCents:(prev?.baseCents||0)+l.baseCents,numerator:(prev?.numerator||0)+l.numerator});}
 for(const prior of settled.values()){
  if(prior.source==='manual'){if(!eligible.has(prior.courseId)||!manualEntries.some(e=>e.id===prior.manualId))warnings.push(`Eerder afgerekende handmatige omzet ${prior.reference||prior.manualId}: boeking of eLearning-koppeling ontbreekt. Controleer deze voordat je correcties vaststelt.`);continue;}
  const target=targetMap.get(prior.invoiceId);
  if(!target||target.ambiguous||!eligible.has(prior.courseId)||target.courseId!==prior.courseId)warnings.push(`Eerder afgerekende betaling #${prior.paymentId}: templatekoppeling is gewijzigd of ontbreekt. Controleer deze voordat je correcties vaststelt.`);
 }
 const keys=new Set([...desired.keys(),...settled.keys()]),lines=[];
 for(const key of keys){const current=desired.get(key),prior=settled.get(key),source=current||prior;if(!matches(source))continue;
  const numerator=(current?.numerator||0)-(prior?.numerator||0),baseCents=(current?.baseCents||0)-(prior?.baseCents||0);
  lines.push({...source,baseCents,numerator,currentBase:current?.baseCents||0,currentNumerator:current?.numerator||0,settledNumerator:prior?.numerator||0,adjustment:!!prior&&(numerator!==0||baseCents!==0)});
 }
 const groups=new Map();for(const l of lines){const key=`${l.courseId}:${l.partyId}:${l.currency}`;if(!groups.has(key))groups.set(key,{courseId:l.courseId,template:l.template,partyId:l.partyId,recipient:l.recipient,currency:l.currency,baseCents:0,numerator:0,currentBase:0,currentNumerator:0,settledNumerator:0,rates:[],lines:[],eduframeBase:0,manualBase:0});const g=groups.get(key);for(const k of ['baseCents','numerator','currentBase','currentNumerator','settledNumerator']){g[k]+=l[k];if(!Number.isSafeInteger(g[k]))fail('Het totaal is te groot voor een veilige automatische berekening.');}g[l.source==='manual'?'manualBase':'eduframeBase']+=l.currentBase;if(!Number.isSafeInteger(g.manualBase)||!Number.isSafeInteger(g.eduframeBase))fail('De grondslag is te groot voor een veilige berekening.');if(!g.rates.includes(l.bps/100))g.rates.push(l.bps/100);g.lines.push(l);}
 const rows=[...groups.values()].map(g=>({...g,dueCents:round(g.numerator),royaltyCents:round(g.currentNumerator),settledCents:round(g.settledNumerator)})).sort((a,b)=>a.recipient.localeCompare(b.recipient)||a.template.localeCompare(b.template));
 return {manualRevenue:manualEntries.filter(e=>(!filters.courseId||String(e.courseId)===String(filters.courseId))&&overlaps(e.from,e.to)).map(e=>{const {history,...entry}=e;return {...entry,template:courses.get(e.courseId)||`Template ${e.courseId}`,locked:manualLocked(state,e.id)};}).sort((a,b)=>b.from.localeCompare(a.from)||a.reference.localeCompare(b.reference)),rows,excludedInvoices:targets.filter(t=>t.ambiguous).length,warnings:[...new Set(warnings)],pending:lines.filter(l=>l.numerator!==0||l.baseCents!==0),templates:templateOptions(data,config),parties:state.parties,agreements:state.agreements.map(a=>({...a,template:courses.get(a.courseId)||`Template ${a.courseId}`,recipient:parties.get(a.partyId),locked:state.settlements.some(s=>s.lines.some(l=>l.agreementId===a.id))})),settlements:state.settlements.filter(s=>(!filters.partyId||s.partyId===filters.partyId)&&(!from||s.to>=from)&&(!to||s.from<=to))};
}
export function finalize(data,state,input,syncedAt,config={}){
 if(!validDate(input.from)||!validDate(input.to)||input.from>input.to)fail('Kies een begin- en einddatum voor de afrekening.');
 if(!state.parties.some(p=>p.id===input.partyId))fail('Kies één ontvanger voor de afrekening.');
 const r=report(data,state,{from:input.from,to:input.to,partyId:input.partyId},config);
 if(r.warnings.length)fail('Los eerst de gemelde toerekeningsproblemen op.');
 if(!r.pending.length)fail('Er zijn geen nieuwe royaltybedragen of correcties om vast te stellen.');
 const s={id:randomUUID(),partyId:input.partyId,recipient:state.parties.find(p=>p.id===input.partyId).name,from:input.from,to:input.to,status:'finalized',createdAt:new Date().toISOString(),syncedAt,lines:r.pending.map(({currentBase,currentNumerator,settledNumerator,...l})=>l),totals:r.rows.filter(g=>g.lines.some(l=>l.numerator!==0||l.baseCents!==0)).map(g=>({courseId:g.courseId,template:g.template,currency:g.currency,baseCents:g.baseCents,amountCents:g.dueCents}))};
 state.settlements.push(s);return s;
}
export function markPaid(state,id,date,reference){if(!validDate(date))fail('Vul een geldige betaaldatum in.');const s=state.settlements.find(s=>s.id===id);if(!s)fail('Afrekening niet gevonden.');if(s.status!=='finalized')fail('Deze afrekening is al als betaald gemarkeerd.');if(String(reference||'').length>200)fail('Referentie is te lang.');s.status='paid';s.paidAt=date;s.reference=String(reference||'').trim();return s;}
export function royaltyCsv(rows){const q=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\ufeff'+rows.map(row=>row.map(q).join(';')).join('\r\n');}
export function reportCsv(r){return royaltyCsv([['Template','Ontvanger','Valuta','Eduframe','Handmatig','Royaltygrondslag','Royalty totaal','Al vastgesteld','Nog af te rekenen'],...r.rows.map(g=>[g.template,g.recipient,g.currency,(g.eduframeBase/100).toFixed(2),(g.manualBase/100).toFixed(2),(g.currentBase/100).toFixed(2),(g.royaltyCents/100).toFixed(2),(g.settledCents/100).toFixed(2),(g.dueCents/100).toFixed(2)])]);}
export function settlementCsv(s){return royaltyCsv([['Afrekening','Ontvanger','Van','Tot','Status','Template','Valuta','Ontvangen / correctie','Royalty'],...s.totals.map(t=>[s.id,s.recipient,s.from,s.to,s.status,t.template,t.currency,(t.baseCents/100).toFixed(2),(t.amountCents/100).toFixed(2)]),[],['Bron','Betaling-ID / handmatige boeking','Referentie / factuur','Template','Datum','Omzetperiode vanaf','Omzetperiode tot','Valuta','Grondslag / correctie','Percentage','Royalty (ongerond)'],...s.lines.map(l=>[l.sourceName||'Eduframe',l.manualId||l.paymentId,l.reference||l.invoiceNumber,l.template,l.date,l.periodFrom||'',l.periodTo||'',l.currency,(l.baseCents/100).toFixed(2),l.bps/100,(l.numerator/1000000).toFixed(6)])]);}
