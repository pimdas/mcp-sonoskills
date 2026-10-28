import {randomUUID} from 'node:crypto';
import {InputError,validDate,cents,templateOptions,manualLocked,historicalPaymentOverlap} from './royalties.mjs';
const fail=m=>{throw new InputError(m);};
export const manualSources=['reseller','historical','other'];
const normalize=s=>String(s||'').trim().normalize('NFKC').toLocaleLowerCase('nl').replace(/\s+/g,' ');
export function saveManualRevenue(state,input,data,config={},actor={}){
 const entries=state.manualRevenue||[],old=input.id?entries.find(e=>e.id===input.id):null;
 if(input.id&&!old)fail('Handmatige omzet niet gevonden.');if(old&&(old.voidedAt||manualLocked(state,old.id)))fail('Deze invoer is al afgerekend of ingetrokken. Voeg een aparte correctie toe.');
 const correctsId=String(input.correctsId||''),parent=correctsId?entries.find(e=>e.id===correctsId&&!e.voidedAt&&!e.correctsId):null;
 if(correctsId&&!parent)fail('Kies een bestaande oorspronkelijke omzetboeking voor de correctie.');
 if(parent&&!manualLocked(state,parent.id))fail('Deze omzet is nog niet afgerekend. Bewerk de oorspronkelijke boeking.');
 if(old&&(old.correctsId||'')!==correctsId)fail('Het type van een bestaande boeking kan niet worden gewijzigd.');
 const courseId=Number(input.courseId),from=input.from,to=input.to,sourceType=String(input.sourceType||''),sourceName=String(input.sourceName||'').trim(),reference=String(input.reference||'').trim(),note=String(input.note||'').trim(),currency=String(input.currency||'').trim().toUpperCase();
 if(!templateOptions(data,config).some(t=>t.id===courseId))fail('Kies een cursus in de categorie eLearning.');
 if(!validDate(from)||!validDate(to)||from>to)fail('Kies een geldige omzetperiode.');
 if(!manualSources.includes(sourceType)||!sourceName||sourceName.length>160)fail('Kies een bron en vul een bronnaam in (maximaal 160 tekens).');
 if(!reference||reference.length>160)fail('Vul een unieke referentie in, bijvoorbeeld het factuur- of rapportnummer (maximaal 160 tekens).');
 if(note.length>1000)fail('De toelichting mag maximaal 1000 tekens bevatten.');
 if(!/^[A-Z]{3}$/.test(currency))fail('Gebruik een geldige valutacode, bijvoorbeeld EUR.');
 const amountCents=cents(String(input.amount??'').trim().replace(',','.'));
 if(amountCents==null||amountCents===0||(!parent&&amountCents<0)||!Number.isSafeInteger(amountCents*10000))fail(parent?'Vul een positief of negatief correctiebedrag in met maximaal twee decimalen.':'Vul een positief omzetbedrag in met maximaal twee decimalen.');
 if(parent&&[courseId!==parent.courseId,from!==parent.from,to!==parent.to,currency!==parent.currency,sourceType!==parent.sourceType,sourceName!==parent.sourceName].some(Boolean))fail('Een correctie moet dezelfde cursus, periode, bron en valuta als de oorspronkelijke boeking hebben.');
 const candidate={courseId,from,to,sourceType,sourceName,reference,note,currency,amountCents,correctsId:correctsId||null};
 if(entries.some(e=>!e.voidedAt&&e.id!==old?.id&&e.courseId===courseId&&e.currency===currency&&((!parent&&!e.correctsId&&sourceType==='historical'&&e.sourceType==='historical'&&e.from<=to&&from<=e.to)||(normalize(e.sourceName)===normalize(sourceName)&&normalize(e.reference)===normalize(reference)&&e.from<=to&&from<=e.to))))fail('Deze referentie of historische omzetperiode overlapt met een bestaande boeking voor dezelfde cursus. Controleer op dubbele invoer.');
 if(!parent&&sourceType==='historical'&&historicalPaymentOverlap(data,candidate))fail('Voor deze cursus staan al Eduframe-betalingen in deze periode. Beperk historische omzet tot het tijdvak dat nog niet in Eduframe staat.');
 const now=new Date().toISOString(),by={id:actor.id||null,email:actor.email||null};
 const entry={...candidate,id:old?.id||randomUUID(),createdAt:old?.createdAt||now,createdBy:old?.createdBy||by,updatedAt:now,updatedBy:by,history:[...(old?.history||[]),{at:now,by,action:old?'updated':'created',values:candidate}]};
 state.manualRevenue=[...entries.filter(e=>e.id!==entry.id),entry];return entry;
}
export function removeManualRevenue(state,id,actor={}){
 const entries=state.manualRevenue||[],entry=entries.find(e=>e.id===id);if(!entry||entry.voidedAt)fail('Handmatige omzet niet gevonden of al verwijderd.');
 const removed=entries.filter(e=>!e.voidedAt&&(e.id===id||e.correctsId===id)),at=new Date().toISOString(),by={id:actor.id||null,email:actor.email||null};
 for(const e of removed){e.voidedAt=at;e.voidedBy=by;e.history??=[];e.history.push({at,by,action:'voided',parentId:entry.id});}
 return {id,removedIds:removed.map(e=>e.id)};
}
