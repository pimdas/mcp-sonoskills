import {orderIndex,orderPlaces,sellingOrder} from './orders.mjs';
import {workspaceIndex,workspaceInfo} from './workspaces.mjs';
export function analyze(data, filters={}, config={}) {
  const index=workspaceIndex(data,config);
  const courses=new Map((data.courses||[]).map(x=>[x.id,x]));
  const variants=new Map((data.course_variants||[]).map(v=>[v.id,v.name]));
  const locations=new Map((data.course_locations||[]).map(x=>[x.id,x.name]));
  const categories=new Map((data.categories||[]).map(c=>[c.id,c]));
  function categoryPath(id) {
    const names=[],seen=new Set();
    while(categories.has(id) && !seen.has(id)) {seen.add(id);const c=categories.get(id);names.unshift(c.name);id=c.parent_id;}
    return names.join(' / ')||'Zonder categorie';
  }
  function inCategory(id) {
    if(!filters.category)return true;
    if(filters.category==='none')return !categories.has(id);
    const seen=new Set();
    while(id!=null && !seen.has(id)){if(String(id)===filters.category)return true;seen.add(id);id=categories.get(id)?.parent_id;}
    return false;
  }
  const requested=({fixed:'handson',flexible:'elearning'})[filters.workspace]||filters.workspace;
  const workspace=workspaceInfo(requested)||requested==='other'?requested:'all';
  const booking=workspaceInfo(workspace)?.basis==='booking';
  const external=workspace==='external';
  const all=data.planned_courses||[];
  const kind=e=>e.type==='FixedPlannedCourse'?'fixed':e.type==='FlexiblePlannedCourse'?'flexible':'unknown';
  const inPeriod=date=>(!filters.from || (date && date.slice(0,10)>=filters.from)) && (!filters.to || (date && date.slice(0,10)<=filters.to));
  const matchingCourses=[...courses.values()].filter(c=>workspace==='all'?index.classify(c)!=='external':index.classify(c)===workspace);
  const matchingIds=new Set(matchingCourses.map(c=>c.id));
  const workspaceEditions=all.filter(e=>matchingIds.has(e.course_id));
  const editions=workspaceEditions.filter(x=>(booking||inPeriod(x.start_date)) && (!filters.course || String(x.course_id)===filters.course) && (!filters.location || String(x.course_location_id)===filters.location) && inCategory(courses.get(x.course_id)?.category_id));
  const allOrders=new Map((data.orders||[]).map(o=>[o.id,o]));
  const linked=orderIndex(data);
  const allEditionMap=new Map(all.map(e=>[e.id,e]));
  const ids=new Set(editions.map(x=>x.id));
  const enrollments=(data.enrollments||[]).filter(e=>ids.has(e.planned_course_id) && (!booking||inPeriod(allOrders.get(e.order_id)?.created_at||e.created_at)));
  const active=enrollments.filter(e=>['confirmed','active','completed'].includes(e.status));
  const linkedOrders=[...linked.values()].filter(link=>link.editionIds.size===1&&ids.has([...link.editionIds][0])&&(!booking||inPeriod(link.order.created_at))).map(link=>link.order);
  const orders=linkedOrders.filter(sellingOrder);
  const filteredOrderIds=new Set(linkedOrders.map(o=>o.id));
  const externalEditionIds=new Set(all.filter(e=>index.classify(courses.get(e.course_id))==='external').map(e=>e.id));
  const externalOrderIds=new Set([...linked.values()].filter(link=>[...link.editionIds].some(id=>externalEditionIds.has(id))).map(link=>link.order.id));
  const orderSummary=list=>({orders:list.length,requestedOrders:list.filter(o=>o.status==='requested').length,bookedPlaces:list.reduce((s,o)=>s+(orderPlaces(o)??0),0),unknownPlaces:list.filter(o=>orderPlaces(o)===null).length});
  const sales=orderSummary(orders);
  const orderWarnings=[];
  const ambiguous=[...linked.values()].filter(link=>sellingOrder(link.order)&&link.editionIds.size>1&&[...link.editionIds].some(id=>ids.has(id))&&(!booking||inPeriod(link.order.created_at)));
  if(ambiguous.length)orderWarnings.push(`${ambiguous.length} orders verwijzen naar meerdere edities en zijn niet automatisch toegerekend.`);
  const unmapped=[...linked.values()].filter(link=>sellingOrder(link.order)&&(link.editionIds.size===0||[...link.editionIds].some(id=>!allEditionMap.has(id))));
  if(unmapped.length)orderWarnings.push(`${unmapped.length} orders in de import hebben nog geen herkenbare editie. Synchroniseer om de cataloguskoppelingen bij te werken.`);
  if(sales.unknownPlaces)orderWarnings.push(`Bij ${sales.unknownPlaces} orders ontbreekt het aantal plaatsen. Deze orders tellen mee; hun bezetting is nog onbekend.`);
  const invoices=(external?[]:(data.invoices||[])).filter(i=>filteredOrderIds.has(i.order_id)&&!externalOrderIds.has(i.order_id)&&i.status!=='concept');
  const totals={};
  for(const i of invoices) {
    const currency=i.currency||'ONBEKEND';
    const t=totals[currency]??={invoiced:0,open:0,orderValue:0};
    t.invoiced+=Math.round(Number(i.total_excl||0)*100);
    t.open+=Math.round(Number(i.total_open||0)*100);
  }
  if(!external)for(const o of orders){
    const edition=allEditionMap.get([...linked.get(o.id).editionIds][0]);
    const invoiceCurrencies=[...new Set(invoices.filter(i=>i.order_id===o.id).map(i=>i.currency).filter(Boolean))];
    const currency=o.currency||edition?.currency||(invoiceCurrencies.length===1?invoiceCurrencies[0]:'ONBEKEND');
    const amount=o.total_cost_incl??o.total_cost_excl;
    if(amount==null||!Number.isFinite(Number(amount)))continue;
    const t=totals[currency]??={invoiced:0,open:0,orderValue:0};t.orderValue+=Math.round(Number(amount)*100);
  }
  for(const t of Object.values(totals)){t.invoiced/=100;t.open/=100;t.orderValue/=100;}
  const history=new Map();
  for(const e of data.enrollments||[]) if(['confirmed','active','completed'].includes(e.status)) {
    const set=history.get(e.student_id)||new Set();set.add(e.planned_course_id);history.set(e.student_id,set);
  }
  const students=new Set(active.map(x=>x.student_id).filter(x=>x!=null));
  const rows=editions.map(e=> {
    const participants=active.filter(a=>a.planned_course_id===e.id).length;
    const sale=orderSummary(orders.filter(o=>linked.get(o.id).editionIds.has(e.id)));
    return {id:e.id,...sale,workspace:index.classify(courses.get(e.course_id)),end:e.end_date||'',variantId:e.course_variant_id??null,variant:variants.get(e.course_variant_id)||(e.course_variant_id?`Variant #${e.course_variant_id}`:'—'),courseId:e.course_id,code:courses.get(e.course_id)?.code||'',categoryId:courses.get(e.course_id)?.category_id??null,category:categoryPath(courses.get(e.course_id)?.category_id),type:kind(e),name:courses.get(e.course_id)?.name||courses.get(e.course_id)?.title||`Cursus ${e.course_id}`,location:locations.get(e.course_location_id)||'Onbekend',start:e.start_date||'',status:e.status,confirmed:participants>0&&e.status!=='canceled',participants,capacity:e.max_participants||null,occupancy:kind(e)!=='flexible' && e.max_participants&&!sale.unknownPlaces?Math.round(sale.bookedPlaces/e.max_participants*100):null};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  const usable=rows.filter(r=>r.capacity && r.type!=='flexible' && r.status!=='canceled');
  const capacity=usable.reduce((s,r)=>s+r.capacity,0);
  const months={};
  for(const o of orders){const month=o.created_at?.slice(0,7);if(month)months[month]=(months[month]||0)+1;}
  const emptyTemplates=matchingCourses.filter(c=>!workspaceEditions.some(e=>e.course_id===c.id)&&(!filters.course||String(c.id)===filters.course)&&inCategory(c.category_id));
  const sort=['name','sales_desc','sales_asc','upcoming'].includes(filters.sort)?filters.sort:'name';
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function dateKey(row){
    const date=row.type!=='flexible'&&/^\d{4}-\d{2}-\d{2}/.test(row.start||'')?row.start.slice(0,10):'';
    return {bucket:row.status==='canceled'?3:!date?2:date>=today?0:1,date};
  }
  function byDate(a,b){const x=dateKey(a),y=dateKey(b);return x.bucket-y.bucket||(x.bucket===1?y.date.localeCompare(x.date):x.date.localeCompare(y.date))||a.id-b.id;}
  const byName=(a,b)=>a.name.localeCompare(b.name,'nl',{sensitivity:'base',numeric:true})||a.id-b.id;
  const compare=(a,b)=>sort==='sales_desc'?b.orders-a.orders||byName(a,b):sort==='sales_asc'?a.orders-b.orders||byName(a,b):sort==='upcoming'?byDate(a,b):byName(a,b);
  rows.sort(compare);
  const templateIds=new Set([...rows.map(r=>r.courseId),...emptyTemplates.map(c=>c.id)]);
  const templates=[...templateIds].map(id=>{
    const editions=rows.filter(r=>r.courseId===id),c=courses.get(id),first=editions[0]||{name:c.name||c.title||`Template ${id}`,code:c.code||'',category:index.path(c.category_id),categoryId:c.category_id};
    const known=editions.filter(e=>e.type!=='flexible' && e.capacity && e.status!=='canceled');
    const capacity=known.reduce((s,e)=>s+e.capacity,0);
    const sale=orderSummary(orders.filter(o=>editions.some(e=>linked.get(o.id).editionIds.has(e.id))));
    return {id,...sale,workspace:index.classify(c),name:first.name,code:first.code,category:first.category,categoryId:first.categoryId,editions,participants:editions.reduce((s,e)=>s+e.participants,0),occupancy:capacity&&!known.some(e=>e.unknownPlaces)?Math.round(known.reduce((s,e)=>s+e.bookedPlaces,0)/capacity*100):null};
  });
  const firstEdition=t=>[...t.editions].sort(byDate)[0]||{id:t.id,start:'',type:'unknown'};
  templates.sort((a,b)=>sort==='upcoming'?byDate(firstEdition(a),firstEdition(b))||byName(a,b):compare(a,b));
  rows.splice(0,rows.length,...templates.flatMap(t=>t.editions));
  const availableCourses=matchingCourses.filter(c=>inCategory(c.category_id));
  const availableLocations=new Set(workspaceEditions.map(e=>e.course_location_id));
  const relevantCategoryIds=new Set(matchingCourses.flatMap(c=>index.ancestry(c.category_id).map(c=>c.id)));
  const unassigned=[...courses.values()].filter(c=>index.classify(c)==='other').length;
  return {workspace,sort,orderWarnings,periodBasis:booking?'booking':'course',financeEnabled:!external,unassigned,workspaceMapping:index.definitions,unknownTypes:workspaceEditions.filter(e=>kind(e)==='unknown').length,rows,templates,totals,months,metrics:{...sales,confirmedEditions:rows.filter(r=>r.confirmed).length,templates:templates.length,editions:rows.length,enrollments:active.length,cancelled:enrollments.filter(e=>e.status==='canceled').length,students:students.size,returning:[...students].filter(id=>history.get(id)?.size>1).length,occupancy:capacity&&!usable.some(r=>r.unknownPlaces)?Math.round(usable.reduce((s,r)=>s+r.bookedPlaces,0)/capacity*100):null},options:{courses:availableCourses.map(c=>({id:c.id,name:c.name||c.title||String(c.id)})),categories:[...categories.values()].filter(c=>relevantCategoryIds.has(c.id)).map(c=>({id:c.id,name:categoryPath(c.id)})).sort((a,b)=>a.name.localeCompare(b.name)),locations:[...locations].filter(([id])=>availableLocations.has(id)).map(([id,name])=>({id,name}))}};
}
export function csv(rows) {
  const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return '\ufeff'+[['Categorie','Template','Template-ID','Editie-ID','Variant','Type','Locatie','Startdatum','Einddatum','Status','Cursus bevestigd','Orders','Aangevraagde orders','Geboekte plaatsen','Bevestigde inschrijvingen','Capaciteit','Bezetting (%)'],...rows.map(r=>[r.category,r.name,r.courseId,r.id,r.variant,r.type,r.location,r.start,r.end,r.status,r.confirmed?'Ja':'Nog niet',r.orders,r.requestedOrders,r.unknownPlaces?null:r.bookedPlaces,r.participants,r.capacity,r.occupancy])].map(r=>r.map(quote).join(';')).join('\r\n');
}
