const CACHE = 'budget-pwa-static-v2-assets';
const SHELL = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('budget-pwa-static-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url),scope=new URL(self.registration.scope).pathname;
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(scope)||url.pathname.startsWith(scope+'workout/'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreSearch:true}).then(hit=>hit||cache.match('./index.html')))));
  }else{
    event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreSearch:true}).then(hit=>hit||fetch(event.request))));
  }
});
