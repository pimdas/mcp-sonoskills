let demographicRequest=0;
async function loadDemographics(){
 const request=++demographicRequest,query=params();
 for(const key of ['productCategory','country','professionField','domainField']){const value=$('#demographic-filters').elements[key].value||pendingFilters[key];if(value)query.set(key,value);}
 const d=await api('/api/demographics?'+query);if(request!==demographicRequest||page!=='demographics')return;
 const form=$('#demographic-filters');
 function options(key,items,placeholder){const select=form.elements[key],value=query.get(key)||'';select.replaceChildren(new Option(placeholder,''),...items.map(o=>new Option(o.title||o,o.slug||o)));select.value=items.some(o=>(o.slug||o)===value)?value:'';}
 options('country',d.countries,'Alle landen');for(const key of ['profession','domain'])options(key+'Field',d.fields,'Automatisch'+(d.selectedFields[key]?' · '+(d.fields.find(f=>f.slug===d.selectedFields[key])?.title||d.selectedFields[key]):' · geen veld herkend'));
 form.elements.productCategory.value=query.get('productCategory')||'';
 const panel=$('#demographic-results');panel.replaceChildren();
 if(d.error)panel.append(element('p',d.error,'demographic-notice'));
 if(!d.ready){panel.append(element('p',d.syncing?'Demografische gegevens worden opgehaald…':'Klik op Synchroniseren om de demografische gegevens uit Eduframe op te halen.','empty'));return;}
 if(d.unidentifiedProductOrders)panel.append(element('p',d.unidentifiedProductOrders+' productorders hebben geen deelnemerkoppeling en kunnen niet in de demografische telling worden meegenomen.','demographic-notice'));
 if(d.syncedAt)panel.append(element('p','Profielgegevens bijgewerkt: '+new Date(d.syncedAt).toLocaleString('nl-NL'),'note'));
 const m=d.metrics,metrics=element('div','','metrics');
 const number=n=>n.toLocaleString('nl-NL'),percent=n=>m.people?Math.round(n/m.people*100)+'%':'—';
 for(const [title,value,note] of [['Unieke deelnemers',number(m.people),'Iedere persoon telt één keer in de selectie'],['Landen',number(m.countries),percent(m.countryKnown)+' heeft een bekend land'],['Beroep ingevuld',percent(m.professionKnown),number(m.professionKnown)+' van '+number(m.people)+' deelnemers'],['Domein ingevuld',percent(m.domainKnown),number(m.domainKnown)+' van '+number(m.people)+' deelnemers']]){const card=element('article');card.append(element('div',title),element('strong',value),element('small',note));metrics.append(card);}panel.append(metrics);
 if(!m.people)panel.append(element('p','Geen deelnemers gevonden voor deze periode en selectie.','empty'));
 const countryPanel=element('section','','panel');countryPanel.append(element('h2','Waar komen deelnemers vandaan?'));
 countryPanel.append(element('p','Land van het persoonlijke factuuraccount, anders van het factuuraccount bij de bestelling. Als beide ontbreken gebruiken we het contactadres ('+number(m.contactFallback)+' deelnemers). Een zakelijk factuurland is niet altijd het woonland.','note'));
 const cats=form.elements.productCategory.value?d.categories.filter(c=>c.id===form.elements.productCategory.value):d.categories;
 const countryRows=d.breakdowns.country.map(r=>[r.label,number(r.count),r.percentage.toLocaleString('nl-NL')+'%',...cats.map(c=>number(c.countries.find(x=>x.label===r.label)?.count||0))]);
 countryPanel.append(demographicTable(['Land','Totaal uniek','Aandeel',...cats.map(c=>({handson:'Hands-on',elearning:'eLearning',live:'Live',ondemand:'On-demand',products:'Producten'})[c.id])],countryRows));
 countryPanel.append(element('p','Per categorie telt een deelnemer één keer. Dezelfde persoon kan in meerdere categorieën voorkomen; de categorieën tellen daarom niet op tot het unieke totaal. Meerdere factuurlanden worden apart getoond.','note'));panel.append(countryPanel);
 const columns=element('div','','demographic-grid');
 for(const [key,title] of [['profession','Beroep'],['domain','Professioneel domein']]){const card=element('section','','panel');card.append(element('h2',title));if(!d.selectedFields[key])card.append(element('p','Kies het bijbehorende Eduframe-profielveld onder Veldinstellingen.','note'));card.append(demographicTable([title,'Deelnemers','Aandeel'],d.breakdowns[key].map(r=>[r.label,number(r.count),r.percentage.toLocaleString('nl-NL')+'%'])));card.append(element('p','Aandeel van alle unieke deelnemers in de selectie. Meerdere antwoorden per persoon kunnen samen boven 100% uitkomen.','note'));columns.append(card);}panel.append(columns);
 $('#demographic-period-note').textContent='Periode: cursusstart voor Hands-on en Live; boekingsdatum voor eLearning, On-demand en Producten. Alleen actieve, bevestigde en afgeronde inschrijvingen en actieve/aangevraagde productorders. Ontbrekende waarden staan als Onbekend. Profielgegevens volgen de huidige stand in Eduframe.';
}
function demographicTable(headers,rows){const wrap=element('div','','table-scroll'),table=element('table'),head=element('thead'),hr=element('tr');for(const h of headers){const th=element('th',h);th.scope='col';hr.append(th);}head.append(hr);const body=element('tbody');for(const row of rows){const tr=element('tr');row.forEach((value,i)=>tr.append(element(i===0?'th':'td',value)));tr.firstChild.scope='row';body.append(tr);}if(!rows.length){const tr=element('tr'),td=element('td','Geen gegevens in deze selectie.');td.colSpan=headers.length;tr.append(td);body.append(tr);}table.append(head,body);wrap.append(table);return wrap;}
document.addEventListener('DOMContentLoaded',()=>{
$('#demographic-filters').onsubmit=e=>{e.preventDefault();for(const key of ['productCategory','country','professionField','domainField'])delete pendingFilters[key];loadDemographics().then(saveFilterUrl).catch(e=>$('#message').textContent=e.message);};
$('#demographic-filters').onreset=()=>setTimeout(()=>{for(const key of ['productCategory','country','professionField','domainField'])delete pendingFilters[key];loadDemographics().then(saveFilterUrl).catch(e=>$('#message').textContent=e.message);},0);

});
