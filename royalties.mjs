import {randomUUID} from 'node:crypto';
export class InputError extends Error {}
const fail=message=>{throw new InputError(message);};
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===value;}
export function cents(value){const s=String(value??'');if(!/^-?\d+(\.\d{1,2})?$/.test(s))return null;const negative=s.startsWith('-');const [whole,dec='']=s.replace('-','').split('.');const n=Number(whole)*100+Number(dec.padEnd(2,'0'));return Number.isSafeInteger(n)?(negative?-n:n):null;}
export const round=n=>Math.sign(n)*Math.round(Math.abs(n)/10000);
const range=(date,from,to)=>(!from||date>=from)&&(!to||date<=to);
export function emptyState(){return {parties:[],agreements:[],settlements:[]};}
export function templateOptions(data){const ids=new Set((data.planned_courses||[]).filter(e=>e.type==='FlexiblePlannedCourse').map(e=>e.course_id));return (data.courses||[]).filter(c=>ids.has(c.id)).map(c=>({id:c.id,name:c.name||c.title||`Template ${c.id}`})).sort((a,b)=>a.name.localeCompare(b.name));}
// Only a uniquely linked template is eligible; never split a bundle by participant count.
export function invoiceTargets(data){
 const editions=new Map((data.planned_courses||[]).map(e=>[e.id,e]));
 const byOrder=new Map();for(const e of data.enrollments||[]){if(!byOrder.has(e.order_id))byOrder.set(e.order_id,new Set());byOrder.get(e.order_id).add(e.planned_course_id);}
 const orders=new Map((data.orders||[]).map(o=>[o.id,o]));
 return (data.invoices||[]).map(invoice=>{
  const order=orders.get(invoice.order_id),ids=new Set(byOrder.get(invoice.order_id)||[]);
  if(order?.planned_course_id)ids.add(order.planned_course_id);
  const linked=[...ids].map(id=>editions.get(id)).filter(Boolean),templates=new Set(linked.map(e=>e.course_id));
  return {invoice,courseId:templates.size===1?[...templates][0]:null,editionIds:[...ids],courseIds:[...templates],ambiguous:templates.size!==1||linked.length!==ids.size};
 });
}
export function saveAgreement(state,input,data){
 const id=input.id||randomUUID(),old=state.agreements.find(a=>a.id===id);
 if(input.id&&!old)fail('Afspraak niet gevonden.');
 const courseId=Number(input.courseId);if(!templateOptions(data).some(t=>t.id===courseId))fail('Kies een eLearning-template met flexibele edities.');
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
export function report(data,state,filters={}){
 const from=filters.from||'',to=filters.to||'';
 if((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to))fail('Kies een geldige periode.');
 const courses=new Map((data.courses||[]).map(c=>[c.id,c.name||c.title||`Template ${c.id}`]));
 const parties=new Map(state.parties.map(p=>[p.id,p.name]));
 const targets=invoiceTargets(data),targetMap=new Map(targets.map(t=>[t.invoice.id,t]));
 const warnings=[],desired=new Map(),seen=new Set();
 const matches=l=>(!filters.courseId||String(l.courseId)===String(filters.courseId))&&(!filters.partyId||l.partyId===filters.partyId)&&range(l.date,from,to);
 const eligible=new Set(templateOptions(data).map(c=>c.id));
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
   desired.set(key,{key,paymentId:p.id,invoiceId:p.invoice_id,invoiceNumber:target.invoice.number||String(p.invoice_id),editionIds:target.editionIds,courseId:a.courseId,template:courses.get(a.courseId),partyId:a.partyId,recipient:parties.get(a.partyId),agreementId:a.id,bps:a.bps,date,currency:p.currency,baseCents:amount,numerator});
  }
 }
 const settled=new Map();
 for(const s of state.settlements)for(const l of s.lines){const prev=settled.get(l.key);settled.set(l.key,{...l,baseCents:(prev?.baseCents||0)+l.baseCents,numerator:(prev?.numerator||0)+l.numerator});}
 for(const prior of settled.values()){
  const target=targetMap.get(prior.invoiceId);
  if(!target||target.ambiguous||!eligible.has(prior.courseId)||target.courseId!==prior.courseId)warnings.push(`Eerder afgerekende betaling #${prior.paymentId}: templatekoppeling is gewijzigd of ontbreekt. Controleer deze voordat je correcties vaststelt.`);
 }
 const keys=new Set([...desired.keys(),...settled.keys()]),lines=[];
 for(const key of keys){const current=desired.get(key),prior=settled.get(key),source=current||prior;if(!matches(source))continue;
  const numerator=(current?.numerator||0)-(prior?.numerator||0),baseCents=(current?.baseCents||0)-(prior?.baseCents||0);
  lines.push({...source,baseCents,numerator,currentBase:current?.baseCents||0,currentNumerator:current?.numerator||0,settledNumerator:prior?.numerator||0,adjustment:!!prior&&(numerator!==0||baseCents!==0)});
 }
 const groups=new Map();for(const l of lines){const key=`${l.courseId}:${l.partyId}:${l.currency}`;if(!groups.has(key))groups.set(key,{courseId:l.courseId,template:l.template,partyId:l.partyId,recipient:l.recipient,currency:l.currency,baseCents:0,numerator:0,currentBase:0,currentNumerator:0,settledNumerator:0,rates:[],lines:[]});const g=groups.get(key);for(const k of ['baseCents','numerator','currentBase','currentNumerator','settledNumerator']){g[k]+=l[k];if(!Number.isSafeInteger(g[k]))fail('Het totaal is te groot voor een veilige automatische berekening.');}if(!g.rates.includes(l.bps/100))g.rates.push(l.bps/100);g.lines.push(l);}
 const rows=[...groups.values()].map(g=>({...g,dueCents:round(g.numerator),royaltyCents:round(g.currentNumerator),settledCents:round(g.settledNumerator)})).sort((a,b)=>a.recipient.localeCompare(b.recipient)||a.template.localeCompare(b.template));
 return {rows,excludedInvoices:targets.filter(t=>t.ambiguous).length,warnings:[...new Set(warnings)],pending:lines.filter(l=>l.numerator!==0||l.baseCents!==0),templates:templateOptions(data),parties:state.parties,agreements:state.agreements.map(a=>({...a,template:courses.get(a.courseId)||`Template ${a.courseId}`,recipient:parties.get(a.partyId),locked:state.settlements.some(s=>s.lines.some(l=>l.agreementId===a.id))})),settlements:state.settlements.filter(s=>(!filters.partyId||s.partyId===filters.partyId)&&(!from||s.to>=from)&&(!to||s.from<=to))};
}
export function finalize(data,state,input,syncedAt){
 if(!validDate(input.from)||!validDate(input.to)||input.from>input.to)fail('Kies een begin- en einddatum voor de afrekening.');
 if(!state.parties.some(p=>p.id===input.partyId))fail('Kies één ontvanger voor de afrekening.');
 const r=report(data,state,{from:input.from,to:input.to,partyId:input.partyId});
 if(r.warnings.length)fail('Los eerst de gemelde toerekeningsproblemen op.');
 if(!r.pending.length)fail('Er zijn geen nieuwe royaltybedragen of correcties om vast te stellen.');
 const s={id:randomUUID(),partyId:input.partyId,recipient:state.parties.find(p=>p.id===input.partyId).name,from:input.from,to:input.to,status:'finalized',createdAt:new Date().toISOString(),syncedAt,lines:r.pending.map(({currentBase,currentNumerator,settledNumerator,...l})=>l),totals:r.rows.filter(g=>g.lines.some(l=>l.numerator!==0||l.baseCents!==0)).map(g=>({courseId:g.courseId,template:g.template,currency:g.currency,baseCents:g.baseCents,amountCents:g.dueCents}))};
 state.settlements.push(s);return s;
}
export function markPaid(state,id,date,reference){if(!validDate(date))fail('Vul een geldige betaaldatum in.');const s=state.settlements.find(s=>s.id===id);if(!s)fail('Afrekening niet gevonden.');if(s.status!=='finalized')fail('Deze afrekening is al als betaald gemarkeerd.');if(String(reference||'').length>200)fail('Referentie is te lang.');s.status='paid';s.paidAt=date;s.reference=String(reference||'').trim();return s;}
export function royaltyCsv(rows){const q=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\ufeff'+rows.map(row=>row.map(q).join(';')).join('\r\n');}
export function reportCsv(r){return royaltyCsv([['Template','Ontvanger','Valuta','Ontvangen','Royalty totaal','Al vastgesteld','Nog af te rekenen'],...r.rows.map(g=>[g.template,g.recipient,g.currency,(g.currentBase/100).toFixed(2),(g.royaltyCents/100).toFixed(2),(g.settledCents/100).toFixed(2),(g.dueCents/100).toFixed(2)])]);}
export function settlementCsv(s){return royaltyCsv([['Afrekening','Ontvanger','Van','Tot','Status','Template','Valuta','Ontvangen / correctie','Royalty'],...s.totals.map(t=>[s.id,s.recipient,s.from,s.to,s.status,t.template,t.currency,(t.baseCents/100).toFixed(2),(t.amountCents/100).toFixed(2)]),[],['Betaling-ID','Factuur','Template','Betaaldatum Eduframe','Valuta','Ontvangen / correctie','Percentage','Royalty (ongerond)'],...s.lines.map(l=>[l.paymentId,l.invoiceNumber,l.template,l.date,l.currency,(l.baseCents/100).toFixed(2),l.bps/100,(l.numerator/1000000).toFixed(6)])]);}
