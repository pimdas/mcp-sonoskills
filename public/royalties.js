let royaltyData;
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
 $('#royalty-status').textContent=r.payments.ready?`Betalingen gesynchroniseerd: ${new Date(r.payments.syncedAt).toLocaleString('nl-NL')}. Negatieve betaalde betalingen tellen als terugbetaling.`:r.payments.error?`Betalingen niet actueel: ${r.payments.error}. Controleer of payments:read op het Eduframe-token is ingeschakeld en synchroniseer opnieuw. Vaststellen is geblokkeerd.`:'Nog geen betalingsimport beschikbaar. Voeg payments:read toe aan je Eduframe-token en synchroniseer.';
 $('#royalty-warnings').replaceChildren(...r.warnings.map(w=>element('p',w,'royalty-warning')));
 if(r.excludedInvoices)$('#royalty-warnings').append(element('p',`${r.excludedInvoices} facturen zijn niet automatisch aan één template te koppelen en blijven buiten de berekening. Controleer de koppelingen in Eduframe.`, 'note'));
 $('#royalty-summary').replaceChildren();
 if(r.rows.length){$('#royalty-summary').append(royaltyTable(['Cursus','Ontvanger','Percentage','Eduframe','Handmatig','Grondslag','Royalty','Al vastgesteld','Nog af te rekenen'],r.rows.map(g=>[g.template,g.recipient,g.rates.map(x=>x+'%').join(' / '),money(g.eduframeBase,g.currency),money(g.manualBase,g.currency),money(g.currentBase,g.currency),money(g.royaltyCents,g.currency),money(g.settledCents,g.currency),money(g.dueCents,g.currency)])));
  for(const g of r.rows){const details=element('details','','template-card'),summary=element('summary',`${g.template} · ${g.recipient} · betalingen, handmatige omzet en correcties`);details.append(summary,royaltyTable(['Bron','Referentie','Periode / datum','Grondslag','Percentage','Royalty (ongerond)','Correctie'],g.lines.map(l=>[l.sourceName||'Eduframe',l.source==='manual'?l.reference:`${l.invoiceNumber} · betaling #${l.paymentId}`,l.source==='manual'?`${l.periodFrom} t/m ${l.periodTo}`:l.date,money(l.currentBase,l.currency),l.bps/100+'%',(l.currentNumerator/1000000).toLocaleString('nl-NL',{maximumFractionDigits:6})+' '+l.currency,l.adjustment?'Ja':'—'])));$('#royalty-summary').append(details);}
 }else $('#royalty-summary').append(element('p','Nog geen royalties in deze selectie. Voeg een afspraak toe of kies een andere periode.'));
 const selectedParty=$('#royalty-filters').elements.partyId.value;
 $('#royalty-finalize').disabled=!selectedParty||!r.payments.ready||r.syncing||!!r.warnings.length;
 $('#royalty-agreements').replaceChildren();
 if(!r.agreements.length)$('#royalty-agreements').append(element('p','Er zijn nog geen royaltyafspraken ingesteld.'));
 else $('#royalty-agreements').append(royaltyTable(['Template','Ontvanger','Percentage','Vanaf','Tot en met','Acties'],r.agreements.map(a=>{
  const actions=element('div','','royalty-actions');actions.append(royaltyButton(a.locked?'Einddatum aanpassen':'Bewerken',()=>{
   const f=$('#royalty-agreement');for(const k of ['id','courseId','recipient','from','to'])f.elements[k].value=a[k]||'';f.elements.percentage.value=a.bps/100;
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
  if(s.status==='paid')card.append(element('p',`Betaald op ${s.paidAt}${s.reference?' · '+s.reference:''}`,'note'));
  card.append(actions,element('p',`Vastgesteld op ${new Date(s.createdAt).toLocaleString('nl-NL')} · betalingsimport ${new Date(s.syncedAt).toLocaleString('nl-NL')}`,'note'));$('#royalty-settlements').append(card);
 }
}
function resetAgreement(){const f=$('#royalty-agreement');for(const k of ['courseId','recipient','percentage','from'])f.elements[k].disabled=false;f.reset();f.elements.id.value='';$('#royalty-cancel-edit').hidden=true;}
$('#royalty-agreement').onsubmit=async e=>{e.preventDefault();const f=e.target,input=Object.fromEntries([...f.elements].filter(el=>el.name).map(el=>[el.name,el.value]));const b=e.submitter;b.disabled=true;try{await royaltyAction($('#agreement-message'),async()=>{await api('/api/royalties/agreement',input);resetAgreement();$('#agreement-message').textContent='Afspraak opgeslagen.';});}finally{b.disabled=false;}};
$('#royalty-cancel-edit').onclick=()=>{resetAgreement();$('#agreement-message').textContent='';};
$('#royalty-filters').onsubmit=e=>{e.preventDefault();royaltyAction($('#royalty-message'),async()=>{});};
$('#royalty-export').onclick=()=>{if($('#royalty-filters').reportValidity())location.href='/api/royalties/export?'+royaltyParams();};
$('#royalty-finalize').onclick=async e=>{const b=e.target;b.disabled=true;try{await royaltyAction($('#royalty-message'),async()=>{const input=Object.fromEntries(new FormData($('#royalty-filters')));await api('/api/royalties/finalize',input);$('#royalty-message').textContent='Afrekening vastgesteld en bewaard.';});}finally{b.disabled=!royaltyData?.payments.ready||!$('#royalty-filters').elements.partyId.value||royaltyData?.syncing||!!royaltyData?.warnings.length;}};
$('#royalty-filters').addEventListener('change',()=>{ $('#royalty-finalize').disabled=true; }); // Apply first to review the selected party.
$('#royalty-paid').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/royalties/paid',Object.fromEntries(new FormData(e.target)));$('#royalty-paid-dialog').close();await loadRoyalties();}catch(err){$('#paid-message').textContent=err.message;}finally{b.disabled=false;}};
$('#royalty-paid-cancel').onclick=()=>$('#royalty-paid-dialog').close();

function resetManualRoyalty(){const f=$('#royalty-manual');f.reset();for(const key of ['courseId','sourceType','sourceName','from','to','currency'])f.elements[key].disabled=false;f.elements.id.value='';f.elements.correctsId.value='';$('#manual-cancel-edit').hidden=true;$('#manual-message').textContent='';}
function editManualRoyalty(entry,correction=false){
 resetManualRoyalty();const f=$('#royalty-manual');for(const key of ['courseId','sourceType','sourceName','from','to','currency','reference','note'])f.elements[key].value=entry[key]||'';
 if(correction){const original=royaltyData.manualRevenue.find(e=>e.id===(entry.correctsId||entry.id));if(!original){$('#manual-message').textContent='Kies de oorspronkelijke omzetperiode om deze boeking te corrigeren.';return;}for(const key of ['courseId','sourceType','sourceName','from','to','currency']){f.elements[key].value=original[key];f.elements[key].disabled=true;}f.elements.correctsId.value=original.id;f.elements.reference.value=original.reference+' / correctie '+(1+royaltyData.manualRevenue.filter(e=>e.correctsId===original.id).length);f.elements.amount.value='';f.elements.note.value='';$('#manual-message').textContent='Voer alleen het verschil in: negatief om omzet te verlagen, positief om omzet toe te voegen. Bestaande afrekeningen blijven bewaard.';}
 else{f.elements.id.value=entry.id;f.elements.correctsId.value=entry.correctsId||'';f.elements.amount.value=(entry.amountCents/100).toFixed(2);if(entry.correctsId)for(const key of ['courseId','sourceType','sourceName','from','to','currency'])f.elements[key].disabled=true;}
 $('#manual-cancel-edit').hidden=false;f.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderManualRoyalties(r){const target=$('#royalty-manual-entries');target.replaceChildren();if(!r.manualRevenue.length){target.append(element('p','Nog geen handmatige omzet in deze cursus- en periodeselectie.','note'));return;}
 target.append(royaltyTable(['Cursus','Omzetperiode','Bron','Referentie','Grondslag','Status','Acties'],r.manualRevenue.map(e=>{const actions=element('div','','royalty-actions'),ref=element('div',e.reference);if(e.note)ref.append(element('p',e.note,'note'));if(e.locked)actions.append(royaltyButton('Correctie toevoegen',()=>editManualRoyalty(e,true)));else{actions.append(royaltyButton('Bewerken',()=>editManualRoyalty(e)));actions.append(royaltyButton('Intrekken',()=>royaltyAction($('#manual-message'),()=>api('/api/royalties/manual/remove',{id:e.id}))));}return [e.template,`${e.from} t/m ${e.to}`,e.sourceName,ref,money(e.amountCents,e.currency),(e.correctsId?'Correctie · ':'')+(e.locked?'Al gebruikt in afrekening':'Nog niet afgerekend'),actions];})));
}
$('#royalty-manual').elements.sourceType.onchange=e=>{const f=$('#royalty-manual'),defaults={reseller:'123sonography gmbh',historical:'Historische omzet',other:'Overig'};if(Object.values(defaults).includes(f.elements.sourceName.value)||!f.elements.sourceName.value)f.elements.sourceName.value=defaults[e.target.value];};
$('#royalty-manual').onsubmit=async e=>{e.preventDefault();const f=e.target,input=Object.fromEntries([...f.elements].filter(el=>el.name).map(el=>[el.name,el.value])),button=e.submitter;button.disabled=true;try{await royaltyAction($('#manual-message'),async()=>{await api('/api/royalties/manual',input);resetManualRoyalty();$('#manual-message').textContent='Handmatige omzet opgeslagen. Controleer het royaltyoverzicht voor de gekozen periode.';});}finally{button.disabled=false;}};
$('#manual-cancel-edit').onclick=resetManualRoyalty;
