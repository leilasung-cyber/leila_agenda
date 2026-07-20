const CACHE='leila-portal-v28';
const ASSETS=['./','index.html','styles.css?v=28','app.js?v=28','glow.js?v=28','supabase-config.js?v=28','sync.js?v=28','assets/PretendardVariable.woff2','manifest.webmanifest','icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{if(e.request.url.startsWith(self.location.origin)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./'))))});
