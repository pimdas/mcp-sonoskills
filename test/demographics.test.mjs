import test from 'node:test';
import assert from 'node:assert/strict';
import {demographics} from '../demographics.mjs';
import {fetchResource} from '../eduframe.mjs';
const fixture=()=>({
 categories:[{id:1,name:'Hands-on'},{id:2,name:'eLearning'},{id:3,name:'Live SonoClasses'},{id:4,name:'Producten'},{id:5,name:'Extern'}],
 courses:[{id:1,category_id:1},{id:2,category_id:2},{id:3,category_id:3},{id:4,category_id:4},{id:5,category_id:5}],
 planned_courses:[{id:10,course_id:1,type:'FixedPlannedCourse',start_date:'2027-01-15'},{id:11,course_id:1,type:'FixedPlannedCourse',start_date:'2027-02-15'},{id:20,course_id:2,type:'FlexiblePlannedCourse'},{id:30,course_id:3,type:'FixedPlannedCourse',start_date:'2027-03-01'},{id:31,course_id:3,type:'FlexiblePlannedCourse'},{id:40,course_id:4,type:'FlexiblePlannedCourse'},{id:50,course_id:5,type:'FixedPlannedCourse',start_date:'2027-04-01'}],
 users:[{id:1,address:{country:'DE'},custom:{job:'Fysiotherapeut',field:['Sport','Revalidatie','sport']}},{id:2,address:{country:'BE'},custom:{job:'Arts',field:'Sport'}},{id:3,custom:{}},{id:4,address:{country:'FR'},custom:{job:'Arts'}},{id:99,custom:{job:'Inkoper'}}],
 accounts:[{id:100,personal_user_id:1,address:{country:'NL'}},{id:200,address:{country:'GB'}},{id:300,address:{country:'US'}}],
 signup_questions:[{id:1,slug:'job',title:'Beroep',for_type:'user'},{id:2,slug:'field',title:'Professioneel domein',for_type:'user'}],
 orders:[{id:1,planned_course_id:10,status:'active',created_at:'2026-12-01',account_id:200},{id:2,planned_course_id:11,status:'active',created_at:'2027-01-01'},{id:3,planned_course_id:20,status:'active',created_at:'2027-02-01'},{id:4,planned_course_id:30,status:'active',created_at:'2026-12-01'},{id:5,planned_course_id:31,status:'active',created_at:'2027-03-01'},{id:6,planned_course_id:40,status:'active',created_at:'2027-03-01',account_id:200,creator_id:99,order_items:[{id:1,student_id:4}]},{id:7,planned_course_id:10,status:'canceled',created_at:'2027-01-01'},{id:8,planned_course_id:50,status:'active',created_at:'2027-01-01'}],
 enrollments:[{id:1,student_id:1,planned_course_id:10,order_id:1,status:'active'},{id:2,student_id:1,planned_course_id:11,order_id:2,status:'completed'},{id:3,student_id:1,planned_course_id:20,order_id:3,status:'active'},{id:4,student_id:2,planned_course_id:30,order_id:4,status:'confirmed'},{id:5,student_id:3,planned_course_id:31,order_id:5,status:'active'},{id:6,student_id:99,planned_course_id:10,order_id:7,status:'active'},{id:7,student_id:99,planned_course_id:50,order_id:8,status:'active'},{id:8,student_id:99,planned_course_id:10,order_id:1,status:'canceled'}]
});
const period={from:'2027-01-01',to:'2027-12-31'};
test('unique people and category counts follow course/booking periods and include product students, not purchaser',()=>{
 const r=demographics(fixture(),period);assert.equal(r.metrics.people,4);assert.deepEqual(r.categories.map(c=>[c.id,c.total]),[['handson',1],['elearning',1],['live',1],['ondemand',1],['products',1]]);assert.equal(r.breakdowns.profession.find(r=>r.label==='Inkoper'),undefined);assert.equal(r.breakdowns.domain.find(r=>r.label==='Sport').count,2);assert.equal(r.metrics.professionKnown,3);
 assert.equal(demographics(fixture(),{...period,productCategory:'elearning'}).metrics.people,1);
 assert.equal(demographics(fixture(),{from:'2026-01-01',to:'2026-12-31'}).metrics.people,0);
});
test('personal billing country wins, order billing and contact fallbacks are explicit, missing is unknown',()=>{
 const r=demographics(fixture(),period);assert.deepEqual(r.breakdowns.country.map(r=>r.label).sort(),['België','Nederland','Onbekend','Verenigd Koninkrijk'].sort());assert.equal(r.metrics.contactFallback,1);assert.equal(r.metrics.orderBilling,1);assert.equal(r.metrics.countryKnown,3);assert.equal(demographics(fixture(),{...period,country:'Nederland'}).metrics.people,1);
});
test('conflicting order billing countries do not assign a person arbitrarily',()=>{
 const d=fixture();d.accounts=d.accounts.filter(a=>a.id!==100);d.orders.find(o=>o.id===2).account_id=300;const r=demographics(d,period);assert.equal(r.breakdowns.country.find(r=>r.label==='Meerdere factuurlanden').count,1);assert.equal(r.metrics.countryKnown,2);
});
test('field mapping and unknown values remain usable when aliases differ',()=>{
 const d=fixture();d.signup_questions=[];const auto=demographics(d,period);assert.equal(auto.selectedFields.profession,'');assert.equal(auto.metrics.professionKnown,0);const r=demographics(d,{...period,professionField:'job',domainField:'field'});assert.equal(r.metrics.professionKnown,3);assert.equal(r.metrics.domainKnown,2);assert.equal(r.breakdowns.domain.find(r=>r.label==='Sport').count,2);assert.equal(demographics({},period).ready,false);
});
test('product catalog variants, canceled students, multi-edition ambiguity and booking date',()=>{
 const d=fixture();d.catalog_variants=[{id:100,variantable_type:'PlannedCourse',variantable_id:40}];d.orders.push({id:9,catalog_variant_id:100,status:'requested',created_at:'2027-04-01',order_items:[{id:9,student_id:3},{id:10,student_id:2}]});d.enrollments.push({id:9,order_id:9,student_id:2,planned_course_id:40,status:'canceled'});assert.equal(demographics(d,{...period,productCategory:'products'}).metrics.people,2);assert.equal(demographics(d,{from:'2027-04-01',to:'2027-04-30',productCategory:'products'}).metrics.people,1);
});
test('profile import only stores country, custom fields and linking IDs, and preserves product student IDs',async()=>{
 const fetcher=async()=>new Response(JSON.stringify([{id:1,email:'private@example.com',first_name:'Private',address:{country:'NL',address:'Private street',city:'Roermond'},custom:{profession:'Arts'}}]));
 const users=await fetchResource('users','token',fetcher,async()=>{});assert.deepEqual(users,[{id:1,address:{country:'NL'},custom:{profession:'Arts'}}]);
 const orders=await fetchResource('orders','token',async()=>new Response(JSON.stringify([{id:1,account_id:2,order_items:[{id:3,student_id:4,name:'Private'}]}])),async()=>{});assert.deepEqual(orders,[{account_id:2,id:1,order_items:[{id:3,student_id:4}]}]);
});
test('product orders without a student link are reported rather than assigned to a purchaser',()=>{
 const d=fixture();d.orders.push({id:10,planned_course_id:40,status:'active',created_at:'2027-03-01',creator_id:99,order_items:[{id:11}]});const r=demographics(d,period);assert.equal(r.unidentifiedProductOrders,1);assert.equal(r.metrics.people,4);assert.equal(demographics(d,{...period,productCategory:'handson'}).unidentifiedProductOrders,0);
 d.enrollments.push({id:20,order_id:10,student_id:4,planned_course_id:40,status:'active'});assert.equal(demographics(d,period).unidentifiedProductOrders,0);
});

test('a category filter uses billing countries from that category only',()=>{
 const d=fixture();d.accounts=d.accounts.filter(a=>a.id!==100);d.orders.find(o=>o.id===3).account_id=300;const r=demographics(d,{...period,productCategory:'elearning'});assert.equal(r.breakdowns.country[0].label,'Verenigde Staten');assert.equal(r.metrics.people,1);
});
