const CACHE='workout-pwa-static-v2-poses';
const SHELL=["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./images/Machine_Bench_Press-0.webp", "./images/Machine_Bench_Press-1.webp", "./images/Leverage_Incline_Chest_Press-0.webp", "./images/Leverage_Incline_Chest_Press-1.webp", "./images/Butterfly-0.webp", "./images/Butterfly-1.webp", "./images/Triceps_Pushdown_-_Rope_Attachment-0.webp", "./images/Triceps_Pushdown_-_Rope_Attachment-1.webp", "./images/Leverage_Shoulder_Press-0.webp", "./images/Leverage_Shoulder_Press-1.webp", "./images/Side_Lateral_Raise-0.webp", "./images/Side_Lateral_Raise-1.webp", "./images/Reverse_Machine_Flyes-0.webp", "./images/Reverse_Machine_Flyes-1.webp", "./images/Plank-0.webp", "./images/Wide-Grip_Lat_Pulldown-0.webp", "./images/Wide-Grip_Lat_Pulldown-1.webp", "./images/Leverage_Iso_Row-0.webp", "./images/Leverage_Iso_Row-1.webp", "./images/Straight-Arm_Pulldown-0.webp", "./images/Straight-Arm_Pulldown-1.webp", "./images/Dumbbell_Bicep_Curl-0.webp", "./images/Dumbbell_Bicep_Curl-1.webp"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('workout-pwa-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||!url.href.startsWith(self.registration.scope))return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.open(CACHE).then(cache=>cache.match(event.request).then(hit=>hit||cache.match('./index.html')))));
 }else{
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request).then(hit=>hit||fetch(event.request))));
 }
});

