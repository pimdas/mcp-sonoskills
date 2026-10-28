import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('HTTP authentication, CSRF protection, logout, empty data and CSV',async()=>{
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'development',PORT:'3197',SQLITE_PATH:':memory:',DATABASE_URL:'',EDUFRAME_API_TOKEN:'',ADMIN_EMAIL:'test@example.com',ADMIN_PASSWORD:'test-password-long-enough',SESSION_SECRET:'12345678901234567890123456789012'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Startup timeout')),5000);t.unref();})]);
  const url='http://127.0.0.1:3197';
  assert.equal((await fetch(url+'/health')).status,200);
  for(const path of ['/marketing/google-ads','/demographics','/courses','/data-sources','/royalties','/online/elearning','/social','/marketing','/marketing/social-media','/marketing/nieuwsbrief','/marketing/reviews','/marketing/website']){const r=await fetch(url+path);assert.equal(r.status,200);assert.ok((await r.text()).includes('SonoSkills | Insights'));}
  assert.equal((await fetch(url+'/api/google-ads')).status,401);assert.equal((await fetch(url+'/api/google-ads/setup')).status,401);assert.equal((await fetch(url+'/api/demographics')).status,401);assert.equal((await fetch(url+'/api/analytics')).status,401);assert.equal((await fetch(url+'/api/social')).status,401);assert.equal((await fetch(url+'/api/marketing/reviews')).status,401);assert.equal((await fetch(url+'/api/newsletter')).status,401);assert.equal((await fetch(url+'/api/website')).status,401);assert.equal((await fetch(url+'/api/marketing/reviews/embed')).status,401);
  const creds={email:'test@example.com',password:'test-password-long-enough'};
  assert.equal((await fetch(url+'/api/login',{method:'POST',body:JSON.stringify(creds)})).status,403);
  const login=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:JSON.stringify(creds)});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const embed=await fetch(url+'/api/marketing/reviews/embed',{headers:{cookie}});assert.equal(embed.status,200);assert.equal(embed.headers.get('x-frame-options'),'SAMEORIGIN');assert.ok(embed.headers.get('content-security-policy').includes('https://elfsightcdn.com'));assert.ok((await embed.text()).includes('f4646092-c699-4ab4-9aa0-c0a27c889050'));const main=await fetch(url+'/marketing/reviews');assert.ok(!main.headers.get('content-security-policy').includes('elfsightcdn'));
  const result=await fetch(url+'/api/analytics',{headers:{cookie}});assert.equal(result.status,200);assert.equal((await result.json()).rows.length,0);
  const social=await fetch(url+'/api/social',{headers:{cookie}});assert.equal(social.status,200);const marketing=await social.json();assert.equal(marketing.accounts.length,3);assert.ok(marketing.newsletter);const website=await fetch(url+'/api/website',{headers:{cookie}});assert.equal(website.status,200);assert.equal((await website.json()).configured,false);const newsletter=await fetch(url+'/api/newsletter',{headers:{cookie}});assert.equal(newsletter.status,200);assert.ok(Array.isArray((await newsletter.json()).keyGroups));assert.equal((await fetch(url+'/api/marketing/reviews',{headers:{cookie}})).status,200);
  assert.equal((await fetch(url+'/api/export',{headers:{cookie}})).status,200);
  assert.equal((await fetch(url+'/api/finance-export')).status,401);const auditExport=await fetch(url+'/api/finance-export',{headers:{cookie}});assert.equal(auditExport.status,200);assert.ok((await auditExport.text()).includes('Omzetcontrole SonoSkills'));
  const demographicResponse=await fetch(url+'/api/demographics',{headers:{cookie}});assert.equal(demographicResponse.status,200);assert.equal((await demographicResponse.json()).metrics.people,0);assert.equal((await fetch(url+'/api/demographics?from=2027-12-01&to=2027-01-01',{headers:{cookie}})).status,400);
  const adsSetup=await fetch(url+'/api/google-ads/setup',{headers:{cookie}});assert.equal(adsSetup.status,200);assert.equal((await adsSetup.json()).customerId,'');
  const adsHeaders={cookie,'Content-Type':'application/json','X-Requested-With':'SonoSkills'};assert.equal((await fetch(url+'/api/google-ads/settings',{method:'POST',headers:adsHeaders,body:JSON.stringify({customerId:'wrong'})})).status,400);assert.equal((await fetch(url+'/api/google-ads/settings',{method:'POST',headers:adsHeaders,body:JSON.stringify({customerId:'123-456-7890'})})).status,200);assert.equal((await (await fetch(url+'/api/google-ads/setup',{headers:{cookie}})).json()).customerId,'1234567890');
  const forged=cookie.slice(0,-1)+(cookie.endsWith('0')?'1':'0');assert.equal((await fetch(url+'/api/analytics',{headers:{cookie:forged}})).status,401);
  assert.equal((await fetch(url+'/api/sync',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:'{}'})).status,409);
  assert.equal((await fetch(url+'/api/royalties/finalize',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:'{}'})).status,409);
  const logout=await fetch(url+'/api/logout',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:'{}'});assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
 }finally{child.kill('SIGTERM');await once(child,'exit');}
});
test('royalty routes persist agreements, enforce payment readiness and preserve settled amounts',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'royalties-')),path=join(dir,'test.sqlite');
 const {database}=await import('../db.mjs');process.env.SQLITE_PATH=path;
 const db=await database();await db.put({syncedAt:'2026-02-01T12:00:00Z',paymentState:{ready:true,scope:'1',syncedAt:'2026-02-01T12:00:00Z'},data:{categories:[{id:1,name:'eLearning'}],courses:[{id:1,name:'eLearning',category_id:1}],planned_courses:[{id:10,course_id:1,type:'FlexiblePlannedCourse'}],orders:[{id:1,planned_course_id:10}],invoices:[{id:1,order_id:1,number:'TEST',status:'paid',currency:'EUR'}],payments:[{id:1,invoice_id:1,amount:'100.00',currency:'EUR',status:'paid',date:'2026-01-15'}]}});await db.close();
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'development',PORT:'3198',SQLITE_PATH:path,DATABASE_URL:'',EDUFRAME_API_TOKEN:'',ADMIN_EMAIL:'test@example.com',ADMIN_PASSWORD:'test-password-long-enough',SESSION_SECRET:'12345678901234567890123456789012'},stdio:['ignore','pipe','pipe']});
 try{
  await once(child.stdout,'data');const url='http://127.0.0.1:3198';
  const base={'Content-Type':'application/json','X-Requested-With':'SonoSkills'};
  assert.equal((await fetch(url+'/api/royalties')).status,401);
  const login=await fetch(url+'/api/login',{method:'POST',headers:base,body:JSON.stringify({email:'test@example.com',password:'test-password-long-enough'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const post=(path,data)=>fetch(url+path,{method:'POST',headers:{...base,cookie},body:JSON.stringify(data)});
  assert.equal((await post('/api/royalties/agreement',{courseId:1,recipient:'Partner',percentage:'101',from:'2026-01-01'})).status,400);
  const saved=await post('/api/royalties/agreement',{courseId:1,recipient:'Partner',percentage:'10',from:'2026-01-01'});assert.equal(saved.status,200);const a=await saved.json();
  const query=await fetch(url+'/api/royalties?from=2026-01-01&to=2026-01-31',{headers:{cookie}});assert.equal((await query.json()).rows[0].dueCents,1000);
  const input={from:'2026-01-01',to:'2026-01-31',partyId:a.partyId};const finalized=await post('/api/royalties/finalize',input);assert.equal(finalized.status,200);const s=await finalized.json();
  assert.equal((await post('/api/royalties/finalize',input)).status,400);
  const exported=await fetch(url+'/api/royalties/settlement-export?id='+s.id,{headers:{cookie}});assert.equal(exported.status,200);assert.ok((await exported.text()).includes('10.00'));
  assert.equal((await post('/api/royalties/paid',{id:s.id,date:'2026-02-05',reference:'bank'})).status,200);
  assert.equal((await post('/api/royalties/agreement/remove',{id:a.id})).status,400);
 }finally{child.kill('SIGTERM');await once(child,'exit');await rm(dir,{recursive:true,force:true});}
});
