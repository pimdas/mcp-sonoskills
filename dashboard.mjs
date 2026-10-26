import {analyze} from './analytics.mjs';
export function dashboard(data,filters={},config={}){
 const groups=[['handson','Hands-on'],['elearning','eLearning'],['ondemand','On-demand'],['live','Live'],['products','Producten'],['external','Extern'],['other','Overige']];
 const workspaces=groups.map(([id,name])=>{const r=analyze(data,{workspace:id,from:filters.from,to:filters.to},config);return {id,name,totals:r.totals,metrics:r.metrics,warnings:r.finance.warnings,unallocated:r.finance.unallocated.length};});
 const totals={};for(const w of workspaces.filter(w=>w.id!=='external'))for(const [currency,t] of Object.entries(w.totals)){const sum=totals[currency]??={invoiced:0,open:0,orderValue:0};for(const key of Object.keys(sum))sum[key]=sum[key]===null||t[key]===null?null:Math.round((sum[key]+t[key])*100)/100;}
 return {workspaces,totals};
}
