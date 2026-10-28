import test from 'node:test';
import assert from 'node:assert/strict';
import {companyEmail,bootstrapOwner,createUser,manageUser,passwordHash,verifyPassword,invitationUser,activateUser,newSession,sessionUser,removeSession,publicUser} from '../users.mjs';
const fresh=()=>{const state={users:[],sessions:[]};const owner=bootstrapOwner(state,'pim@sonoskills.com','initial-fingerprint');return {state,owner};};
test('company domain is exact, normalized and enforced against suffix tricks and Unicode',()=>{
 assert.equal(companyEmail(' Collega@SonoSkills.com '),'collega@sonoskills.com');
 for(const v of ['x@gmail.com','x@sub.sonoskills.com','x@sonoskills.com.evil.com','x@sonoskills.com\nother@example.com','x@@sonoskills.com','x@sonoskı lls.com','x..y@sonoskills.com','.x@sonoskills.com',null])assert.throws(()=>companyEmail(v),/@sonoskills/);
});
test('accounts require an admin and a unique company email, and expose no hashes or tokens in lists',()=>{
 const {state,owner}=fresh();const added=createUser(state,owner.id,{email:'Alice@sonoskills.com',name:'Alice',role:'member'});assert.equal(added.user.email,'alice@sonoskills.com');assert.equal(added.user.status,'invited');assert.equal(added.token.length,43);assert.throws(()=>createUser(state,owner.id,{email:'ALICE@sonoskills.com',name:'X',role:'member'}),/al een account/);assert.throws(()=>createUser(state,owner.id,{email:'x@example.com',name:'X',role:'member'}),/@sonoskills/);assert.throws(()=>createUser(state,added.user.id,{email:'b@sonoskills.com',name:'B',role:'admin'}),/Alleen beheerders/);assert.ok(!JSON.stringify(state).includes(added.token));assert.ok(!JSON.stringify(state.users.map(publicUser)).includes('inviteHash'));
});
test('activation and reset links are single use, expire and are invalidated when replaced or disabled',async()=>{
 const {state,owner}=fresh();let added=createUser(state,owner.id,{email:'alice@sonoskills.com',name:'Alice',role:'member'},1000);const hash=await passwordHash('a long password phrase');assert.equal(await verifyPassword('a long password phrase',hash),true);assert.equal(await verifyPassword('wrong password',hash),false);await assert.rejects(()=>passwordHash('short'),/16/);
 assert.throws(()=>invitationUser(state,added.token,1000+24*3600e3),/verlopen/);const reset=manageUser(state,owner.id,{id:added.user.id,action:'invite'},2000);assert.throws(()=>invitationUser(state,added.token,2000),/verlopen/);activateUser(state,reset.token,hash,2000);assert.throws(()=>activateUser(state,reset.token,hash,2000),/verlopen/);assert.equal(state.users[1].passwordHash,hash);
 added=manageUser(state,owner.id,{id:added.user.id,action:'invite'},3000);manageUser(state,owner.id,{id:added.user.id,action:'disable'});assert.throws(()=>invitationUser(state,added.token,3000),/verlopen/);
});
test('logout, disable, role change and password resets revoke existing sessions immediately',async()=>{
 const {state,owner}=fresh();const added=createUser(state,owner.id,{email:'alice@sonoskills.com',name:'Alice',role:'member'});activateUser(state,added.token,await passwordHash('a long password phrase'));const user=state.users[1];let logged=newSession(state,user.id,user.version);assert.equal(sessionUser(state,logged.token).email,user.email);assert.ok(!JSON.stringify(state).includes(logged.token));removeSession(state,logged.token);assert.equal(sessionUser(state,logged.token),null);
 logged=newSession(state,user.id,user.version);manageUser(state,owner.id,{id:user.id,action:'role',role:'admin'});assert.equal(sessionUser(state,logged.token),null);logged=newSession(state,user.id,user.version);const reset=manageUser(state,owner.id,{id:user.id,action:'invite'});activateUser(state,reset.token,await passwordHash('another password phrase'));assert.equal(sessionUser(state,logged.token),null);logged=newSession(state,user.id,user.version);manageUser(state,owner.id,{id:user.id,action:'disable'});assert.equal(sessionUser(state,logged.token),null);assert.throws(()=>newSession(state,user.id,user.version),/klopt niet/);
});
test('existing owner cannot be disabled and changing bootstrap credentials revokes only owner sessions',()=>{
 const {state,owner}=fresh();assert.throws(()=>manageUser(state,owner.id,{id:owner.id,action:'disable'}),/Railway/);const logged=newSession(state,owner.id,state.users[0].version);bootstrapOwner(state,owner.email,'initial-fingerprint');assert.ok(sessionUser(state,logged.token));bootstrapOwner(state,owner.email,'rotated-fingerprint');assert.equal(sessionUser(state,logged.token),null);
});
test('user transactions roll back on validation errors and persist alongside existing snapshots',async()=>{
 const {database}=await import('../db.mjs');const previous=process.env.SQLITE_PATH;process.env.SQLITE_PATH=':memory:';const db=await database();try{const owner=await db.updateUsersState(s=>bootstrapOwner(s,'pim@sonoskills.com'));await assert.rejects(()=>db.updateUsersState(s=>{createUser(s,owner.id,{email:'alice@sonoskills.com',name:'Alice',role:'member'});throw Error('rollback');}),/rollback/);assert.equal((await db.getUsersState()).users.length,1);await db.put({data:{},syncedAt:'example'});assert.equal((await db.getUsersState()).users[0].email,owner.email);}finally{await db.close();if(previous===undefined)delete process.env.SQLITE_PATH;else process.env.SQLITE_PATH=previous;}
});

test('sessions expire after eight hours and legacy signed cookies are not accepted as user identities',()=>{
 const {state,owner}=fresh();const s=newSession(state,owner.id,state.users[0].version,1000);assert.ok(sessionUser(state,s.token,1000));assert.equal(sessionUser(state,s.token,1000+8*3600e3),null);assert.equal(sessionUser(state,'9999999999999.nonce.signature',1000),null);
});
