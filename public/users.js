function showUserLink(result){
 const target=$('#user-link-result');target.replaceChildren();const url=new URL('/activate',location.origin);url.hash=new URLSearchParams({token:result.token}).toString();target.hidden=false;
 target.append(element('h2','Link voor '+result.user.email),element('p','Deel deze eenmalige link zelf met deze collega. De link is 24 uur geldig. Er wordt geen e-mail verstuurd.','note'));
 const input=element('input');input.type='text';input.readOnly=true;input.value=url.href;input.setAttribute('aria-label','Eenmalige activatie- of resetlink');target.append(input);const copy=element('button','Link kopiëren');copy.type='button';copy.className='subtle';copy.onclick=async()=>{try{await navigator.clipboard.writeText(input.value);copy.textContent='Gekopieerd';}catch{input.focus();input.select();copy.textContent='Selecteer en kopieer de link';}};target.append(copy);
}
async function loadUsers(){
 if(status?.user?.role!=='admin'){$('#users-list').replaceChildren(element('p','Alleen beheerders kunnen gebruikers beheren.'));$('#user-create').hidden=true;return;}
 $('#user-create').hidden=false;const d=await api('/api/users');if(page!=='users')return;const table=element('table'),head=element('thead'),hr=element('tr');for(const h of ['Naam','E-mailadres','Rol','Status','Acties']){const th=element('th',h);th.scope='col';hr.append(th);}head.append(hr);const body=element('tbody');
 for(const u of d.users){const tr=element('tr');tr.append(element('td',u.name),element('td',u.email),element('td',u.role==='admin'?'Beheerder':'Gebruiker'),element('td',({active:'Actief',invited:'Wacht op activatie',disabled:'Uitgeschakeld'})[u.status]));const actions=element('td');
  if(u.owner)actions.append(element('small','Bestaande beheerder'));
  else if(u.id===d.currentUserId)actions.append(element('small','Jouw account'));
  else{const action=(label,command,role)=>{const b=element('button',label,'subtle');b.type='button';b.onclick=async()=>{b.disabled=true;$('#users-message').textContent='';try{const r=await api('/api/users/manage',{id:u.id,action:command,...(role?{role}:{})});if(r.token)showUserLink(r);else{const panel=$('#user-link-result');panel.hidden=true;panel.replaceChildren();}await loadUsers();}catch(e){$('#users-message').textContent=e.message;}finally{b.disabled=false;}};actions.append(b);};if(u.status!=='disabled')action(u.status==='invited'?'Nieuwe activatielink':'Wachtwoordreset','invite');action(u.status==='disabled'?'Inschakelen':'Uitschakelen',u.status==='disabled'?'enable':'disable');action(u.role==='admin'?'Maak gebruiker':'Maak beheerder','role',u.role==='admin'?'member':'admin');}
  tr.append(actions);body.append(tr);
 }table.append(head,body);$('#users-list').replaceChildren(table);
}
document.addEventListener('DOMContentLoaded',()=>{$('#user-create').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;$('#users-message').textContent='';try{const result=await api('/api/users',Object.fromEntries(new FormData(e.target)));e.target.reset();showUserLink(result);await loadUsers();}catch(e){$('#users-message').textContent=e.message;}finally{button.disabled=false;}};});
