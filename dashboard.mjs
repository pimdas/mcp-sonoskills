import {monthlyRevenue} from './monthly.mjs';
import {analyze} from './analytics.mjs';
import {financialOverview,invoiceIndex} from './finance.mjs';
import {workspaceIndex} from './workspaces.mjs';
export function dashboard(data,filters={},config={}){
 const groups=[['handson','Hands-on'],['elearning','eLearning'],['ondemand','On-demand'],['live','Live'],['products','Producten'],['external','Extern'],['other','Overige']];
 const workspaces=groups.map(([id,name])=>{const r=analyze(data,{workspace:id,from:filters.from,to:filters.to},config);return {id,name,courseIds:r.templates.map(t=>t.id),totals:r.totals,metrics:r.metrics,warnings:r.finance.warnings,unallocated:r.finance.unallocated.length};});
 const totals={};for(const w of workspaces.filter(w=>w.id!=='external'))for(const [currency,t] of Object.entries(w.totals)){const sum=totals[currency]??={invoiced:0,open:0,orderValue:0};for(const key of Object.keys(sum))sum[key]=sum[key]===null||t[key]===null?null:Math.round((sum[key]+t[key])*100)/100;}
 const index=workspaceIndex(data,config),courses=new Map((data.courses||[]).map(c=>[c.id,c]));
 const externalIds=new Set((data.planned_courses||[]).filter(e=>index.classify(courses.get(e.course_id))==='external').map(e=>e.id));
 const ids=new Set((data.planned_courses||[]).filter(e=>e.start_date?.slice(0,4)==='2027'&&!externalIds.has(e.id)).map(e=>e.id));
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cutoff=today<'2027-01-01'?today:'2026-12-31';
 const eligible=(data.invoices||[]).filter(i=>{const date=(i.opened_at||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(date)&&date<=cutoff;});
 const advance=financialOverview({...data,invoices:eligible},{ids,externalIds});
 const undated=invoiceIndex(data).filter(l=>l.invoice.status!=='concept'&&[...l.editionIds].some(id=>ids.has(id))&&!l.invoice.opened_at).length;
 return {workspaces,totals,monthly:monthlyRevenue(data,filters,config),advance2027:{totals:advance.totals,invoiceCount:advance.invoiceCount||0,cutoff,unallocated:advance.unallocated.filter(i=>advance.audit.invoices.find(a=>a.id===i.id)?.editionIds.some(id=>ids.has(id))).length,undated}};
}
