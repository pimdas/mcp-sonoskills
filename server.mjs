import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHmac,timingSafeEqual,scryptSync} from 'node:crypto';
import {database} from './db.mjs';
import {resources,fetchResource} from './eduframe.mjs';
import {analyze,csv} from './analytics.mjs';
const production=process.env.NODE_ENV==='production';
const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_PASSWORD;
const secret=process.env.SESSION_SECRET;
if(!email || !password || password.length<16 || !secret || secret.length<32) throw Error('Stel ADMIN_EMAIL, ADMIN_PASSWORD (min. 16 tekens) en SESSION_SECRET (min. 32 tekens) in.');
const salt=randomBytes(16), hash=scryptSync(password,salt,64);
const db=await database();
let snapshot=await db.get()||{data:{},syncedAt:null},syncing=false,syncError=null;
const attempts=new Map();
const sign=s=>createHmac('sha256',secret).update(s).digest('hex');
const equal=(a,b)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function session(req) {
  const raw=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('ss_session='))?.slice(11)||'';
  const [expires,nonce,signature]=raw.split('.');
  return expires && nonce && signature && Number(expires)>Date.now() && equal(sign(`${expires}.${nonce}`),signature);
}
async function body(req) {let s='';for await(const chunk of req){s+=chunk;if(s.length>4096)throw Error('Verzoek te groot');}return JSON.parse(s||'{}');}
async function sync() {
  if(syncing || !process.env.EDUFRAME_API_TOKEN) return;
  syncing=true;syncError=null;
  try {
    const data={};
    for(const name of Object.keys(resources)) data[name]=await fetchResource(name,process.env.EDUFRAME_API_TOKEN);
    const next={data,syncedAt:new Date().toISOString()};
    await db.put(next);snapshot=next;
  }catch(e){syncError=e.message;console.error('Synchronisatie mislukt:',e.message);}finally{syncing=false;}
}
const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
const server=http.createServer(async(req,res)=>{
  const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && url.pathname==='/health')return send(200,{ok:true});
    if(req.method==='GET' && assets[url.pathname]){const [file,type]=assets[url.pathname];return send(200,await readFile(new URL(`./public/${file}`,import.meta.url)),type);}
    if(!url.pathname.startsWith('/api/'))return send(404,{error:'Niet gevonden'});
    if(req.method==='POST' && (req.headers['x-requested-with']!=='SonoSkills' || !String(req.headers['content-type']).startsWith('application/json')))return send(403,{error:'Ongeldig verzoek'});
    if(url.pathname==='/api/login' && req.method==='POST') {
      const ip=req.socket.remoteAddress; // One conservative limit behind Railway's reverse proxy.
      const now=Date.now();
      for(const [key,v] of attempts)if(v.until<=now)attempts.delete(key);
      const state=attempts.get(ip)||{count:0,until:now+15*60e3};
      if(state.count>=10)return send(429,{error:'Te veel pogingen. Probeer over 15 minuten opnieuw.'});
      const input=await body(req);state.count++;attempts.set(ip,state);
      const actual=scryptSync(String(input.password||''),salt,64);
      if(String(input.email||'').toLowerCase()!==email.toLowerCase() || !timingSafeEqual(hash,actual))return send(401,{error:'E-mailadres of wachtwoord klopt niet.'});
      attempts.delete(ip);
      const value=`${now+8*3600e3}.${randomBytes(20).toString('hex')}`;
      res.setHeader('Set-Cookie',`ss_session=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${production?'; Secure':''}`);
      return send(200,{ok:true});
    }
    if(!session(req))return send(401,{error:'Log in om verder te gaan.'});
    if(url.pathname==='/api/logout' && req.method==='POST'){res.setHeader('Set-Cookie',`ss_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production?'; Secure':''}`);return send(200,{ok:true});}
    if(url.pathname==='/api/status' && req.method==='GET')return send(200,{configured:!!process.env.EDUFRAME_API_TOKEN,syncedAt:snapshot.syncedAt,syncing,error:syncError,exactConnected:false});
    if(url.pathname==='/api/sync' && req.method==='POST'){
      if(!process.env.EDUFRAME_API_TOKEN)return send(409,{error:'Voeg EDUFRAME_API_TOKEN toe in Railway.'});
      if(syncing)return send(409,{error:'Er loopt al een synchronisatie.'});
      void sync();return send(202,{ok:true});
    }
    if(['/api/analytics','/api/export'].includes(url.pathname) && req.method==='GET') {
      const filters=Object.fromEntries(url.searchParams);
      for(const k of ['from','to']) if(filters[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(filters[k]))return send(400,{error:'Ongeldige datum'});
      if(filters.from && filters.to && filters.from>filters.to)return send(400,{error:'De einddatum ligt vóór de begindatum.'});
      const result=analyze(snapshot.data,filters);
      if(url.pathname==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="sonoskills-cursussen.csv"');return send(200,csv(result.rows),'text/csv; charset=utf-8');}
      return send(200,result);
    }
    return send(404,{error:'Niet gevonden'});
  } catch(e){console.error('Request failed:',e.name);send(500,{error:'Het verzoek kon niet worden verwerkt.'});}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('SonoSkills dashboard gestart'));
const minutes=Math.max(15,Number(process.env.SYNC_INTERVAL_MINUTES)||60);
const timer=setInterval(()=>void sync(),minutes*60e3);
if(process.env.EDUFRAME_API_TOKEN)void sync();
async function stop(){clearInterval(timer);server.close();await db.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
