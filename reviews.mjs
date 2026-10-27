// Live aggregate lookup only: no review text, authors or persistent Places data.
export async function googleReviews(config={key:process.env.GOOGLE_PLACES_API_KEY,placeId:process.env.GOOGLE_PLACE_ID},fetcher=fetch){
 if(!config.key||!config.placeId)return {configured:false,rating:null,count:null};
 if(!/^[A-Za-z0-9_-]{5,200}$/.test(config.placeId))return {configured:true,error:'Controleer GOOGLE_PLACE_ID in Railway.'};
 try{
  const response=await fetcher('https://places.googleapis.com/v1/places/'+encodeURIComponent(config.placeId),{headers:{'X-Goog-Api-Key':config.key,'X-Goog-FieldMask':'rating,userRatingCount,attributions'},signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)throw Error('Google Reviews ophalen mislukt (HTTP '+response.status+'). Controleer de API-key, Places API (New) en facturering in Google Cloud.');
  const data=await response.json();
  if(!Number.isSafeInteger(data.userRatingCount)||data.userRatingCount<0||(data.userRatingCount>0&&(!Number.isFinite(data.rating)||data.rating<1||data.rating>5)))throw Error('Google heeft geen geldige beoordelingscijfers teruggegeven.');
  return {configured:true,rating:data.userRatingCount?data.rating:null,count:data.userRatingCount,checkedAt:new Date().toISOString(),url:'https://www.google.com/maps/search/?api=1&query=SonoSkills&query_place_id='+encodeURIComponent(config.placeId),attributions:(data.attributions||[]).map(a=>({name:String(a.provider||''),url:typeof a.providerUri==='string'&&a.providerUri.startsWith('https://')?a.providerUri:null}))};
 }catch(e){return {configured:true,error:e.name==='TimeoutError'?'Google Reviews reageert te langzaam. Probeer later opnieuw.':e.message?.startsWith('Google')?e.message:'Google Reviews is tijdelijk niet beschikbaar.'};}
}
