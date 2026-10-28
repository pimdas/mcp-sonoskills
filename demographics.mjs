import {workspaceIndex,definitions,normalize} from './workspaces.mjs';
import {orderIndex,sellingOrder} from './orders.mjs';
export const demographicResources=['users','accounts','signup_questions'];
const categoryIds=['handson','elearning','live','ondemand','products'];
const aliases={profession:['beroep','profession','occupation','jobtitle','yourprofession','what is your profession','your occupation'],domain:['clinical-domain','clinical domain','professioneel domein','professional domain','professional field','werkveld','vakgebied','specialisme','specialty','speciality']};
const clean=v=>typeof v==='string'?v.trim().replace(/\s+/g,' '):'';
const values=v=>{const seen=new Set();return (Array.isArray(v)?v:[v]).map(x=>clean(typeof x==='object'&&x?x.value??x.label:x)).filter(x=>{const key=normalize(x);if(!key||seen.has(key))return false;seen.add(key);return true;});};
const regionNames=new Intl.DisplayNames(['nl'],{type:'region'});
function country(raw){const c=clean(raw);if(!c)return '';if(/^[a-z]{2}$/i.test(c)){try{return regionNames.of(c.toUpperCase());}catch{}}return c;}
export function demographics(data,filters={},config={}){
 const index=workspaceIndex(data,config),courses=new Map((data.courses||[]).map(x=>[x.id,x])),editions=new Map((data.planned_courses||[]).map(x=>[x.id,x])),users=new Map((data.users||[]).map(x=>[x.id,x])),accounts=new Map((data.accounts||[]).map(x=>[x.id,x])),personal=new Map((data.accounts||[]).filter(x=>x.personal_user_id).map(x=>[x.personal_user_id,x]));
 const questions=(data.signup_questions||[]).filter(q=>!q.for_type||q.for_type==='user');
 const keys=new Set([...questions.map(q=>q.slug).filter(Boolean),...(data.users||[]).flatMap(u=>Object.keys(u.custom||{}))]);
 const fields=[...keys].map(slug=>({slug,title:questions.find(q=>q.slug===slug)?.title||slug})).sort((a,b)=>a.title.localeCompare(b.title,'nl'));
 const selectedFields=Object.fromEntries(Object.entries(aliases).map(([kind,list])=>[kind,filters[kind+'Field']&&keys.has(filters[kind+'Field'])?filters[kind+'Field']:fields.find(f=>list.some(a=>[f.slug,f.title].some(s=>normalize(s)===normalize(a))))?.slug||'']));
 const inPeriod=date=>(!filters.from||!!date&&date.slice(0,10)>=filters.from)&&(!filters.to||!!date&&date.slice(0,10)<=filters.to);
 let unidentifiedProductOrders=0;
 const canceledByOrder=new Map();for(const e of data.enrollments||[])if(!['active','confirmed','completed'].includes(e.status)){const ids=canceledByOrder.get(e.order_id)||new Set();ids.add(e.student_id);canceledByOrder.set(e.order_id,ids);}
 const people=new Map(),orders=new Map((data.orders||[]).map(o=>[o.id,o])),linked=orderIndex(data);
 const activeEnrollments=(data.enrollments||[]).filter(e=>['active','confirmed','completed'].includes(e.status)),enrolledOrderIds=new Set(activeEnrollments.filter(e=>e.student_id!=null).map(e=>e.order_id));
 function add(studentId,editionId,order,date){
  if(studentId==null)return;const edition=editions.get(editionId);if(!edition||edition.status==='canceled')return;
  const category=index.classifyEdition(edition,courses.get(edition.course_id));if(!categoryIds.includes(category)||(filters.productCategory&&category!==filters.productCategory))return;
  if(!inPeriod(['handson','live'].includes(category)?edition.start_date:order?.created_at||date))return;
  const p=people.get(studentId)||{id:studentId,categories:new Set(),billingCountries:new Set()};p.categories.add(category);
  const billing=country(accounts.get(order?.account_id)?.address?.country);if(billing)p.billingCountries.add(billing);people.set(studentId,p);
 }
 for(const e of activeEnrollments){const order=orders.get(e.order_id);if(order&&!sellingOrder(order))continue;add(e.student_id,e.planned_course_id,order,e.created_at);}
 // Products may have order items without course enrollments. Never attribute the purchaser as a participant.
 for(const {order,editionIds} of linked.values())if(sellingOrder(order)&&editionIds.size===1){const id=[...editionIds][0];const edition=editions.get(id);if(index.classifyEdition(edition||{},courses.get(edition?.course_id))!=='products')continue;if(inPeriod(order.created_at)&&!enrolledOrderIds.has(order.id)&&!order.order_items?.some(item=>item.student_id!=null))unidentifiedProductOrders++;const canceled=canceledByOrder.get(order.id)||new Set();for(const item of order.order_items||[])if(!canceled.has(item.student_id))add(item.student_id,id,order);}
 const rows=[...people.values()].map(p=>{const u=users.get(p.id)||{},own=country(u.invoice_address?.country)||country(personal.get(p.id)?.address?.country);let label=own,source=own?'personalBilling':'';
  if(!label&&p.billingCountries.size){label=p.billingCountries.size===1?[...p.billingCountries][0]:'Meerdere factuurlanden';source='orderBilling';}
  if(!label){label=country(u.address?.country);if(label)source='contact';}
  return {...p,country:label||'Onbekend',countrySource:source,profession:values(u.custom?.[selectedFields.profession]),domain:values(u.custom?.[selectedFields.domain])};});
 const countries=[...new Set(rows.map(p=>p.country))].sort((a,b)=>a.localeCompare(b,'nl'));
 const selected=rows.filter(p=>(!filters.productCategory||p.categories.has(filters.productCategory))&&(!filters.country||p.country===filters.country));
 function breakdown(list,key){const counts=new Map();for(const p of list){const labels=key==='country'?[p.country]:p[key].length?p[key]:['Onbekend'];for(const label of labels){const k=normalize(label),v=counts.get(k)||{label,count:0};v.count++;counts.set(k,v);}}return [...counts.values()].map(r=>({...r,percentage:list.length?Math.round(r.count/list.length*1000)/10:0})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'nl'));}
 const coverage=key=>selected.filter(p=>key==='country'?p.country!=='Onbekend'&&p.country!=='Meerdere factuurlanden':p[key].length).length;
 const categories=categoryIds.map(id=>{const list=selected.filter(p=>p.categories.has(id));return {id,name:definitions.find(d=>d.id===id).name,total:list.length,countries:breakdown(list,'country')};});
 return {unidentifiedProductOrders:!filters.productCategory||filters.productCategory==='products'?unidentifiedProductOrders:0,ready:Array.isArray(data.users),fields,selectedFields,countries,categories,metrics:{people:selected.length,countries:new Set(selected.filter(p=>!['Onbekend','Meerdere factuurlanden'].includes(p.country)).map(p=>p.country)).size,countryKnown:coverage('country'),professionKnown:coverage('profession'),domainKnown:coverage('domain'),contactFallback:selected.filter(p=>p.countrySource==='contact').length,orderBilling:selected.filter(p=>p.countrySource==='orderBilling').length},breakdowns:Object.fromEntries(['country','profession','domain'].map(k=>[k,breakdown(selected,k)]))};
}
