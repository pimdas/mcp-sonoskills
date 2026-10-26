const root = 'https://api.eduframe.nl/api/v1/';
export const resources = {
  courses: ['id','name','title'],
  course_locations: ['id','name'],
  planned_courses: ['id','course_id','course_location_id','start_date','end_date','status','current_participants','confirmed_active_and_completed_enrollments_count','max_participants','min_participants','currency'],
  enrollments: ['id','student_id','planned_course_id','order_id','status','created_at'],
  orders: ['id','planned_course_id','status','total_cost_excl','created_at','currency'],
  invoices: ['id','order_id','number','status','currency','total_excl','total_incl','total_open','opened_at','created_at']
};
export async function fetchResource(resource, token, fetcher=fetch, pause=ms=>new Promise(r=>setTimeout(r,ms))) {
  if (!Object.hasOwn(resources,resource)) throw Error('Onbekende databron');
  let next = new URL(`${resource}?per_page=100`,root), result=[], seen=new Set();
  while(next) {
    if(next.origin!==new URL(root).origin || !next.pathname.startsWith('/api/v1/')) throw Error('Ongeldige paginaverwijzing');
    if(seen.has(next.href)) throw Error('Herhaalde paginaverwijzing');
    seen.add(next.href);
    let response;
    for(let attempt=0;attempt<5;attempt++) {
      await pause(650); // Stay under 500 calls per 5 minutes, including sequential imports.
      response=await fetcher(next,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});
      if(response.status!==429 && response.status<500) break;
      if(attempt===4) break;
      const retry=response.headers.get('retry-after');
      const seconds=retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.max(0,(Date.parse(retry)-Date.now())/1000) : 2**attempt;
      await pause(Math.min(300000, Math.max(1000,(Number.isFinite(seconds)?seconds:2**attempt)*1000)));
    }
    if(!response.ok) throw Error(`Eduframe ${resource}: HTTP ${response.status}`);
    const rows=await response.json();
    if(!Array.isArray(rows) || rows.some(r=>!Number.isInteger(r.id))) throw Error(`Onverwacht antwoord voor ${resource}`);
    result.push(...rows.map(row=>Object.fromEntries(resources[resource].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))));
    const link=response.headers.get('link')||'';
    const href=link.split(',').map(s=>s.match(/<([^>]+)>;\s*rel="next"/)).find(Boolean)?.[1];
    next=href ? new URL(href,root) : null;
  }
  return result;
}
