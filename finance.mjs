import {orderIndex,sellingOrder} from './orders.mjs';
export function invoiceIndex(data){
 const orders=orderIndex(data),variants=new Map((data.catalog_variants||[]).map(v=>[v.id,v]));
 const editions=new Map((data.planned_courses||[]).map(e=>[e.id,e]));
 return (data.invoices||[]).map(invoice=>{
  const ids=new Set(orders.get(invoice.order_id)?.editionIds||[]);let unresolved=false;
  for(const item of invoice.invoice_items||[]){if(!item.catalog_variant_id)continue;const v=variants.get(item.catalog_variant_id);if(v&&['PlannedCourse','planned_course'].includes(v.variantable_type)&&editions.has(v.variantable_id))ids.add(v.variantable_id);else unresolved=true;}
  if([...ids].some(id=>!editions.has(id)))unresolved=true;
  return {invoice,editionIds:ids,unresolved};
 });
}
const amount=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100):null;};
export function financialOverview(data,{ids,external=false,externalIds=new Set(),booking=false,inPeriod=()=>true}={}){
 const totals={},warnings=[],unallocated=[],selected=[],auditInvoices=[];
 const audit=(link,counted,reason)=>{const i=link.invoice;auditInvoices.push({id:i.id,number:i.number||String(i.id),orderId:i.order_id??null,status:i.status,date:(i.opened_at||i.created_at||'').slice(0,10),currency:i.currency||'ONBEKEND',total:amount(i.total_incl??i.total_excl)===null?null:amount(i.total_incl??i.total_excl)/100,open:amount(i.total_open)===null?null:amount(i.total_open)/100,editionIds:[...link.editionIds],counted,reason,lines:(i.invoice_items||[]).map(l=>({id:l.id,variantId:l.catalog_variant_id??null,units:l.units??null,price:l.unit_price??null}))});};
 if(external)return {totals,warnings,unallocated,audit:{orders:[],invoices:[]}};
 const orders=new Map((data.orders||[]).map(o=>[o.id,o]));
 const seenInvoices=new Set();
 for(const link of invoiceIndex(data)){
  const i=link.invoice;if(seenInvoices.has(i.id))continue;seenInvoices.add(i.id);
  if([...link.editionIds].some(id=>externalIds.has(id)))continue;
  const selectedDate=orders.get(i.order_id)?.created_at||i.opened_at||i.created_at;
  const touches=[...link.editionIds].some(id=>ids.has(id));
  const complete=link.editionIds.size>0&&!link.unresolved&&[...link.editionIds].every(id=>ids.has(id));
  if(i.status==='concept'){if(touches)audit(link,false,'Conceptfactuur');continue;}
  if(!complete){
   const relevant=touches||(!link.editionIds.size&&inPeriod(i.opened_at||i.created_at||selectedDate));
   if(relevant){audit(link,false,!link.editionIds.size?'Geen herkenbare cursus-/editiekoppeling':link.unresolved?'Onvolledige cursus-/editiekoppeling':'Factuur bevat edities buiten de selectie');}
   if(relevant)unallocated.push({id:i.id,number:i.number||String(i.id),date:(i.opened_at||i.created_at||'').slice(0,10),currency:i.currency||'ONBEKEND',total:(amount(i.total_incl??i.total_excl)??0)/100,open:(amount(i.total_open)??0)/100,reason:!link.editionIds.size?'Geen herkenbare cursus-/editiekoppeling':link.unresolved?'Onvolledige cursus-/editiekoppeling':'Factuur bevat edities buiten de selectie'});
   continue;
  }
  if(booking&&!inPeriod(selectedDate)){if(touches)audit(link,false,'Boekingsdatum buiten de gekozen periode');continue;}
  const total=amount(i.total_incl??i.total_excl),open=amount(i.total_open);
  if(total===null||open===null){audit(link,false,'Ongeldig factuurbedrag');warnings.push(`Factuur ${i.number||i.id}: ongeldig bedrag; niet meegerekend.`);continue;}
  audit(link,true,'Meegeteld');selected.push(i);const t=totals[i.currency||'ONBEKEND']??={invoiced:0,open:0};t.invoiced+=total;t.open+=open;
 }
 for(const {order:o,editionIds} of orderIndex(data).values()){
  if(!sellingOrder(o)||editionIds.size!==1||![...editionIds].every(id=>ids.has(id)&&!externalIds.has(id))||(booking&&!inPeriod(o.created_at)))continue;
  const currency=o.currency||(data.planned_courses||[]).find(e=>e.id===[...editionIds][0])?.currency||'ONBEKEND';
  const t=totals[currency]??={invoiced:0,open:0};const value=amount(o.total_cost_incl??o.total_cost_excl);
  if(value===null){t.orderValue=null;warnings.push(`Order ${o.id}: orderbedrag ontbreekt of is ongeldig; orderwaarde is niet volledig beschikbaar.`);}
  else if(t.orderValue!==null)t.orderValue=(t.orderValue||0)+value;
 }
 for(const t of Object.values(totals)){t.invoiced/=100;t.open/=100;t.orderValue=t.orderValue===null?null:(t.orderValue||0)/100;}
 const indexes=orderIndex(data),editionMap=new Map((data.planned_courses||[]).map(e=>[e.id,e]));
 const auditOrders=[...indexes.values()].filter(l=>[...l.editionIds].some(id=>ids.has(id))&&(!booking||inPeriod(l.order.created_at))).map(l=>{const o=l.order,invoiceRows=auditInvoices.filter(i=>i.orderId===o.id);const currency=o.currency||editionMap.get([...l.editionIds][0])?.currency||invoiceRows[0]?.currency||'ONBEKEND';return {id:o.id,status:o.status,date:(o.created_at||'').slice(0,10),currency,total:amount(o.total_cost_incl??o.total_cost_excl)===null?null:amount(o.total_cost_incl??o.total_cost_excl)/100,places:o.number_of_students??null,editionIds:[...l.editionIds],invoiceNumbers:invoiceRows.map(i=>i.number)};});
 return {totals,warnings,unallocated,invoiceCount:selected.length,audit:{orders:auditOrders,invoices:auditInvoices}};
}

export function financeCsv(finance,filters={},syncedAt=''){
 const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const f=v=>typeof v==='number'?v.toFixed(2):'';
 const rows=[['Omzetcontrole SonoSkills'],['Synchronisatie',syncedAt],['Werkruimte',filters.workspace||'all'],['Cursus-ID',filters.course||'Alle'],['Vanaf',filters.from||''],['Tot en met',filters.to||''],[],['Valuta','Orderwaarde','Gefactureerd','Openstaand'],...Object.entries(finance.totals).map(([c,t])=>[c,f(t.orderValue),f(t.invoiced),f(t.open)]),[],['FACTUREN'],['Factuur-ID','Factuurnummer','Order-ID','Status','Factuurdatum','Valuta','Factuurbedrag','Openstaand','Editie-IDs','Telt mee','Reden'],...finance.audit.invoices.map(i=>[i.id,i.number,i.orderId,i.status,i.date,i.currency,f(i.total),f(i.open),i.editionIds.join(' / '),i.counted?'Ja':'Nee',i.reason]),[],['ORDERS TER CONTROLE (geen omzetberekening)'],['Order-ID','Status','Boekingsdatum','Valuta','Orderbedrag','Plaatsen','Editie-IDs','Factuurnummers'],...finance.audit.orders.map(o=>[o.id,o.status,o.date,o.currency,f(o.total),o.places,o.editionIds.join(' / '),o.invoiceNumbers.join(' / ')]),[],['FACTUURREGELREFERENTIES'],['Factuurnummer','Regel-ID','Catalogusvariant-ID','Aantal','Stuksprijs'],...finance.audit.invoices.flatMap(i=>i.lines.map(l=>[i.number,l.id,l.variantId,l.units,l.price]))];
 return '\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n');
}
