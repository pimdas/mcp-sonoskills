async function loadSocial(){
 const d=await api('/api/social?'+params()),root=$('#social-page');root.replaceChildren();root.classList.add('marketing-page');
 root.append(element('p','De periode geldt voor groei en gepubliceerde posts. Abonnees, volgers en Google-beoordelingen tonen de actuele stand.','note'));
 const layout=element('div','','marketing-grid');root.append(layout);
 if(d.newsletter){renderNewsletter(d.newsletter,layout);const panel=layout.lastElementChild;compactMarketingPanel(panel,'Groei, groepen en contactstatussen');}
 const reviews=element('section','','panel review-panel');reviews.append(element('h2','Google Reviews'),element('p','Beoordelingen ophalen…','note'));layout.append(reviews);void loadMarketingReviews(reviews);
 root.append(element('p','Volgers zijn de actuele aantallen. Groei volgt dagelijkse metingen vanaf de koppeling. Posts worden geselecteerd op publicatiedatum; interacties zijn de actuele totalen op die posts, inclusief later ontvangen reacties.','note'));
 if(d.error)root.append(element('p',d.error,'royalty-warning'));if(d.syncing)root.append(element('p','Facebook en Instagram worden gesynchroniseerd…','note'));
 const number=n=>n==null?'Niet beschikbaar':n.toLocaleString('nl-NL');
 const table=(headers,rows)=>{const scroll=element('div','','table-scroll'),t=element('table',''),head=element('thead',''),tr=element('tr','');headers.forEach(h=>tr.append(element('th',h)));head.append(tr);t.append(head);const body=element('tbody','');for(const cells of rows){const row=element('tr','');for(const c of cells){const td=element('td','');if(c instanceof Node)td.append(c);else td.textContent=c;row.append(td);}body.append(row);}t.append(body);scroll.append(t);return scroll;};
 for(const a of d.accounts){const panel=element('section','','panel');panel.append(element('h2',({facebook:'Facebook',instagram:'Instagram',linkedin:'LinkedIn'})[a.platform]+(a.name?' · '+a.name:'')));layout.append(panel);
 if(!a.configured){panel.append(element('p',a.platform==='linkedin'?'Nog niet gekoppeld. LinkedIn vereist aparte API-toegang.':'Nog niet gekoppeld. Controleer de META-variabelen bij Databronnen.'));continue;}
 if(a.error)panel.append(element('p',a.error,'royalty-warning'));
 if(!a.syncedAt){panel.append(element('p','Nog geen geslaagde synchronisatie.'));continue;}
 const cards=element('div','','metrics');const measured=a.months.filter(m=>m.growth!==null),growth=measured.length?measured.reduce((s,m)=>s+m.growth,0):null;
 for(const [label,value] of [['Volgers · nu',a.followers],['Gemeten volgersgroei',growth],['Posts in periode',a.postCount],['Likes / reacties',a.likes],['Comments',a.comments],['Shares',a.platform==='instagram'?null:a.shares]]){const card=element('article','');card.append(element('div',label),element('strong',number(value)));cards.append(card);}panel.append(cards);
 panel.append(element('p','Volgers bijgewerkt: '+new Date(a.syncedAt).toLocaleString('nl-NL')+(a.postsSyncedAt?' · Posts bijgewerkt: '+new Date(a.postsSyncedAt).toLocaleString('nl-NL'):'')+(a.platform==='instagram'?'. Instagram-shares en opgeslagen berichten zijn nog niet beschikbaar.':'.'),'note'));
 if(a.postsError)panel.append(element('p',a.postsError+' Eerder opgehaalde postcijfers blijven zichtbaar als die beschikbaar zijn.','royalty-warning'));
 const extra=element('details','','marketing-details');extra.append(element('summary','Groei en postdetails'));panel.append(extra);
 extra.append(element('h3','Volgersgroei per maand'));
 if(a.months.length)extra.append(table(['Maand','Gemeten vanaf','Gemeten tot','Begin','Eind','Netto groei'],a.months.map(m=>[m.month,m.from,m.to,number(m.start),number(m.end),number(m.growth)])));else extra.append(element('p','Nog geen metingen binnen deze periode.'));
 extra.append(element('p','De eerste maand en de lopende maand zijn gedeeltelijk gemeten. De datums tonen het werkelijk gemeten interval; ontbrekende historie wordt niet aangevuld.','note'));
 if(a.history.length>1){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 220');svg.setAttribute('role','img');svg.setAttribute('aria-label','Gemeten volgersgroei van '+a.name);const min=Math.min(...a.history.map(h=>h.followers)),max=Math.max(...a.history.map(h=>h.followers)),start=Date.parse(a.history[0].day),end=Date.parse(a.history.at(-1).day),points=a.history.map(h=>(40+820*(Date.parse(h.day)-start)/(end-start))+','+(180-140*(h.followers-min)/Math.max(1,max-min))).join(' '),line=document.createElementNS(ns,'polyline');for(const [k,v] of Object.entries({points,fill:'none',stroke:'#13638b','stroke-width':3}))line.setAttribute(k,v);svg.append(line);for(const [x,y,text] of [[40,205,a.history[0].day],[750,205,a.history.at(-1).day],[40,25,max.toLocaleString('nl-NL')],[40,180,min.toLocaleString('nl-NL')]]){const t=document.createElementNS(ns,'text');t.setAttribute('x',x);t.setAttribute('y',y);t.setAttribute('font-size',12);t.textContent=text;svg.append(t);}const wrap=element('div','','monthly-chart');wrap.append(svg);extra.append(wrap);}
 const details=element('details','');details.append(element('summary','Posts en interacties'));const safeLink=p=>{try{const url=new URL(p.url);if(url.protocol!=='https:'||!['facebook.com','www.facebook.com','instagram.com','www.instagram.com'].includes(url.hostname))return p.id;const link=element('a','Open post');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';return link;}catch{return p.id;}};
 if(a.posts.length)details.append(table(['Datum','Post','Likes / reacties','Comments','Shares'],a.posts.map(p=>[p.date,safeLink(p),number(p.likes),number(p.comments),number(p.shares)])));else details.append(element('p',a.postCount===null?'Posts nog niet beschikbaar.':'Geen posts binnen deze periode.'));extra.append(details);
 }
}

function compactMarketingPanel(panel,label){
 const children=[...panel.children],metrics=children.findIndex(n=>n.classList.contains('metrics'));if(metrics<0)return;
 const details=element('details','','marketing-details');details.append(element('summary',label));for(const child of children.slice(metrics+1))details.append(child);panel.append(details);
}
async function loadMarketingReviews(panel){
 try{const d=await api('/api/marketing/reviews');panel.replaceChildren(element('h2','Google Reviews'));
 if(!d.configured){panel.append(element('p','Nog niet gekoppeld. Koppel de SonoSkills-vermelding via Databronnen.','note'));return;}
 if(d.error){panel.append(element('p',d.error,'royalty-warning'));return;}
 const metrics=element('div','','metrics');for(const [label,value] of [['Gemiddelde beoordeling',d.rating==null?'—':d.rating.toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+' / 5 ★'],['Aantal beoordelingen',d.count.toLocaleString('nl-NL')]]){const card=element('article','');card.append(element('div',label),element('strong',value));metrics.append(card);}panel.append(metrics);
 const source=element('a','Google Maps','google-attribution');source.href=d.url;source.target='_blank';source.rel='noopener noreferrer';source.setAttribute('translate','no');panel.append(source);
 for(const a of d.attributions||[]){const credit=element(a.url?'a':'span',a.name,'note');if(a.url){credit.href=a.url;credit.target='_blank';credit.rel='noopener noreferrer';}panel.append(credit);}
 panel.append(element('p','Actuele stand · '+new Date(d.checkedAt).toLocaleString('nl-NL'),'note'));
 }catch{panel.replaceChildren(element('h2','Google Reviews'),element('p','Google Reviews kon niet worden geladen.','note'));}
}
