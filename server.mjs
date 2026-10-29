import {personalLinkedInConfig,personalLinkedInReport,clearPersonalLinkedInCache} from './linkedin-personal.mjs';
import {saveManualRevenue,removeManualRevenue} from './manual-royalties.mjs';
import {UserError,companyEmail,publicUser,bootstrapOwner,passwordHash,verifyPassword,createUser,manageUser,invitationUser,activateUser,sessionUser,newSession,removeSession} from './users.mjs';
import {googleAdsConfig,googleAdsSetup,googleAdsReport,validateAdsSettings} from './google-ads.mjs';
import {demographics,demographicResources} from './demographics.mjs';
import {ga4Configured,websiteReport} from './ga4.mjs';
import {exactConfig,authorizeUrl,exchangeCode,encryptTokens,decryptTokens,refreshTokens,fetchExactData,selectedInvoices,externalWorkspaces,validateCustomerClassification} from './exact.mjs';
import {googleReviews} from './reviews.mjs';
import http from 'node:http';
import {socialConfig,importSocial,socialReport} from './social.mjs';
import {importNewsletter,recordNewsletter,newsletterReport} from './mailerlite.mjs';
import {dashboard} from './dashboard.mjs';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHmac,timingSafeEqual,scryptSync} from 'node:crypto';
import {database} from './db.mjs';
import {resources,fetchResource} from './eduframe.mjs';
import {workspaceIndex,validateMapping,externalSubcategories} from './workspaces.mjs';
import {financeCsv} from './finance.mjs';
import {analyze,csv} from './analytics.mjs';
import {InputError,invoiceTargets,templateOptions,saveAgreement,removeAgreement,report,finalize,removeSettlement,markPaid,reportCsv,settlementCsv} from './royalties.mjs';
const production=process.env.NODE_ENV==='production';
const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_PASSWORD;
const secret=process.env.SESSION_SECRET;
if(!email || !password || password.length<16 || !secret || secret.length<32) throw Error('Stel ADMIN_EMAIL, ADMIN_PASSWORD (min. 16 tekens) en SESSION_SECRET (min. 32 tekens) in.');
const salt=randomBytes(16), hash=scryptSync(password,salt,64);
const db=await database();
await db.updateUsersState(state=>bootstrapOwner(state,email,createHmac('sha256',secret).update(email+'\0'+password).digest('hex')));
let snapshot=await db.get()||{data:{},syncedAt:null},syncing=false,syncError=null;
let workspaceConfig=await db.getConfig();
let adsSettings=await db.getAdsSettings();
let exact=await db.getExact(),exactSyncing=false,exactError=null;
async function syncExact(){if(exactSyncing||!exact.tokens)return;exactSyncing=true;exactError=null;try{let tokens=decryptTokens(exact.tokens,secret);if(tokens.expires_at<Date.now()+60000){tokens=await refreshTokens(exactConfig(),tokens);exact={...exact,tokens:encryptTokens(tokens,secret)};await db.putExact(exact);}const data=await fetchExactData(tokens.access_token);exact={...exact,...data,syncedAt:new Date().toISOString()};await db.putExact(exact);}catch(e){exactError=e.message;console.error('Exact synchronisatie:',e.message);}finally{exactSyncing=false;}}

let social=await db.getSocial(),socialSyncing=false,socialError=null;
async function syncSocial(){if(socialSyncing||(!socialConfig().token&&!socialConfig().linkedinToken&&!personalLinkedInConfig().token))return;socialSyncing=true;socialError=null;try{const next=await importSocial(socialConfig(),social);await db.putSocial(next);social=next;}catch{socialError='Social media synchroniseren is mislukt; vorige gegevens zijn bewaard.';}finally{socialSyncing=false;}}
let newsletter=await db.getNewsletter(),newsletterSyncing=false,newsletterError=null,newsletterProgress=null;
async function syncNewsletter(){if(newsletterSyncing||!process.env.MAILERLITE_API_TOKEN)return;newsletterSyncing=true;newsletterError=null;newsletterProgress={completed:0,total:5,phase:'fetching',startedAt:new Date().toISOString()};try{const next=recordNewsletter(newsletter,await importNewsletter(process.env.MAILERLITE_API_TOKEN,fetch,undefined,p=>{newsletterProgress={...newsletterProgress,...p};}));await db.putNewsletter(next);newsletter=next;}catch(e){newsletterError=e.name==='TimeoutError'?'MailerLite reageert niet binnen de tijdslimiet. Probeer opnieuw.':e.message;console.error('MailerLite synchronisatie:',newsletterError);}finally{newsletterSyncing=false;}}
let paymentState=snapshot.paymentState||{ready:false,error:null,syncedAt:null};
const paymentScope=()=>templateOptions(snapshot.data,workspaceConfig).map(t=>t.id).sort((a,b)=>a-b).join(',');
function paymentsStatus(){return paymentState.scope===paymentScope()?paymentState:{...paymentState,ready:false,error:'Synchroniseer betalingen voor de huidige eLearning-categorie-indeling.'};}
const attempts=new Map();
const sign=s=>createHmac('sha256',secret).update(s).digest('hex');
const equal=(a,b)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function sessionToken(req){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('ss_session='))?.slice(11)||'';}
function sessionCookie(token){return `ss_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${production?'; Secure':''}`;}
async function body(req) {let s='';for await(const chunk of req){s+=chunk;if(s.length>1048576)throw Error('Verzoek te groot');}return JSON.parse(s||'{}');}
async function sync() {
  if(syncing || !process.env.EDUFRAME_API_TOKEN) return;
  syncing=true;syncError=null;
  try {
    const data={};
    for(const name of Object.keys(resources).filter(name=>!demographicResources.includes(name))) data[name]=await fetchResource(name,process.env.EDUFRAME_API_TOKEN);
    let demographicState;
    try{const profiles={};for(const name of demographicResources)profiles[name]=await fetchResource(name,process.env.EDUFRAME_API_TOKEN);Object.assign(data,profiles);demographicState={syncedAt:new Date().toISOString(),error:null};}
    catch(e){for(const name of demographicResources)if(snapshot.data[name])data[name]=snapshot.data[name];demographicState={syncedAt:snapshot.demographicState?.syncedAt||null,error:'Demografische gegevens ophalen is mislukt ('+e.message+'). Controleer de leestoegang voor contacten, accounts en aanmeldvragen in de Eduframe API-token.'};}
    const now=new Date().toISOString();
    let nextPaymentState;
    try {
      const eligible=new Set(templateOptions(data,workspaceConfig).map(t=>t.id)),payments=[];
      const targets=invoiceTargets(data).filter(t=>t.invoice.status!=='concept'&&t.courseIds.some(id=>eligible.has(id)));
      for(const t of targets)payments.push(...await fetchResource(`invoices/${t.invoice.id}/payments`,process.env.EDUFRAME_API_TOKEN));
      data.payments=payments;nextPaymentState={ready:true,error:null,syncedAt:now,invoices:targets.length,scope:[...eligible].sort((a,b)=>a-b).join(',')};
    }catch(e){data.payments=snapshot.data.payments||[];nextPaymentState={ready:false,error:e.message,syncedAt:paymentState.syncedAt};}
    const next={data,syncedAt:now,paymentState:nextPaymentState,demographicState};
    await db.put(next);snapshot=next;paymentState=nextPaymentState;
  }catch(e){syncError=e.message;console.error('Synchronisatie mislukt:',e.message);}finally{syncing=false;}
}
const assets={'/newsletter.js':['newsletter.js','text/javascript; charset=utf-8'],'/users.js':['users.js','text/javascript; charset=utf-8'],'/activate.js':['activate.js','text/javascript; charset=utf-8'],'/google-ads.js':['google-ads.js','text/javascript; charset=utf-8'],'/demographics.js':['demographics.js','text/javascript; charset=utf-8'],'/sonoskills-logo-dark.png':['sonoskills-logo-dark.png','image/png'],'/sonoskills-logo.png':['sonoskills-logo.png','image/png'],'/reviews-embed.js':['reviews-embed.js','text/javascript; charset=utf-8'],'/website.js':['website.js','text/javascript; charset=utf-8'],'/social.js':['social.js','text/javascript; charset=utf-8'],'/fonts/campton-extrabold.woff':['fonts/campton-extrabold.woff','font/woff'],'/periods.js':['periods.js','text/javascript; charset=utf-8'],'/royalties.js':['royalties.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
const server=http.createServer(async(req,res)=>{
  const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && url.pathname==='/health')return send(200,{ok:true});
    if(req.method==='GET'&&url.pathname==='/courses'){const paths={all:'/overview',handson:'/handson',elearning:'/online/elearning',ondemand:'/online/on-demand',live:'/online/live',products:'/products',external:'/external',other:'/other',fixed:'/handson',flexible:'/online/elearning'};res.writeHead(302,{Location:(paths[url.searchParams.get('workspace')]||'/overview')+url.search});return res.end();}
    if(req.method==='GET'&&url.pathname==='/activate')return send(200,await readFile(new URL('./public/activate.html',import.meta.url)),'text/html; charset=utf-8');
    if(req.method==='GET' && ['/', '/users', '/demographics', '/overview','/handson','/online/elearning','/online/on-demand','/online/live','/products','/external','/other','/royalties','/data-sources','/social','/marketing','/marketing/social-media','/marketing/nieuwsbrief','/marketing/reviews','/marketing/website','/marketing/google-ads'].includes(url.pathname)){return send(200,await readFile(new URL('./public/index.html',import.meta.url)),'text/html; charset=utf-8');}
    if(req.method==='GET' && assets[url.pathname]){const [file,type]=assets[url.pathname];return send(200,await readFile(new URL(`./public/${file}`,import.meta.url)),type);}
    if(!url.pathname.startsWith('/api/'))return send(404,{error:'Niet gevonden'});
    if(req.method==='POST' && (req.headers['x-requested-with']!=='SonoSkills' || !String(req.headers['content-type']).startsWith('application/json')))return send(403,{error:'Ongeldig verzoek'});
    if(url.pathname==='/api/login' && req.method==='POST') {
      const ip=req.socket.remoteAddress,now=Date.now(),input=await body(req);
      let normalized;try{normalized=companyEmail(input.email);}catch{}
      for(const [key,v] of attempts)if(v.until<=now)attempts.delete(key);
      const key='login:'+ip+':'+(normalized||'invalid'),globalKey='login:'+ip;
      const state=attempts.get(key)||{count:0,until:now+15*60e3},global=attempts.get(globalKey)||{count:0,until:now+15*60e3};
      if(state.count>=10||global.count>=100)return send(429,{error:'Te veel pogingen. Probeer over 15 minuten opnieuw.'});
      state.count++;global.count++;attempts.set(key,state);attempts.set(globalKey,global);
      const usersState=await db.getUsersState(),user=usersState.users.find(u=>u.email===normalized);
      const supplied=typeof input.password==='string'&&input.password.length<=256?input.password:'';
      let valid=false;if(user&&!user.owner)valid=await verifyPassword(supplied,user.passwordHash);else valid=timingSafeEqual(hash,scryptSync(supplied,salt,64));
      if(!user||user.disabled||!valid)return send(401,{error:'E-mailadres of wachtwoord klopt niet.'});
      const logged=await db.updateUsersState(state=>newSession(state,user.id,user.version));attempts.delete(key);
      res.setHeader('Set-Cookie',sessionCookie(logged.token));return send(200,{ok:true,user:logged.user});
    }
    if(['/api/activate/check','/api/activate'].includes(url.pathname)&&req.method==='POST'){
      const key='activate:'+req.socket.remoteAddress,now=Date.now();for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);const attempt=attempts.get(key)||{count:0,until:now+15*60e3};if(attempt.count>=20)return send(429,{error:'Te veel pogingen. Probeer over 15 minuten opnieuw.'});attempt.count++;attempts.set(key,attempt);
      const input=await body(req);const user=invitationUser(await db.getUsersState(),input.token);
      if(url.pathname.endsWith('/check'))return send(200,{email:user.email,name:user.name});
      const hash=await passwordHash(input.password);await db.updateUsersState(state=>activateUser(state,input.token,hash));return send(200,{ok:true});
    }
    if(url.pathname==='/api/exact/callback' && req.method==='GET'){
      if(exactSyncing)return send(409,{error:'Wacht tot de synchronisatie klaar is.'});
      const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('exact_oauth='))?.slice(12)||'';
      const [expires,nonce,signature]=cookie.split('.');
      res.setHeader('Set-Cookie',`exact_oauth=; Path=/api/exact/callback; HttpOnly; SameSite=Lax; Max-Age=0${production?'; Secure':''}`);
      if(!expires||!nonce||!signature||Number(expires)<Date.now()||!equal(sign(`${expires}.${nonce}`),signature)||!equal(nonce,url.searchParams.get('state')||''))return send(400,{error:'De Exact-koppeling is verlopen of ongeldig. Start opnieuw vanuit Databronnen.'});
      if(!url.searchParams.get('code'))return send(400,{error:'Exact heeft geen autorisatiecode gegeven. Probeer opnieuw.'});
      try{const tokens=await exchangeCode(exactConfig(),url.searchParams.get('code'));exact={...exact,tokens:encryptTokens(tokens,secret),connectedAt:new Date().toISOString()};await db.putExact(exact);}catch(e){console.error('Exact autorisatie mislukt:',e.message);return send(502,{error:'Koppelen met Exact is mislukt. Start opnieuw vanuit Databronnen.'});}
      res.writeHead(303,{Location:'/data-sources?exact=connected'});return res.end();
    }
    const currentUser=sessionUser(await db.getUsersState(),sessionToken(req));
    if(!currentUser)return send(401,{error:'Log in om verder te gaan.'});
    if(url.pathname.startsWith('/api/users')){
      if(currentUser.role!=='admin')return send(403,{error:'Alleen beheerders kunnen gebruikers beheren.'});
      if(url.pathname==='/api/users'&&req.method==='GET')return send(200,{users:(await db.getUsersState()).users.map(publicUser),currentUserId:currentUser.id});
      if(url.pathname==='/api/users'&&req.method==='POST'){const input=await body(req);return send(201,await db.updateUsersState(state=>createUser(state,currentUser.id,input)));}
      if(url.pathname==='/api/users/manage'&&req.method==='POST'){const input=await body(req);return send(200,await db.updateUsersState(state=>manageUser(state,currentUser.id,input)));}
      return send(404,{error:'Niet gevonden'});
    }
    if(url.pathname==='/api/marketing/reviews/embed'&&req.method==='GET'){
      res.setHeader('X-Frame-Options','SAMEORIGIN');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' https://elfsightcdn.com https://*.elfsightcdn.com https://*.elfsight.com 'unsafe-inline'; connect-src https://elfsightcdn.com https://*.elfsightcdn.com https://*.elfsight.com; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; frame-src https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
      return send(200,await readFile(new URL('./public/reviews-embed.html',import.meta.url)),'text/html; charset=utf-8');
    }

    if(url.pathname==='/api/exact/connect'&&req.method==='POST'){
      const config=exactConfig();if(!config.clientId||!config.clientSecret)return send(409,{error:'Voeg EXACT_CLIENT_ID en EXACT_CLIENT_SECRET toe in Railway.'});
      const nonce=randomBytes(32).toString('hex'),expires=Date.now()+10*60e3,value=`${expires}.${nonce}`;
      res.setHeader('Set-Cookie',`exact_oauth=${value}.${sign(value)}; Path=/api/exact/callback; HttpOnly; SameSite=Lax; Max-Age=600${production?'; Secure':''}`);
      return send(200,{url:authorizeUrl(config,nonce)});
    }
    if(url.pathname==='/api/exact'&&req.method==='GET')return send(200,{categories:externalSubcategories(snapshot.data,workspaceConfig),customerWorkspaces:exact.customerWorkspaces||{},customerLabels:exact.customerLabels||{},mainCategories:externalWorkspaces,customerCategories:exact.customerCategories||{},editions:(snapshot.data.planned_courses||[]).filter(e=>{const c=(snapshot.data.courses||[]).find(c=>c.id===e.course_id);return workspaceIndex(snapshot.data,workspaceConfig).classify(c)==='external';}).map(e=>({id:String(e.id),name:((snapshot.data.courses||[]).find(c=>c.id===e.course_id)?.name||'Cursus')+' · '+(e.start_date?.slice(0,10)||'zonder datum')})),links:exact.links||{},connected:!!exact.tokens,syncing:exactSyncing,error:exactError,syncedAt:exact.syncedAt||null,accounts:exact.accounts||[],invoices:exact.invoices||[],selected:exact.selected||[],excluded:exact.excluded||[]});
    if(url.pathname==='/api/exact/sync'&&req.method==='POST'){if(!exact.tokens)return send(409,{error:'Koppel eerst Exact Online.'});if(exactSyncing)return send(409,{error:'Exact synchroniseert al.'});void syncExact();return send(202,{ok:true});}
    if(url.pathname==='/api/exact/settings'&&req.method==='POST'){const input=await body(req);if(exactSyncing)return send(409,{error:'Wacht tot de synchronisatie klaar is.'});if(!Array.isArray(input.selected)||!Array.isArray(input.excluded))return send(400,{error:'Ongeldige selectie.'});const validAccounts=new Set((exact.accounts||[]).map(a=>a.id)),validInvoices=new Set((exact.invoices||[]).map(i=>i.id));if(input.selected.some(x=>!validAccounts.has(x))||input.excluded.some(x=>!validInvoices.has(x)))return send(400,{error:'Selectie bevat onbekende klanten of facturen.'});const validEditions=new Set((snapshot.data.planned_courses||[]).map(e=>String(e.id)));const links=input.links||{};if(typeof links!=='object'||Array.isArray(links)||Object.entries(links).some(([invoice,edition])=>!validInvoices.has(invoice)||!validEditions.has(String(edition))))return send(400,{error:'Ongeldige cursuskoppeling.'});let classification;try{classification=validateCustomerClassification({customerWorkspaces:input.customerWorkspaces??Object.fromEntries(Object.entries(exact.customerWorkspaces||{}).filter(([id])=>input.selected.includes(id))),customerLabels:input.customerLabels??Object.fromEntries(Object.entries(exact.customerLabels||{}).filter(([id])=>input.selected.includes(id)))},input.selected);}catch(e){return send(400,{error:e.message});}exact={...exact,selected:[...new Set(input.selected)],excluded:[...new Set(input.excluded)],links,...classification};await db.putExact(exact);return send(200,{ok:true});}
    if(url.pathname==='/api/logout' && req.method==='POST'){await db.updateUsersState(state=>removeSession(state,sessionToken(req)));res.setHeader('Set-Cookie',`ss_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production?'; Secure':''}`);return send(200,{ok:true});}
    if(url.pathname==='/api/status' && req.method==='GET')return send(200,{user:currentUser,configured:!!process.env.EDUFRAME_API_TOKEN,syncedAt:snapshot.syncedAt,syncing,error:syncError,payments:paymentsStatus(),ga4:{configured:ga4Configured()},exactConnected:!!exact.tokens,social:{configured:!!(socialConfig().token||socialConfig().linkedinToken||personalLinkedInConfig().token),syncing:socialSyncing,error:socialError,updated:JSON.stringify([...Object.values(social.accounts||{}),social.personal||{}].map(a=>[a.syncedAt,a.postsSyncedAt,a.error,a.postsError]))},newsletter:{configured:!!process.env.MAILERLITE_API_TOKEN,syncedAt:newsletter.syncedAt||null,syncing:newsletterSyncing,error:newsletterError,progress:newsletterProgress}});
    if(url.pathname==='/api/google-ads/setup'&&req.method==='GET')return send(200,googleAdsSetup(googleAdsConfig(adsSettings)));
    if(url.pathname==='/api/google-ads/settings'&&req.method==='POST'){let next;try{next=validateAdsSettings(await body(req));}catch(e){return send(400,{error:e.message});}await db.putAdsSettings(next);adsSettings=next;return send(200,googleAdsSetup(googleAdsConfig(adsSettings)));}
    if(url.pathname==='/api/google-ads'&&req.method==='GET')return send(200,await googleAdsReport(Object.fromEntries(url.searchParams),googleAdsConfig(adsSettings)));
    if(url.pathname==='/api/website'&&req.method==='GET')return send(200,await websiteReport(Object.fromEntries(url.searchParams)));
    if(url.pathname==='/api/marketing/reviews'&&req.method==='GET')return send(200,await googleReviews());
    if(url.pathname==='/api/social/sync'&&req.method==='POST'){if(!socialConfig().token&&!socialConfig().linkedinToken&&!personalLinkedInConfig().token)return send(409,{error:'Voeg een Meta- of LinkedIn-toegangstoken toe in Railway.'});if(socialSyncing)return send(409,{error:'Social media wordt al gesynchroniseerd.'});clearPersonalLinkedInCache(true);void syncSocial();return send(202,{ok:true});}
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
      if(req.method==='POST'&&url.pathname==='/api/royalties/manual'){const input=await body(req);return send(200,await db.updateRoyalties(state=>saveManualRevenue(state,input,snapshot.data,workspaceConfig,currentUser)));}
      if(req.method==='POST'&&url.pathname==='/api/royalties/manual/remove'){const input=await body(req);return send(200,await db.updateRoyalties(state=>removeManualRevenue(state,input.id,currentUser)));}
      if(req.method==='POST'&&url.pathname==='/api/royalties/agreement'){const input=await body(req);return send(200,await db.updateRoyalties(state=>saveAgreement(state,input,snapshot.data,workspaceConfig)));}
      if(req.method==='POST'&&url.pathname==='/api/royalties/agreement/remove'){const input=await body(req);await db.updateRoyalties(state=>removeAgreement(state,input.id));return send(200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/royalties/finalize'){
        if(syncing||!paymentsStatus().ready||syncError)return send(409,{error:'Wacht op een succesvolle synchronisatie inclusief betalingen voordat je een afrekening vaststelt.'});
        const input=await body(req);const data=snapshot.data,at=paymentState.syncedAt;
        return send(200,await db.updateRoyalties(state=>finalize(data,state,input,at,workspaceConfig,currentUser)));
      }
      if(req.method==='POST'&&url.pathname==='/api/royalties/settlement/remove'){const input=await body(req);return send(200,await db.updateRoyalties(state=>removeSettlement(state,input.id,currentUser)));}
      if(req.method==='POST'&&url.pathname==='/api/royalties/paid'){const input=await body(req);return send(200,await db.updateRoyalties(state=>markPaid(state,input.id,input.date,input.reference)));}
      if(req.method==='GET'&&url.pathname==='/api/royalties/settlement-export'){
        const state=await db.getRoyalties(),s=state.settlements.find(s=>s.id===url.searchParams.get('id'));if(!s)return send(404,{error:'Afrekening niet gevonden.'});
        res.setHeader('Content-Disposition','attachment; filename="sonoskills-afrekening.csv"');return send(200,settlementCsv(s),'text/csv; charset=utf-8');
      }
      return send(404,{error:'Niet gevonden'});
    }
    if(['/api/demographics','/api/social','/api/newsletter','/api/dashboard','/api/analytics','/api/export','/api/finance-export'].includes(url.pathname) && req.method==='GET') {
      const filters=Object.fromEntries(url.searchParams);
      for(const k of ['from','to']) if(filters[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(filters[k]))return send(400,{error:'Ongeldige datum'});
      if(filters.from && filters.to && filters.from>filters.to)return send(400,{error:'De einddatum ligt vóór de begindatum.'});
      if(url.pathname==='/api/demographics')return send(200,{...demographics(snapshot.data,filters,workspaceConfig),syncing,syncedAt:snapshot.demographicState?.syncedAt||null,error:snapshot.demographicState?.error||null});
      if(url.pathname==='/api/newsletter')return send(200,{...newsletterReport(newsletter,filters),configured:!!process.env.MAILERLITE_API_TOKEN,syncing:newsletterSyncing,error:newsletterError});
      if(url.pathname==='/api/social')return send(200,{newsletter:{...newsletterReport(newsletter,filters),configured:!!process.env.MAILERLITE_API_TOKEN,syncing:newsletterSyncing,error:newsletterError},accounts:socialReport(social,filters,socialConfig()),personal:await personalLinkedInReport(personalLinkedInConfig(),social.personal,filters),syncing:socialSyncing,error:socialError});
      if(url.pathname==='/api/dashboard')return send(200,{...dashboard(snapshot.data,filters,workspaceConfig,selectedInvoices(exact,filters)),newsletter:{...newsletterReport(newsletter,filters),configured:!!process.env.MAILERLITE_API_TOKEN,syncing:newsletterSyncing,error:newsletterError,progress:newsletterProgress}});
      const result=analyze(snapshot.data,filters,workspaceConfig);
      if(url.pathname==='/api/finance-export'){res.setHeader('Content-Disposition','attachment; filename="sonoskills-omzetcontrole.csv"');return send(200,financeCsv(result.finance,filters,snapshot.syncedAt),'text/csv; charset=utf-8');}
      if(url.pathname==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="sonoskills-cursussen.csv"');return send(200,csv(result.rows),'text/csv; charset=utf-8');}
      return send(200,result);
    }
    return send(404,{error:'Niet gevonden'});
  } catch(e){if(e instanceof UserError)return send(e.status,{error:e.message});if(e instanceof InputError)return send(400,{error:e.message});console.error('Request failed:',e.name);send(500,{error:'Het verzoek kon niet worden verwerkt.'});}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('SonoSkills dashboard gestart'));
const minutes=Math.max(15,Number(process.env.SYNC_INTERVAL_MINUTES)||60);
const timer=setInterval(()=>{void sync();void syncNewsletter();void syncSocial();void syncExact();},minutes*60e3);
if(process.env.MAILERLITE_API_TOKEN)void syncNewsletter();
if(socialConfig().token||socialConfig().linkedinToken||personalLinkedInConfig().token)void syncSocial();
if(process.env.EDUFRAME_API_TOKEN)void sync();
async function stop(){clearInterval(timer);server.close();await db.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
