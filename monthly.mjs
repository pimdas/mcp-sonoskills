import {invoiceIndex} from './finance.mjs';
import {workspaceIndex} from './workspaces.mjs';
export function monthlyRevenue(data,filters={},config={}){
 const index=workspaceIndex(data,config),courses=new Map((data.courses||[]).map(c=>[c.id,c])),editions=new Map((data.planned_courses||[]).map(e=>[e.id,e])),orders=new Map((data.orders||[]).map(o=>[o.id,o]));
 const rows={},seen=new Set();let unallocated=0;
 const inside=date=>(!filters.from||date>=filters.from)&&(!filters.to||date<=filters.to);
 for(const link of invoiceIndex(data)){
  const i=link.invoice;if(seen.has(i.id)||i.status==='concept')continue;seen.add(i.id);
  const targets=[...link.editionIds].map(id=>{const e=editions.get(id);if(!e)return null;const workspace=index.classifyEdition(e,courses.get(e.course_id));const date=(e.type==='FixedPlannedCourse'?e.start_date:orders.get(i.order_id)?.created_at||i.opened_at||i.created_at||'')?.slice(0,10)||'';return {workspace,date,month:date.slice(0,7)};});
  if(targets.some(t=>t?.workspace==='external'))continue;
  if(targets.length&&targets.every(t=>t&&t.date&&!inside(t.date)))continue;
  const total=i.total_incl??i.total_excl,cents=Math.round(Number(total)*100);
  if(link.unresolved||!targets.length||targets.some(t=>!t||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!inside(t.date))||new Set(targets.map(t=>t.workspace+':'+t.month)).size!==1||total==null||total===''||!Number.isSafeInteger(cents)){unallocated++;continue;}
  const {workspace,month}=targets[0],currency=i.currency||'ONBEKEND';const months=rows[currency]??={},values=months[month]??={};values[workspace]=(values[workspace]||0)+cents;
 }
 for(const months of Object.values(rows))for(const values of Object.values(months))for(const w of Object.keys(values))values[w]/=100;
 const months=[];let first=filters.from?.slice(0,7),last=filters.to?.slice(0,7);const used=Object.values(rows).flatMap(m=>Object.keys(m)).sort();first||=used[0];last||=used.at(-1);if(first&&last){let cursor=first;while(cursor<=last&&months.length<1200){months.push(cursor);const [y,m]=cursor.split('-').map(Number);cursor=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');}}
 return {rows,months,unallocated};
}
