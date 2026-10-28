import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt),digest=s=>createHash('sha256').update(s).digest('hex');
export class UserError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export function companyEmail(value){const email=typeof value==='string'?value.trim().toLowerCase():'';if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@sonoskills\.com$/.test(email)||email.length>254||email.startsWith('.')||email.includes('..')||email.includes('.@'))throw new UserError('Alleen e-mailadressen met @sonoskills.com zijn toegestaan.');return email;}
export function publicUser(u){return {id:u.id,name:u.name,email:u.email,role:u.role,status:u.disabled?'disabled':u.passwordHash||u.owner?'active':'invited',owner:!!u.owner,createdAt:u.createdAt,lastLoginAt:u.lastLoginAt||null,inviteExpiresAt:u.inviteExpiresAt||null};}
export function bootstrapOwner(state,email,fingerprint){email=companyEmail(email);state.users??=[];state.sessions??=[];let u=state.users.find(u=>u.email===email);if(!u){u={id:randomUUID(),email,name:'Beheerder',role:'admin',owner:true,disabled:false,version:1,createdAt:new Date().toISOString()};state.users.push(u);}if(!u.owner)throw new UserError('ADMIN_EMAIL behoort al tot een regulier account. Kies het bestaande beheerdersadres.');if(fingerprint&&u.bootstrapFingerprint!==fingerprint){u.bootstrapFingerprint=fingerprint;u.version++;state.sessions=state.sessions.filter(s=>s.userId!==u.id);}return publicUser(u);}
export async function passwordHash(password){if(typeof password!=='string'||password.length<16||password.length>256)throw new UserError('Gebruik een wachtwoord van 16 tot 256 tekens.');const salt=randomBytes(16).toString('hex'),hash=await derive(password,salt,64);return salt+':'+hash.toString('hex');}
export async function verifyPassword(password,stored){if(typeof password!=='string'||password.length>256||!stored)return false;const [salt,hash]=stored.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(hash))return false;const actual=await derive(password,salt,64);return timingSafeEqual(Buffer.from(hash,'hex'),actual);}
function admin(state,actorId){const u=state.users.find(u=>u.id===actorId);if(!u||u.disabled||u.role!=='admin')throw new UserError('Alleen beheerders kunnen gebruikers beheren.',403);return u;}
const prune=(state,now)=>{state.sessions=(state.sessions||[]).filter(s=>s.expires>now);};
function invite(u,now){const token=randomBytes(32).toString('base64url');u.inviteHash=digest(token);u.inviteExpiresAt=new Date(now+24*3600e3).toISOString();return {user:publicUser(u),token};}
export function createUser(state,actorId,input,now=Date.now()){
 admin(state,actorId);const email=companyEmail(input?.email),name=typeof input?.name==='string'?input.name.trim():'';if(!name||name.length>100)throw new UserError('Vul een naam in van maximaal 100 tekens.');if(!['member','admin'].includes(input?.role))throw new UserError('Kies Gebruiker of Beheerder.');if(state.users.some(u=>u.email===email))throw new UserError('Dit e-mailadres heeft al een account.');const u={id:randomUUID(),email,name,role:input.role,disabled:false,version:1,createdAt:new Date(now).toISOString()};state.users.push(u);return invite(u,now);
}
export function manageUser(state,actorId,input,now=Date.now()){
 const actor=admin(state,actorId),u=state.users.find(u=>u.id===input?.id);if(!u)throw new UserError('Gebruiker niet gevonden.',404);if(u.owner)throw new UserError('Het bestaande beheerdersaccount wordt via Railway beheerd.');if(actor.id===u.id)throw new UserError('Je kunt je eigen beheerrechten of toegang hier niet wijzigen.');
 if(input.action==='invite'){if(u.disabled)throw new UserError('Activeer dit account eerst.');return invite(u,now);}
 if(input.action==='disable'){u.disabled=true;u.version++;delete u.inviteHash;delete u.inviteExpiresAt;state.sessions=state.sessions.filter(s=>s.userId!==u.id);}
 else if(input.action==='enable')u.disabled=false;
 else if(input.action==='role'){if(!['member','admin'].includes(input.role))throw new UserError('Kies Gebruiker of Beheerder.');u.role=input.role;u.version++;state.sessions=state.sessions.filter(s=>s.userId!==u.id);}
 else throw new UserError('Onbekende gebruikersactie.');return {user:publicUser(u)};
}
export function invitationUser(state,token,now=Date.now()){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new UserError('Deze link is ongeldig of verlopen. Vraag de beheerder om een nieuwe link.');const hash=digest(token),u=state.users.find(u=>u.inviteHash===hash);if(!u||u.disabled||u.owner||Date.parse(u.inviteExpiresAt)<=now||!Number.isFinite(Date.parse(u.inviteExpiresAt)))throw new UserError('Deze link is ongeldig of verlopen. Vraag de beheerder om een nieuwe link.');companyEmail(u.email);return u;
}
export function activateUser(state,token,hash,now=Date.now()){const u=invitationUser(state,token,now);u.passwordHash=hash;u.version++;delete u.inviteHash;delete u.inviteExpiresAt;state.sessions=state.sessions.filter(s=>s.userId!==u.id);return publicUser(u);}
export function sessionUser(state,token,now=Date.now()){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const s=state.sessions?.find(s=>s.hash===digest(token)&&s.expires>now);if(!s)return null;const u=state.users.find(u=>u.id===s.userId);if(!u||u.disabled||u.version!==s.version||!u.owner&&!u.passwordHash)return null;try{companyEmail(u.email);}catch{return null;}return publicUser(u);
}
export function newSession(state,userId,version,now=Date.now()){
 const u=state.users.find(u=>u.id===userId);if(!u||u.disabled||u.version!==version||!u.owner&&!u.passwordHash)throw new UserError('E-mailadres of wachtwoord klopt niet.',401);companyEmail(u.email);prune(state,now);const token=randomBytes(32).toString('base64url');state.sessions.push({hash:digest(token),userId:u.id,version:u.version,expires:now+8*3600e3});u.lastLoginAt=new Date(now).toISOString();return {token,user:publicUser(u)};
}
export function removeSession(state,token){state.sessions=state.sessions.filter(s=>s.hash!==digest(token||''));}
