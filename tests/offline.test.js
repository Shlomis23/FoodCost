import { it, expect } from 'vitest';
import vm from 'node:vm';
import { serviceWorkerSource } from '../scripts/service-worker.js';
function worker() {
  const events={}, cached={kind:'cached asset'}, cache={match:async (request,options)=>typeof request==='string' || options?.ignoreVary ? cached : undefined, addAll:async()=>{}};
  const context={URL,fetch:()=>{throw new Error('network is offline');},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},self:{registration:{scope:'https://example.com/FoodCost/'},location:{origin:'https://example.com'},clients:{claim:async()=>{}},addEventListener:(name,handler)=>events[name]=handler,skipWaiting:()=>context.skipped=true}};
  vm.runInNewContext(serviceWorkerSource(['./index.html'],'test'),context);
  return {events,cached,context};
}
it('serves precached assets offline even when Vary: Origin differs',async()=>{const w=worker();let result;w.events.fetch({request:{method:'GET',url:'https://example.com/FoodCost/assets/app.js',mode:'cors'},respondWith:p=>result=p});expect(await result).toBe(w.cached);});
it('serves app shell for navigation offline',async()=>{const w=worker();let result;w.events.fetch({request:{method:'GET',url:'https://example.com/FoodCost/',mode:'navigate'},respondWith:p=>result=p});expect(await result).toBe(w.cached);});
it('does not intercept other origins or projects',()=>{const w=worker();let intercepted=false;for(const url of ['https://other.com/FoodCost/','https://example.com/other/']) w.events.fetch({request:{method:'GET',url},respondWith:()=>intercepted=true});expect(intercepted).toBe(false);});
it('activates an update only after an explicit update message',()=>{const w=worker();expect(w.context.skipped).toBeUndefined();w.events.message({data:{type:'SKIP_WAITING'}});expect(w.context.skipped).toBe(true);});
