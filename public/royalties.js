let royaltyData;
function royaltyTab(name){for(const button of document.querySelectorAll('[data-royalty-tab]')){const active=button.dataset.royaltyTab===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('#royalty-view-'+button.dataset.royaltyTab).hidden=!active;}}
const royaltyTabs=[...document.querySelectorAll('[data-royalty-tab]')];
royaltyTabs.forEach((button,i)=>{button.onclick=()=>royaltyTab(button.dataset.royaltyTab);button.onkeydown=e=>{let n;if(e.key==='ArrowRight')n=(i+1)%royaltyTabs.length;else if(e.key==='ArrowLeft')n=(i+royaltyTabs.length-1)%royaltyTabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=royaltyTabs.length-1;else return;e.preventDefault();royaltyTabs[n].click();royaltyTabs[n].focus();};});
function royaltyEditor(kind,open){$('#royalty-'+kind+'-editor').hidden=!open;if(open)$('#royalty-'+kind).elements.courseId.focus();}
$('#royalty-add-manual').onclick=()=>{resetManualRoyalty();royaltyEditor('manual',true);$('#manual-cancel-edit').hidden=false;};
$('#royalty-add-agreement').onclick=()=>{resetAgreement();royaltyEditor('agreement',true);$('#royalty-cancel-edit').hidden=false;};

const money=(amount,currency)=>{try{return new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(amount/100);}catch{return `${(amount/100).toFixed(2)} ${currency}`;}};
const royaltyParams=()=>new URLSearchParams([...new FormData($('#royalty-filters'))].filter(([,v])=>v));
function chooseOptions(select,items,label){const current=select.value;select.replaceChildren();if(label){const o=element('option',label);o.value='';select.append(o);}for(const item of items){const o=element('option',item.name);o.value=item.id;select.append(o);}if(items.some(i=>String(i.id)===current))select.value=current;}
function royaltyTable(headings,rows){const wrap=element('div','','table-scroll'),table=element('table',''),head=element('thead',''),tr=element('tr','');for(const h of headings)tr.append(element('th',h));head.append(tr);table.append(head);const body=element('tbody','');for(const cells of rows){const tr=element('tr','');for(const v of cells){const td=element('td','');if(v instanceof Node)td.append(v);else td.textContent=v;tr.append(td);}body.append(tr);}table.append(body);wrap.append(table);return wrap;}
const royaltyButton=(label,action)=>{const button=element('button',label,'subtle');button.type='button';button.onclick=action;return button;};
async function royaltyAction(message,work){message.textContent='';try{await work();await loadRoyalties();}catch(e){message.textContent=e.message;}}
async function loadRoyalties(){
 const r=await api('/api/royalties?'+royaltyParams());royaltyData=r;
 chooseOptions($('#royalty-filters').elements.partyId,r.parties,'Alle ontvangers');
 chooseOptions($('#royalty-filters').elements.courseId,r.templates,'Alle eLearning-templates');
 chooseOptions($('#royalty-agreement').elements.courseId,r.templates,'Kies een template');
 chooseOptions($('#royalty-manual').elements.courseId,r.templates,'Kies een cursus');
 renderManualRoyalties(r);
 $('#royalty-recipients').replaceChildren(...r.parties.map(p=>element('option',p.name)));
 $('#royalty-status').classList.toggle('royalty-status-ready',!!r.payments.ready);
 $('#royalty-status').textContent=r.payments.ready?`Bijgewerkt ${new Date(r.payments.syncedAt).toLocaleString('nl-NL')}`:r.payments.error?`Betalingen niet actueel: ${r.payments.error}. Controleer of payments:read op het Eduframe-token is ingeschakeld en synchroniseer opnieuw. Vaststellen is geblokkeerd.`:'Nog geen betalingsimport beschikbaar. Voeg payments:read toe aan je Eduframe-token en synchroniseer.';
 $('#royalty-warnings').replaceChildren(...r.warnings.map(w=>element('p',w,'royalty-warning')));
 if(r.excludedInvoices)$('#royalty-warnings').append(element('p',`${r.excludedInvoices} facturen zijn niet automatisch aan één template te koppelen en blijven buiten de berekening. Controleer de koppelingen in Eduframe.`, 'note'));
 const currencies=[...new Set(r.rows.map(g=>g.currency))];
 $('#royalty-kpis').replaceChildren(...[['Royalty’s','royaltyCents'],['Al vastgesteld','settledCents'],['Nog af te rekenen','dueCents']].map(([label,key])=>{const card=element('article');card.append(element('span',label));for(const currency of currencies)card.append(element('strong',money(r.rows.filter(g=>g.currency===currency).reduce((sum,g)=>sum+g[key],0),currency)));if(!currencies.length)card.append(element('strong','—'));return card;}));
 $('#royalty-summary').replaceChildren();
 if(r.rows.length){
 const groups=new Map();for(const g of r.rows){const key=JSON.stringify([g.partyId||g.recipient,g.currency]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(g);}
 $('#royalty-summary').append(royaltyTable(['Ontvanger','Royalty','Al vastgesteld','Nog af te rekenen',''],[...groups.values()].map(rows=>{const first=rows[0],sum=key=>money(rows.reduce((v,g)=>v+g[key],0),first.currency),details=element('details','','royalty-recipient-details');details.append(element('summary',`${rows.length} cursus${rows.length===1?'':'sen'}`));for(const g of rows){const course=element('details','','template-card');course.append(element('summary',`${g.template} · ${money(g.royaltyCents,g.currency)}`),royaltyTable(['Eduframe','Handmatig','Grondslag','Percentage'],[[money(g.eduframeBase,g.currency),money(g.manualBase,g.currency),money(g.currentBase,g.currency),g.rates.map(x=>x+'%').join(' / ')]]),royaltyTable(['Bron','Referentie','Periode / datum','Grondslag','Percentage','Royalty (ongerond)','Correctie'],g.lines.map(l=>[l.sourceName||'Eduframe',l.source==='manual'?l.reference:`${l.invoiceNumber} · betaling #${l.paymentId}`,l.source==='manual'?`${l.periodFrom} t/m ${l.periodTo}`:l.date,money(l.currentBase,l.currency),l.bps/100+'%',(l.currentNumerator/1000000).toLocaleString('nl-NL',{maximumFractionDigits:6})+' '+l.currency,l.adjustment?'Ja':'—'])));details.append(course);}return [first.recipient,sum('royaltyCents'),sum('settledCents'),sum('dueCents'),details];})));
 }else $('#royalty-summary').append(element('p','Nog geen royalties in deze selectie. Voeg bij Beheer een afspraak toe of kies een andere periode.'));
 const selectedParty=$('#royalty-filters').elements.partyId.value;
 $('#royalty-finalize').disabled=!selectedParty||!r.payments.ready||r.syncing||!!r.warnings.length;
 $('#royalty-agreements').replaceChildren();
 if(!r.agreements.length)$('#royalty-agreements').append(element('p','Er zijn nog geen royaltyafspraken ingesteld.'));
 else $('#royalty-agreements').append(royaltyTable(['Template','Ontvanger','Percentage','Vanaf','Tot en met','Acties'],r.agreements.map(a=>{
  const actions=element('div','','royalty-actions');actions.append(royaltyButton(a.locked?'Einddatum aanpassen':'Bewerken',()=>{
   royaltyTab('manage');royaltyEditor('agreement',true);const f=$('#royalty-agreement');for(const k of ['id','courseId','recipient','from','to'])f.elements[k].value=a[k]||'';f.elements.percentage.value=a.bps/100;
   for(const k of ['courseId','recipient','percentage','from'])f.elements[k].disabled=a.locked;
   $('#royalty-cancel-edit').hidden=false;$('#agreement-message').textContent=a.locked?'Deze afspraak is al gebruikt. Je kunt alleen de einddatum aanpassen.':'';f.scrollIntoView({behavior:'smooth',block:'center'});
  }));if(!a.locked)actions.append(royaltyButton('Verwijderen',()=>royaltyAction($('#agreement-message'),()=>api('/api/royalties/agreement/remove',{id:a.id}))));
  return [a.template,a.recipient,a.bps/100+'%',a.from,a.to||'Doorlopend',actions];
 })));
 $('#royalty-settlements').replaceChildren();
 if(!r.settlements.length)$('#royalty-settlements').append(element('p','Nog geen vastgestelde afrekeningen in deze periode.'));
 else for(const s of [...r.settlements].reverse()){
  const card=element('details','','template-card'),summary=element('summary',`${s.recipient} · ${s.from} t/m ${s.to} · ${s.status==='paid'?'Betaald':'Vastgesteld'}`);
  card.append(summary,royaltyTable(['Template','Ontvangen / correctie','Royalty'],s.totals.map(t=>[t.template,money(t.baseCents,t.currency),money(t.amountCents,t.currency)])));
  const manualLines=s.lines.filter(l=>l.source==='manual');if(manualLines.length){const sources=element('details');sources.append(element('summary','Handmatige bronregels in deze afrekening'),royaltyTable(['Bron','Referentie','Omzetperiode','Grondslag / correctie','Percentage'],manualLines.map(l=>[l.sourceName,l.reference,`${l.periodFrom} t/m ${l.periodTo}`,money(l.baseCents,l.currency),l.bps/100+'%'])));card.append(sources);}
  const actions=element('div','','royalty-actions');actions.append(royaltyButton('↓ Afrekening CSV',()=>location.href='/api/royalties/settlement-export?id='+encodeURIComponent(s.id)));
  if(s.status==='finalized')actions.append(royaltyButton('Als betaald markeren',()=>{$('#royalty-paid').reset();$('#royalty-paid').elements.id.value=s.id;$('#paid-message').textContent='';$('#royalty-paid-dialog').showModal();}));
  actions.append(royaltyButton('Verwijderen',()=>{$('#royalty-delete-form').elements.id.value=s.id;$('#royalty-delete-message').textContent='';$('#royalty-delete-description').textContent=`${s.recipient} · ${s.from} t/m ${s.to}${s.status==='paid'?' · als betaald gemarkeerd':''}`;$('#royalty-delete-dialog').showModal();}));
  if(s.totals.some(t=>t.adjustmentCents))card.append(royaltyTable(['Cursus','Berekend openstaand','Af te rekenen','Aanpassing'],s.totals.map(t=>[t.template,money(t.calculatedCents??t.amountCents,t.currency),money(t.amountCents,t.currency),money(t.adjustmentCents||0,t.currency)])));
  if(s.note)card.append(element('p',s.note,'note'));
  if(s.status==='paid')card.append(element('p',`Betaald op ${s.paidAt}${s.reference?' · '+s.reference:''}`,'note'));
  card.append(actions,element('p',`Vastgesteld op ${new Date(s.createdAt).toLocaleString('nl-NL')} · betalingsimport ${new Date(s.syncedAt).toLocaleString('nl-NL')}`,'note'));$('#royalty-settlements').append(card);
 }
}
function resetAgreement(){royaltyEditor('agreement',false);const f=$('#royalty-agreement');for(const k of ['courseId','recipient','percentage','from'])f.elements[k].disabled=false;f.reset();f.elements.id.value='';$('#royalty-cancel-edit').hidden=true;}
$('#royalty-agreement').onsubmit=async e=>{e.preventDefault();const f=e.target,input=Object.fromEntries([...f.elements].filter(el=>el.name).map(el=>[el.name,el.value]));const b=e.submitter;b.disabled=true;try{await royaltyAction($('#agreement-message'),async()=>{await api('/api/royalties/agreement',input);resetAgreement();$('#agreement-message').textContent='Afspraak opgeslagen.';});}finally{b.disabled=false;}};
$('#royalty-cancel-edit').onclick=()=>{resetAgreement();$('#agreement-message').textContent='';};
$('#royalty-filters').onsubmit=e=>{e.preventDefault();royaltyAction($('#royalty-message'),async()=>{});};
$('#royalty-export').onclick=()=>{if($('#royalty-filters').reportValidity())location.href='/api/royalties/export?'+royaltyParams();};
let royaltyDraft;
function updateRoyaltyDraftTotal(){const totals=new Map();for(const row of document.querySelectorAll('.royalty-amount-row')){const amount=Number(row.querySelector('input').value.replace(',','.'));if(Number.isFinite(amount))totals.set(row.dataset.currency,(totals.get(row.dataset.currency)||0)+Math.round(amount*100));}$('#royalty-finalize-total').textContent='Totaal af te rekenen: '+[...totals].map(([currency,total])=>money(total,currency)).join(' · ');}
$('#royalty-finalize').onclick=async e=>{const b=e.target;b.disabled=true;try{
 const input=Object.fromEntries(new FormData($('#royalty-filters')));delete input.courseId;
 const params=new URLSearchParams(Object.entries(input).filter(([,v])=>v)),r=await api('/api/royalties?'+params);
 if(!r.payments.ready||r.syncing||r.warnings.length)throw Error('Controleer de synchronisatie en eventuele waarschuwingen voordat je afrekent.');
 const rows=r.rows.filter(g=>g.lines.some(l=>l.numerator!==0||l.baseCents!==0));if(!rows.length)throw Error('Er zijn geen nieuwe royaltybedragen of correcties om vast te stellen.');
 royaltyDraft={...input,expectedRevision:r.revision};$('#royalty-finalize-form').reset();$('#royalty-finalize-message').textContent='';
 $('#royalty-finalize-selection').textContent=`${r.parties.find(p=>p.id===input.partyId)?.name||''} · ${input.from} t/m ${input.to} · alle cursussen`;
 $('#royalty-finalize-amounts').replaceChildren(...rows.map(g=>{const row=element('label','','royalty-amount-row');row.dataset.courseId=g.courseId;row.dataset.currency=g.currency;row.append(element('span',g.template),element('small',`Openstaand: ${money(g.dueCents,g.currency)}`));const amount=element('input');amount.type='text';amount.inputMode='decimal';amount.required=true;amount.value=(g.dueCents/100).toFixed(2);amount.setAttribute('aria-label',`Af te rekenen voor ${g.template} (${g.currency})`);amount.oninput=updateRoyaltyDraftTotal;row.append(amount,element('span',g.currency));return row;}));
 updateRoyaltyDraftTotal();$('#royalty-finalize-dialog').showModal();
 }catch(err){$('#royalty-message').textContent=err.message;}finally{b.disabled=!royaltyData?.payments.ready||!$('#royalty-filters').elements.partyId.value||royaltyData?.syncing||!!royaltyData?.warnings.length;}};
$('#royalty-finalize-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const amounts=[...document.querySelectorAll('.royalty-amount-row')].map(row=>({courseId:row.dataset.courseId,currency:row.dataset.currency,amount:row.querySelector('input').value}));await api('/api/royalties/finalize',{...royaltyDraft,amounts,note:e.target.elements.note.value});$('#royalty-finalize-dialog').close();$('#royalty-message').textContent='Afrekening vastgesteld en bewaard.';await loadRoyalties();}catch(err){$('#royalty-finalize-message').textContent=err.message;}finally{b.disabled=false;}};
$('#royalty-finalize-cancel').onclick=()=>$('#royalty-finalize-dialog').close();
$('#royalty-delete-cancel').onclick=()=>$('#royalty-delete-dialog').close();
$('#royalty-delete-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/royalties/settlement/remove',{id:e.target.elements.id.value});$('#royalty-delete-dialog').close();$('#royalty-message').textContent='Afrekening verwijderd. De bedragen zijn weer beschikbaar.';await loadRoyalties();}catch(err){$('#royalty-delete-message').textContent=err.message;}finally{b.disabled=false;}};
$('#royalty-filters').addEventListener('change',()=>{ $('#royalty-finalize').disabled=true; }); // Apply first to review the selected party.
$('#royalty-paid').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/royalties/paid',Object.fromEntries(new FormData(e.target)));$('#royalty-paid-dialog').close();await loadRoyalties();}catch(err){$('#paid-message').textContent=err.message;}finally{b.disabled=false;}};
$('#royalty-paid-cancel').onclick=()=>$('#royalty-paid-dialog').close();

function resetManualRoyalty(){royaltyEditor('manual',false);const f=$('#royalty-manual');f.reset();for(const key of ['courseId','sourceType','sourceName','from','to','currency'])f.elements[key].disabled=false;f.elements.id.value='';f.elements.correctsId.value='';$('#manual-cancel-edit').hidden=true;$('#manual-message').textContent='';}
function editManualRoyalty(entry,correction=false){
 resetManualRoyalty();royaltyTab('manual');royaltyEditor('manual',true);const f=$('#royalty-manual');for(const key of ['courseId','sourceType','sourceName','from','to','currency','reference','note'])f.elements[key].value=entry[key]||'';
 if(correction){const original=royaltyData.manualRevenue.find(e=>e.id===(entry.correctsId||entry.id));if(!original){$('#manual-message').textContent='Kies de oorspronkelijke omzetperiode om deze boeking te corrigeren.';return;}for(const key of ['courseId','sourceType','sourceName','from','to','currency']){f.elements[key].value=original[key];f.elements[key].disabled=true;}f.elements.correctsId.value=original.id;f.elements.reference.value=original.reference+' / correctie '+(1+royaltyData.manualRevenue.filter(e=>e.correctsId===original.id).length);f.elements.amount.value='';f.elements.note.value='';$('#manual-message').textContent='Voer alleen het verschil in: negatief om omzet te verlagen, positief om omzet toe te voegen. Bestaande afrekeningen blijven bewaard.';}
 else{f.elements.id.value=entry.id;f.elements.correctsId.value=entry.correctsId||'';f.elements.amount.value=(entry.amountCents/100).toFixed(2);if(entry.correctsId)for(const key of ['courseId','sourceType','sourceName','from','to','currency'])f.elements[key].disabled=true;}
 $('#manual-cancel-edit').hidden=false;f.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderManualRoyalties(r){const target=$('#royalty-manual-entries');target.replaceChildren();if(!r.manualRevenue.length){target.append(element('p','Nog geen handmatige omzet in deze cursus- en periodeselectie.','note'));return;}
 target.append(royaltyTable(['Cursus','Omzetperiode','Bron','Referentie','Grondslag','Status','Acties'],r.manualRevenue.map(e=>{const actions=element('div','','royalty-actions'),ref=element('div',e.reference);if(e.note)ref.append(element('p',e.note,'note'));if(e.locked)actions.append(royaltyButton('Correctie toevoegen',()=>editManualRoyalty(e,true)));else{actions.append(royaltyButton('Bewerken',()=>editManualRoyalty(e)));}actions.append(royaltyButton('Verwijderen',()=>{$('#royalty-manual-delete-form').elements.id.value=e.id;$('#royalty-manual-delete-message').textContent='';$('#royalty-manual-delete-description').textContent=`${e.template} · ${e.reference} · ${money(e.amountCents,e.currency)}`;$('#royalty-manual-delete-dialog').showModal();}));return [e.template,`${e.from} t/m ${e.to}`,e.sourceName,ref,money(e.amountCents,e.currency),(e.correctsId?'Correctie · ':'')+(e.locked?'Al gebruikt in afrekening':'Nog niet afgerekend'),actions];})));
}
$('#royalty-manual').elements.sourceType.onchange=e=>{const f=$('#royalty-manual'),defaults={reseller:'123sonography gmbh',historical:'Historische omzet',other:'Overig'};if(Object.values(defaults).includes(f.elements.sourceName.value)||!f.elements.sourceName.value)f.elements.sourceName.value=defaults[e.target.value];};
$('#royalty-manual').onsubmit=async e=>{e.preventDefault();const f=e.target,input=Object.fromEntries([...f.elements].filter(el=>el.name).map(el=>[el.name,el.value])),button=e.submitter;button.disabled=true;try{await royaltyAction($('#manual-message'),async()=>{await api('/api/royalties/manual',input);resetManualRoyalty();$('#manual-message').textContent='Handmatige omzet opgeslagen. Controleer het royaltyoverzicht voor de gekozen periode.';});}finally{button.disabled=false;}};
$('#manual-cancel-edit').onclick=resetManualRoyalty;

$('#royalty-manual-delete-cancel').onclick=()=>$('#royalty-manual-delete-dialog').close();
$('#royalty-manual-delete-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/royalties/manual/remove',{id:e.target.elements.id.value});resetManualRoyalty();$('#royalty-manual-delete-dialog').close();$('#manual-message').textContent='Handmatige omzet verwijderd. Het royaltysaldo is bijgewerkt.';await loadRoyalties();}catch(err){$('#royalty-manual-delete-message').textContent=err.message;}finally{b.disabled=false;}};
