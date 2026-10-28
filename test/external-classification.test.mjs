import test from 'node:test';import assert from 'node:assert/strict';
import {validateCustomerClassification,selectedInvoices} from '../exact.mjs';import {dashboard} from '../dashboard.mjs';
const invoice=(id,customerId,amount,currency='EUR')=>({id,customerId,customer:customerId,status:50,date:'2026-10-01',amount,currency});
test('customer classification accepts one workspace and multiple normalized labels; rejects unknown customers and categories',()=>{
 const c=validateCustomerClassification({customerWorkspaces:{a:'handson'},customerLabels:{a:[' Reseller ','reseller','Ziekenhuis']}},['a']);assert.deepEqual(c.customerLabels.a,['Reseller','Ziekenhuis']);assert.equal(c.customerWorkspaces.a,'handson');
 for(const input of [{customerWorkspaces:{b:'handson'}},{customerWorkspaces:{a:'fake'}},{customerLabels:{a:'Reseller'}},{customerLabels:{b:['x']}},{customerLabels:{a:['x'.repeat(81)]}},{customerLabels:{a:Array(21).fill('x')}}])assert.throws(()=>validateCustomerClassification(input,['a']));
});
test('mapped external invoices move to main category exactly once; credits, currencies, exclusions and monthly sources remain aligned',()=>{
 const state={selected:['a','b'],excluded:['skip'],customerWorkspaces:{a:'handson'},customerLabels:{a:['Reseller','Ziekenhuis']},invoices:[invoice('1','a',100),invoice('2','a',-20),invoice('3','b',50),invoice('4','a',25,'USD'),invoice('skip','a',999)]};state.invoices.push(state.invoices[0]);const before=structuredClone(state);
 const r=dashboard({}, {},{},selectedInvoices(state)),hands=r.workspaces.find(w=>w.id==='handson'),ext=r.workspaces.find(w=>w.id==='external');
 assert.equal(r.totals.EUR.invoiced,130);assert.equal(hands.totals.EUR.invoiced,80);assert.equal(hands.totals.EUR.orderValue,80);assert.equal(ext.totals.EUR.invoiced,50);assert.equal(hands.externalTotals.EUR.invoiced,80);assert.equal(hands.externalCustomers.length,1);assert.deepEqual(hands.externalCustomers[0].labels,['Reseller','Ziekenhuis']);assert.equal(hands.externalCustomers[0].totals.USD.invoiced,25);assert.deepEqual(hands.ownTotals,{});
 assert.equal(r.monthly.rows.EUR['2026-10'].handson,80);assert.equal(r.monthly.rows.EUR['2026-10'].external,50);assert.equal(r.monthly.rows.USD['2026-10'].handson,25);
 assert.equal(r.workspaces.reduce((sum,w)=>sum+(w.totals.EUR?.invoiced||0),0),r.totals.EUR.invoiced);assert.deepEqual(state,before);
});
test('legacy land categories do not infer new main category and labels never multiply turnover',()=>{
 const state={selected:['a'],customerCategories:{a:'land-nl'},invoices:[invoice('1','a',10)]};const r=dashboard({}, {},{},selectedInvoices(state));assert.equal(r.workspaces.find(w=>w.id==='external').totals.EUR.invoiced,10);assert.equal(r.totals.EUR.invoiced,10);
 state.customerWorkspaces={a:'elearning'};state.customerLabels={a:['one','two','three']};const moved=dashboard({}, {},{},selectedInvoices(state));assert.equal(moved.totals.EUR.invoiced,10);assert.equal(moved.workspaces.find(w=>w.id==='elearning').totals.EUR.invoiced,10);
});
test('own and external source layers conserve amounts without changing Eduframe course metrics',()=>{
 const data={categories:[{id:1,name:'Hands-on'}],courses:[{id:1,category_id:1}],planned_courses:[{id:1,course_id:1,start_date:'2026-10-01'}],orders:[{id:1,planned_course_id:1,status:'active',currency:'EUR',total_cost_incl:200}],invoices:[{id:1,order_id:1,status:'paid',currency:'EUR',total_incl:200,total_open:0}]};const base=dashboard(data),r=dashboard(data,{}, {},[{...invoice('ext','a',50),workspace:'handson',labels:[]}]),hands=r.workspaces.find(w=>w.id==='handson');assert.equal(hands.totals.EUR.invoiced,250);assert.equal(hands.ownTotals.EUR.invoiced,200);assert.equal(hands.externalTotals.EUR.invoiced,50);assert.equal(r.totals.EUR.invoiced,250);assert.deepEqual(hands.metrics,base.workspaces.find(w=>w.id==='handson').metrics);
});
