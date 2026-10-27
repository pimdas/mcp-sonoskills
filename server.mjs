import http from 'node:http';
import {socialConfig,importSocial,socialReport} from './social.mjs';
import {importNewsletter,recordNewsletter,newsletterReport} from './mailerlite.mjs';
import {dashboard} from './dashboard.mjs';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHmac,timingSafeEqual,scryptSync} from 'node:crypto';
import {database} from './db.mjs';
import {resources,fetchResource} from './eduframe.mjs';
import {workspaceIndex,validateMapping} from './workspaces.mjs';
import {financeCsv} from './finance.mjs';
import {analyze,csv} from './analytics.mjs';
import {InputError,invoiceTargets,templateOptions,saveAgreement,removeAgreement,report,finalize,markPaid,reportCsv,settlementCsv} from './royalties.mjs';
const production=process.env.NODE_ENV==='production';
const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_PASSWORD;
const secret=process.env.SESSION_SECRET;
if(!email || !password || password.length<16 || !secret || secret.length<32) throw Error('Stel ADMIN_EMAIL, ADMIN_PASSWORD (min. 16 tekens) en SESSION_SECRET (min. 32 tekens) in.');
const salt=randomBytes(16), hash=scryptSync(password,salt,64);
const db=await database();
let snapshot=await db.get()||{data:{},syncedAt:null},syncing=false,syncError=null;
let workspaceConfig=await db.getConfig();
let social=await db.getSocial(),socialSyncing=false,socialError=null;
async function syncSocial(){if(socialSyncing||!socialConfig().token)return;socialSyncing=true;socialError=null;try{const next=await importSocial(socialConfig(),social);await db.putSocial(next);social=next;}catch{socialError='Social media synchroniseren is mislukt; vorige gegevens zijn bewaard.';}finally{socialSyncing=false;}}
let newsletter=await db.getNewsletter(),newsletterSyncing=false,newsletterError=null,newsletterProgress=null;
async function syncNewsletter(){if(newsletterSyncing||!process.env.MAILERLITE_API_TOKEN)return;newsletterSyncing=true;newsletterError=null;newsletterProgress={completed:0,total:5,phase:'fetching',startedAt:new Date().toISOString()};try{const next=recordNewsletter(newsletter,await importNewsletter(process.env.MAILERLITE_API_TOKEN,fetch,undefined,p=>{newsletterProgress={...newsletterProgress,...p};}));await db.putNewsletter(next);newsletter=next;}catch(e){newsletterError=e.name==='TimeoutError'?'MailerLite reageert niet binnen de tijdslimiet. Probeer opnieuw.':e.message;console.error('MailerLite synchronisatie:',newsletterError);}finally{newsletterSyncing=false;}}
let paymentState=snapshot.paymentState||{ready:false,error:null,syncedAt:null};
const paymentScope=()=>templateOptions(snapshot.data,workspaceConfig).map(t=>t.id).sort((a,b)=>a-b).join(',');
function paymentsStatus(){return paymentState.scope===paymentScope()?paymentState:{...paymentState,ready:false,error:'Synchroniseer betalingen voor de huidige eLearning-categorie-indeling.'};}
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
    const now=new Date().toISOString();
    let nextPaymentState;
    try {
      const eligible=new Set(templateOptions(data,workspaceConfig).map(t=>t.id)),payments=[];
      const targets=invoiceTargets(data).filter(t=>t.invoice.status!=='concept'&&t.courseIds.some(id=>eligible.has(id)));
      for(const t of targets)payments.push(...await fetchResource(`invoices/${t.invoice.id}/payments`,process.env.EDUFRAME_API_TOKEN));
      data.payments=payments;nextPaymentState={ready:true,error:null,syncedAt:now,invoices:targets.length,scope:[...eligible].sort((a,b)=>a-b).join(',')};
    }catch(e){data.payments=snapshot.data.payments||[];nextPaymentState={ready:false,error:e.message,syncedAt:paymentState.syncedAt};}
    const next={data,syncedAt:now,paymentState:nextPaymentState};
    await db.put(next);snapshot=next;paymentState=nextPaymentState;
  }catch(e){syncError=e.message;console.error('Synchronisatie mislukt:',e.message);}finally{syncing=false;}
}
const assets={'/social.js':['social.js','text/javascript; charset=utf-8'],'/fonts/campton-extrabold.woff':['fonts/campton-extrabold.woff','font/woff'],'/periods.js':['periods.js','text/javascript; charset=utf-8'],'/royalties.js':['royalties.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
const server=http.createServer(async(req,res)=>{
  const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && url.pathname==='/health')return send(200,{ok:true});
    if(req.method==='GET'&&url.pathname==='/courses'){const paths={all:'/overview',handson:'/handson',elearning:'/online/elearning',ondemand:'/online/on-demand',live:'/online/live',products:'/products',external:'/external',other:'/other',fixed:'/handson',flexible:'/online/elearning'};res.writeHead(302,{Location:(paths[url.searchParams.get('workspace')]||'/overview')+url.search});return res.end();}
    if(req.method==='GET' && ['/', '/overview','/handson','/online/elearning','/online/on-demand','/online/live','/products','/external','/other','/royalties','/data-sources','/social'].includes(url.pathname)){return send(200,await readFile(new URL('./public/index.html',import.meta.url)),'text/html; charset=utf-8');}
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
    if(url.pathname==='/api/status' && req.method==='GET')return send(200,{configured:!!process.env.EDUFRAME_API_TOKEN,syncedAt:snapshot.syncedAt,syncing,error:syncError,payments:paymentsStatus(),exactConnected:false,social:{configured:!!socialConfig().token,syncing:socialSyncing,error:socialError,updated:JSON.stringify(Object.values(social.accounts||{}).map(a=>[a.syncedAt,a.postsSyncedAt,a.error,a.postsError]))},newsletter:{configured:!!process.env.MAILERLITE_API_TOKEN,syncedAt:newsletter.syncedAt||null,syncing:newsletterSyncing,error:newsletterError,progress:newsletterProgress}});
    if(url.pathname==='/api/social/sync'&&req.method==='POST'){if(!socialConfig().token)return send(409,{error:'Voeg META_ACCESS_TOKEN toe in Railway.'});if(socialSyncing)return send(409,{error:'Social media wordt al gesynchroniseerd.'});void syncSocial();return send(202,{ok:true});}
    if(url.pathname==='/api/newsletter/sync'&&req.method==='POST'){if(!process.env.MAILERLITE_API_TOKEN)return send(409,{error:'Voeg MAILERLITE_API_TOKEN toe in Railway.'});if(newsletterSyncing)return send(409,{error:'MailerLite wordt al gesynchroniseerd.'});void syncNewsletter();return send(202,{ok:true});}
    if(url.pathname==='/api/sync' && req.method==='POST'){
      if(!process.env.EDUFRAME_API_TOKEN)return send(409,{error:'Voeg EDUFRAME_API_TOKEN toe in Railway.'});
      if(syncing)return send(409,{error:'Er loopt al een synchronisatie.'});
      void sync();void syncNewsletter();return send(202,{ok:true});
    }
    if(url.pathname==='/api/workspaces'&&req.method==='GET')return send(200,workspaceIndex(snapshot.data,workspaceConfig));
    if(url.pathname==='/api/workspaces'&&req.method==='POST'){let mapping;try{mapping=validateMapping((await body(req)).mapping,snapshot.data);}catch(e){return send(400,{error:e.message});}await db.putConfig(mapping);workspaceConfig=mapping;return send(200,{ok:true});}
    if(url.pathname.startsWith('/api/royalties')) {
      if(req.method==='GET' && ['/api/royalties','/api/royalties/export'].includes(url.pathname)){
        const state=await db.getRoyalties(),r=report(snapshot.data,state,Object.fromEntries(url.searchParams),workspaceConfig);
        if(url.pathname.endsWith('/export')){res.setHeader('Content-Disposition','attachment; filename="sonoskills-royalties.csv"');return send(200,reportCsv(r),'text/csv; charset=utf-8');}
        return send(200,{...r,payments:paymentsStatus(),syncing});
      }
      if(req.method==='POST'&&url.pathname==='/api/royalties/agreement'){const input=await body(req);return send(200,await db.updateRoyalties(state=>saveAgreement(state,input,snapshot.data,workspaceConfig)));}
      if(req.method==='POST'&&url.pathname==='/api/royalties/agreement/remove'){const input=await body(req);await db.updateRoyalties(state=>removeAgreement(state,input.id));return send(200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/royalties/finalize'){
        if(syncing||!paymentsStatus().ready||syncError)return send(409,{error:'Wacht op een succesvolle synchronisatie inclusief betalingen voordat je een afrekening vaststelt.'});
        const input=await body(req);const data=snapshot.data,at=paymentState.syncedAt;
        return send(200,await db.updateRoyalties(state=>finalize(data,state,input,at,workspaceConfig)));
      }
      if(req.method==='POST'&&url.pathname==='/api/royalties/paid'){const input=await body(req);return send(200,await db.updateRoyalties(state=>markPaid(state,input.id,input.date,input.reference)));}
      if(req.method==='GET'&&url.pathname==='/api/royalties/settlement-export'){
        const state=await db.getRoyalties(),s=state.settlements.find(s=>s.id===url.searchParams.get('id'));if(!s)return send(404,{error:'Afrekening niet gevonden.'});
        res.setHeader('Content-Disposition','attachment; filename="sonoskills-afrekening.csv"');return send(200,settlementCsv(s),'text/csv; charset=utf-8');
      }
      return send(404,{error:'Niet gevonden'});
    }
    if(['/api/social','/api/dashboard','/api/analytics','/api/export','/api/finance-export'].includes(url.pathname) && req.method==='GET') {
      const filters=Object.fromEntries(url.searchParams);
      for(const k of ['from','to']) if(filters[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(filters[k]))return send(400,{error:'Ongeldige datum'});
      if(filters.from && filters.to && filters.from>filters.to)return send(400,{error:'De einddatum ligt vóór de begindatum.'});
      if(url.pathname==='/api/social')return send(200,{accounts:socialReport(social,filters,socialConfig()),syncing:socialSyncing,error:socialError});
      if(url.pathname==='/api/dashboard')return send(200,{...dashboard(snapshot.data,filters,workspaceConfig),newsletter:{...newsletterReport(newsletter,filters),configured:!!process.env.MAILERLITE_API_TOKEN,syncing:newsletterSyncing,error:newsletterError,progress:newsletterProgress}});
      const result=analyze(snapshot.data,filters,workspaceConfig);
      if(url.pathname==='/api/finance-export'){res.setHeader('Content-Disposition','attachment; filename="sonoskills-omzetcontrole.csv"');return send(200,financeCsv(result.finance,filters,snapshot.syncedAt),'text/csv; charset=utf-8');}
      if(url.pathname==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="sonoskills-cursussen.csv"');return send(200,csv(result.rows),'text/csv; charset=utf-8');}
      return send(200,result);
    }
    return send(404,{error:'Niet gevonden'});
  } catch(e){if(e instanceof InputError)return send(400,{error:e.message});console.error('Request failed:',e.name);send(500,{error:'Het verzoek kon niet worden verwerkt.'});}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('SonoSkills dashboard gestart'));
const minutes=Math.max(15,Number(process.env.SYNC_INTERVAL_MINUTES)||60);
const timer=setInterval(()=>{void sync();void syncNewsletter();void syncSocial();},minutes*60e3);
if(process.env.MAILERLITE_API_TOKEN)void syncNewsletter();
if(socialConfig().token)void syncSocial();
if(process.env.EDUFRAME_API_TOKEN)void sync();
async function stop(){clearInterval(timer);server.close();await db.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
