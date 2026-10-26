function periodRange(preset,now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'numeric'}).formatToParts(now).filter(p=>['year','month'].includes(p.type)).map(p=>[p.type,Number(p.value)]));
 const year=parts.year,month=parts.month;
 const startMonth=preset==='month'?month:preset==='quarter'?Math.floor((month-1)/3)*3+1:1;
 const endMonth=preset==='month'?month:preset==='quarter'?startMonth+2:12;
 const iso=(m,d)=>`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 return {from:iso(startMonth,1),to:iso(endMonth,new Date(Date.UTC(year,endMonth,0)).getUTCDate())};
}
function setupPeriod(form){
 const select=form.querySelector('[data-period-preset]');
 const fields=[...form.querySelectorAll('[data-custom-period]')];
 const summary=form.querySelector('[data-period-summary]');
 function update(){
  const custom=select.value==='custom';fields.forEach(el=>el.hidden=!custom);summary.hidden=custom;
  if(!custom){const dates=periodRange(select.value);form.elements.from.value=dates.from;form.elements.to.value=dates.to;summary.textContent=`${new Date(dates.from+'T12:00:00Z').toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Amsterdam'})} – ${new Date(dates.to+'T12:00:00Z').toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Amsterdam'})}`;}
 }
 form.updatePeriod=update;
 select.addEventListener('change',()=>{update();if(select.value!=='custom')form.requestSubmit();});
 form.addEventListener('reset',()=>setTimeout(update,0));
 update();
}
for(const form of document.querySelectorAll('form[data-period-filter]'))setupPeriod(form);
