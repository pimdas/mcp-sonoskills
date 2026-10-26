export function analyze(data, filters={}) {
  const courses=new Map((data.courses||[]).map(x=>[x.id,x]));
  const locations=new Map((data.course_locations||[]).map(x=>[x.id,x.name]));
  const all=data.planned_courses||[];
  const editions=all.filter(x=>(!filters.from || x.start_date>=filters.from) && (!filters.to || x.start_date?.slice(0,10)<=filters.to) && (!filters.course || String(x.course_id)===filters.course) && (!filters.location || String(x.course_location_id)===filters.location));
  const ids=new Set(editions.map(x=>x.id));
  const enrollments=(data.enrollments||[]).filter(e=>ids.has(e.planned_course_id));
  const active=enrollments.filter(e=>['active','completed'].includes(e.status));
  const orderIds=new Set(enrollments.map(e=>e.order_id));
  const orders=(data.orders||[]).filter(o=>ids.has(o.planned_course_id)||orderIds.has(o.id));
  const filteredOrderIds=new Set(orders.map(o=>o.id));
  const invoices=(data.invoices||[]).filter(i=>filteredOrderIds.has(i.order_id)&&i.status!=='concept');
  const totals={};
  for(const i of invoices) {
    const currency=i.currency||'ONBEKEND';
    const t=totals[currency]??={invoiced:0,open:0};
    t.invoiced+=Math.round(Number(i.total_excl||0)*100);
    t.open+=Math.round(Number(i.total_open||0)*100);
  }
  for(const t of Object.values(totals)){t.invoiced/=100;t.open/=100;}
  const history=new Map();
  for(const e of data.enrollments||[]) if(['active','completed'].includes(e.status)) {
    const set=history.get(e.student_id)||new Set();set.add(e.planned_course_id);history.set(e.student_id,set);
  }
  const students=new Set(active.map(x=>x.student_id).filter(x=>x!=null));
  const rows=editions.map(e=> {
    const participants=active.filter(a=>a.planned_course_id===e.id).length;
    return {id:e.id,name:courses.get(e.course_id)?.name||courses.get(e.course_id)?.title||`Cursus ${e.course_id}`,location:locations.get(e.course_location_id)||'Onbekend',start:e.start_date||'',status:e.status,participants,capacity:e.max_participants||null,occupancy:e.max_participants?Math.round(participants/e.max_participants*100):null};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  const usable=rows.filter(r=>r.capacity && r.status!=='canceled');
  const capacity=usable.reduce((s,r)=>s+r.capacity,0);
  const months={};
  for(const e of active) { // Booking time comes from the order, not the course start date.
    const o=(data.orders||[]).find(o=>o.id===e.order_id);
    const month=(o?.created_at||e.created_at)?.slice(0,7);
    if(month) months[month]=(months[month]||0)+1;
  }
  return {rows,totals,months,metrics:{editions:rows.length,enrollments:active.length,cancelled:enrollments.filter(e=>e.status==='canceled').length,students:students.size,returning:[...students].filter(id=>history.get(id)?.size>1).length,occupancy:capacity?Math.round(usable.reduce((s,r)=>s+r.participants,0)/capacity*100):null},options:{courses:[...courses.values()].map(c=>({id:c.id,name:c.name||c.title||String(c.id)})),locations:[...locations].map(([id,name])=>({id,name}))}};
}
export function csv(rows) {
  const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return '\ufeff'+[['Cursus','Locatie','Startdatum','Status','Deelnemers','Capaciteit','Bezetting (%)'],...rows.map(r=>[r.name,r.location,r.start,r.status,r.participants,r.capacity,r.occupancy])].map(r=>r.map(quote).join(';')).join('\r\n');
}
