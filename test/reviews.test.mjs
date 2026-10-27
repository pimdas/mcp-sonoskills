import test from 'node:test';
import assert from 'node:assert/strict';
import {googleReviews} from '../reviews.mjs';
test('Google aggregate lookup is server-side, minimal and does not expose secrets or reviews',async()=>{
 const result=await googleReviews({key:'secret-test',placeId:'ChIJtest'},async(url,options)=>{assert.equal(url,'https://places.googleapis.com/v1/places/ChIJtest');assert.equal(options.headers['X-Goog-Api-Key'],'secret-test');assert.equal(options.headers['X-Goog-FieldMask'],'rating,userRatingCount,attributions');return {ok:true,json:async()=>({rating:4.9,userRatingCount:123,reviews:[{text:'private content'}],attributions:[]})};});
 assert.equal(result.rating,4.9);assert.equal(result.count,123);assert.ok(!JSON.stringify(result).includes('secret-test'));assert.ok(!('reviews' in result));
});
test('Google missing setup, denied access and invalid totals produce isolated unavailable states',async()=>{
 assert.equal((await googleReviews({},()=>{throw Error('should not fetch');})).configured,false);
 assert.match((await googleReviews({key:'secret',placeId:'ChIJtest'},async()=>({ok:false,status:403}))).error,/HTTP 403/);
 assert.match((await googleReviews({key:'secret',placeId:'ChIJtest'},async()=>({ok:true,json:async()=>({rating:9,userRatingCount:1})}))).error,/geen geldige/);
 assert.equal((await googleReviews({key:'secret',placeId:'ChIJtest'},async()=>({ok:true,json:async()=>({userRatingCount:0})}))).rating,null);
});
