import {orderIndex} from './orders.mjs';
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
 const totals={},warnings=[],unallocated=[],selected=[];
 if(external)return {totals,warnings,unallocated};
 const orders=new Map((data.orders||[]).map(o=>[o.id,o]));
 const seenInvoices=new Set();
 for(const link of invoiceIndex(data)){
  const i=link.invoice;if(seenInvoices.has(i.id)||i.status==='concept')continue;seenInvoices.add(i.id);
  if([...link.editionIds].some(id=>externalIds.has(id)))continue;
  const selectedDate=orders.get(i.order_id)?.created_at||i.opened_at||i.created_at;
  const touches=[...link.editionIds].some(id=>ids.has(id));
  const complete=link.editionIds.size>0&&!link.unresolved&&[...link.editionIds].every(id=>ids.has(id));
  if(!complete){
   if((touches||!link.editionIds.size)&&inPeriod(i.opened_at||i.created_at||selectedDate))unallocated.push({id:i.id,number:i.number||String(i.id),date:(i.opened_at||i.created_at||'').slice(0,10),currency:i.currency||'ONBEKEND',total:(amount(i.total_incl??i.total_excl)??0)/100,open:(amount(i.total_open)??0)/100,reason:!link.editionIds.size?'Geen herkenbare cursus-/editiekoppeling':link.unresolved?'Onvolledige cursus-/editiekoppeling':'Factuur bevat edities buiten de selectie'});
   continue;
  }
  if(booking&&!inPeriod(selectedDate))continue;
  const total=amount(i.total_incl??i.total_excl),open=amount(i.total_open);
  if(total===null||open===null){warnings.push(`Factuur ${i.number||i.id}: ongeldig bedrag; niet meegerekend.`);continue;}
  selected.push(i);const t=totals[i.currency||'ONBEKEND']??={invoiced:0,open:0};t.invoiced+=total;t.open+=open;
 }
 for(const t of Object.values(totals)){t.invoiced/=100;t.open/=100;}
 return {totals,warnings,unallocated,invoiceCount:selected.length};
}
