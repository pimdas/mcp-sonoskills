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
  assert.equal((await fetch(url+'/api/analytics')).status,401);
  const creds={email:'test@example.com',password:'test-password-long-enough'};
  assert.equal((await fetch(url+'/api/login',{method:'POST',body:JSON.stringify(creds)})).status,403);
  const login=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:JSON.stringify(creds)});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const result=await fetch(url+'/api/analytics',{headers:{cookie}});assert.equal(result.status,200);assert.equal((await result.json()).rows.length,0);
  assert.equal((await fetch(url+'/api/export',{headers:{cookie}})).status,200);
  const forged=cookie.slice(0,-1)+(cookie.endsWith('0')?'1':'0');assert.equal((await fetch(url+'/api/analytics',{headers:{cookie:forged}})).status,401);
  assert.equal((await fetch(url+'/api/sync',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:'{}'})).status,409);
  const logout=await fetch(url+'/api/logout',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Requested-With':'SonoSkills'},body:'{}'});assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
 }finally{child.kill('SIGTERM');await once(child,'exit');}
});
