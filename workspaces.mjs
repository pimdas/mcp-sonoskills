export const definitions=[
 {id:'handson',name:'Hands-on cursussen',basis:'course',aliases:['hands-on','hands-on cursussen','hands-on courses','hands on']},
 {id:'elearning',name:'eLearning',basis:'booking',aliases:['e-learning','elearning','e-learning cursussen','e-learning courses']},
 {id:'ondemand',name:'On-demand SonoClasses',basis:'booking',aliases:['on-demand sonoclasses','on demand sonoclasses','on-demand sono classes','on-demand sonoclass','on-demand solo classes','on demand solo classes','on-demand solo class','on-demand masterclasses','on demand masterclasses']},
 {id:'live',name:'Live SonoClasses',basis:'course',aliases:['live sonoclasses','live sono classes','live sonoclass','live solo classes','live solo class','live masterclasses']},
 {id:'products',name:'Producten',basis:'booking',aliases:['producten','products']},
 {id:'external',name:'Extern',basis:'course',aliases:['extern','external','externe cursussen','external courses','external courses (partners)']}
];
export const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function workspaceIndex(data,config={}){
 const categories=new Map((data.categories||[]).map(c=>[c.id,c]));
 function ancestry(id){const result=[],seen=new Set();while(categories.has(id)&&!seen.has(id)){seen.add(id);const c=categories.get(id);result.push(c);id=c.parent_id;}return result;}
 const mapping=Object.fromEntries(definitions.map(d=>[d.id,config[d.id]?.length?config[d.id]:(data.categories||[]).filter(c=>d.aliases.map(normalize).includes(normalize(c.name))).map(c=>c.id)]));
 function classify(course){const parents=ancestry(course?.category_id);for(const id of ['external','products'])if(parents.some(c=>mapping[id].includes(c.id)))return id;for(const c of parents)for(const d of definitions)if(mapping[d.id].includes(c.id))return d.id;return 'other';}
 function classifyEdition(edition,course){const base=classify(course);if(['live','ondemand'].includes(base)){if(edition.type==='FixedPlannedCourse')return 'live';if(edition.type==='FlexiblePlannedCourse')return 'ondemand';}return base;}
 const path=id=>ancestry(id).reverse().map(c=>c.name).join(' / ')||'Zonder categorie';
 return {mapping,classify,classifyEdition,path,ancestry,definitions:definitions.map(d=>({id:d.id,name:d.name,basis:d.basis,categoryIds:mapping[d.id],automatic:!config[d.id]?.length})),categories:[...categories.values()].map(c=>({id:c.id,name:path(c.id)})).sort((a,b)=>a.name.localeCompare(b.name))};
}
export function workspaceInfo(id){return definitions.find(d=>d.id===id);}
export function validateMapping(mapping,data){
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw Error('Ongeldige categorie-indeling.');
 const ids=new Set((data.categories||[]).map(c=>c.id)),used=new Set(),result={};
 for(const d of definitions){if(!Object.hasOwn(mapping,d.id))continue;const list=mapping[d.id];if(!Array.isArray(list)||list.some(id=>!Number.isInteger(id)||!ids.has(id)))throw Error('Kies bestaande Eduframe-categorieën.');for(const id of list){if(used.has(id))throw Error('Een categorie kan niet aan twee werkruimtes worden gekoppeld.');used.add(id);}result[d.id]=[...new Set(list)];}
 return result;
}
