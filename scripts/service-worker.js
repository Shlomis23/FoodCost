export function serviceWorkerSource(files, version) {
  return `const PREFIX='kerem-'+self.registration.scope;const CACHE=PREFIX+'-${version}';const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!u.href.startsWith(self.registration.scope))return;event.respondWith(caches.open(CACHE).then(async cache=>{if(event.request.mode==='navigate')return (await cache.match(new URL('index.html',self.registration.scope).href))||fetch(event.request);return (await cache.match(event.request,{ignoreVary:true}))||fetch(event.request);}));});`;
}
