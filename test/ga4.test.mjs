import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {ga4Period,websiteReport} from '../ga4.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const config={property:'389925522',json:JSON.stringify({type:'service_account',client_email:'test@sonoskills.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'}),private_key_id:'test-key'})};
test('GA4 clips a running period and compares exactly as many days, including leap dates',()=>{
 const p=ga4Period({from:'2026-10-01',to:'2026-12-31'},'2026-10-27');assert.equal(p.to,'2026-10-26');assert.equal(p.days,26);assert.equal(p.previousFrom,'2026-09-05');assert.equal(p.previousTo,'2026-09-30');
 assert.equal(ga4Period({from:'2024-02-28',to:'2024-03-01'},'2026-10-27').days,3);
 assert.equal(ga4Period({from:'2027-01-01',to:'2027-02-01'},'2026-10-27').empty,true);
 assert.throws(()=>ga4Period({from:'2026-02-30',to:'2026-03-01'}),/geldige/);assert.throws(()=>ga4Period({from:'2020-01-01',to:'2026-01-01'}),/drie jaar/);
});
test('GA4 signs a read-only assertion and retrieves exact period totals rather than summing unique users',async()=>{
 const calls=[];const r=await websiteReport({from:'2026-09-01',to:'2026-09-30'},config,async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');
  if(url==='https://oauth2.googleapis.com/token'){const jwt=new URLSearchParams(options.body).get('assertion'),[header,payload,sig]=jwt.split('.'),claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.scope,'https://www.googleapis.com/auth/analytics.readonly');assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.ok(!claims.sub);assert.equal(claims.exp-claims.iat,3600);assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(sig,'base64url')));return new Response(JSON.stringify({access_token:'secret-token',expires_in:3600}));}
  assert.equal(url,'https://analyticsdata.googleapis.com/v1beta/properties/389925522:runReport');assert.equal(options.headers.Authorization,'Bearer secret-token');const q=JSON.parse(options.body);assert.ok(!q.dimensions.some(d=>/userId|userEmail/i.test(d.name)));return new Response(JSON.stringify({rows:[{dimensionValues:q.dimensions.map(d=>({value:d.name==='date'?'20260901':d.name})),metricValues:q.metrics.map(()=>({value:'12'}))}],metadata:{timeZone:'Europe/Amsterdam',subjectToThresholding:true}}));
 });
 assert.equal(calls.length,7);assert.equal(r.totals.activeUsers,12);assert.equal(r.previous.sessions,12);assert.equal(r.pages.length,1);assert.equal(r.warnings.length,1);assert.ok(!JSON.stringify(r).includes('secret-token'));assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
});
test('GA4 missing configuration and failures never return raw Google errors or credentials',async()=>{
 assert.equal((await websiteReport({},{})).configured,false);
 assert.match((await websiteReport({}, {...config,json:'broken'})).error,/JSON/);
 const bad=await websiteReport({from:'2026-09-01',to:'2026-09-30'},config,async()=>new Response(JSON.stringify({error:'secret raw provider content'}),{status:403}));assert.match(bad.error,/weigert toegang/);assert.ok(!JSON.stringify(bad).includes('raw provider'));
 let calls=0;const empty=await websiteReport({from:'2030-01-01',to:'2030-02-01'},config,async()=>{calls++;});assert.equal(empty.empty,true);assert.equal(calls,0);
});
