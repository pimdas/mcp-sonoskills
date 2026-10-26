export const sellingOrder=o=>['active','requested'].includes(o.status);
export function orderPlaces(order){
 const n=order.number_of_students;
 if(n!==null&&n!==undefined&&Number.isInteger(Number(n))&&Number(n)>=0)return Number(n);
 if(Array.isArray(order.order_items)&&order.order_items.length)return order.order_items.length;
 return null;
}
export function orderIndex(data){
 const variants=new Map((data.catalog_variants||[]).map(v=>[v.id,v]));
 const enrolled=new Map();for(const e of data.enrollments||[]){if(!enrolled.has(e.order_id))enrolled.set(e.order_id,new Set());enrolled.get(e.order_id).add(e.planned_course_id);}
 return new Map((data.orders||[]).map(o=>{
  const ids=new Set(enrolled.get(o.id)||[]);if(o.planned_course_id)ids.add(o.planned_course_id);
  const v=variants.get(o.catalog_variant_id);if(v&&['planned_course','PlannedCourse'].includes(v.variantable_type))ids.add(v.variantable_id);
  return [o.id,{order:o,editionIds:ids}];
 }));
}
