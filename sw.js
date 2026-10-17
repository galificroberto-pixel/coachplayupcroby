// Coach Play Up – service worker: alla prima apertura salva tutta l'app sul dispositivo,
// poi funziona anche senza internet. Con internet controlla se c'è una versione nuova.
const CACHE = 'coach-play-up-v3.22.1-123a44ba';
const FILES = [
"./",
"./icons/android-maskable-192.png",
"./icons/android-maskable-512.png",
"./icons/coach-play-up.ico",
"./icons/iphone-1024.png",
"./icons/iphone-120.png",
"./icons/iphone-152.png",
"./icons/iphone-167.png",
"./icons/iphone-180.png",
"./icons/pc-128.png",
"./icons/pc-16.png",
"./icons/pc-256.png",
"./icons/pc-32.png",
"./icons/pc-48.png",
"./icons/pc-512.png",
"./icons/pc-64.png",
"./index.html",
"./lib/fonts/BarlowCondensed-Bold.ttf",
"./lib/fonts/BarlowCondensed-Medium.ttf",
"./lib/fonts/BarlowCondensed-SemiBold.ttf",
"./lib/fonts/BowlbyOneSC-Regular.ttf",
"./lib/fonts/IBMPlexMono-Medium.ttf",
"./lib/fonts/IBMPlexMono-Regular.ttf",
"./lib/fonts/IBMPlexSans.ttf",
"./lib/fonts/RussoOne-Regular.ttf",
"./lib/fonts/fonts.css",
"./lib/ocr/eng.traineddata.gz",
"./lib/ocr/ocr-worker.js",
"./lib/ocr/tesseract-core-lstm.wasm.js",
"./lib/ocr/tesseract-core-simd-lstm.wasm.js",
"./lib/pdfjs/pdf.js",
"./lib/pdfjs/pdf.worker.js",
"./lib/xlsx.full.min.js",
"./manifest.webmanifest",
"./netlify.toml",
"./netlify/functions/ponte2.mjs",
"./pdf/jspdf.js",
"./pose/movenet.js",
"./pose/tf.js"
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const url = new URL(r.url); if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return; // collegamento a internet: mai dalla cache
  if (url.pathname.endsWith('version.json')){ e.respondWith(fetch(r, {cache: 'no-store'})); return; }
  // pagina: prima la rete (per avere sempre l'ultima versione), senza rete quella salvata
  if (r.mode === 'navigate'){ e.respondWith(fetch(r).catch(() => caches.match('./index.html', {ignoreSearch: true}))); return; }
  // librerie, modelli e icone: dal dispositivo
  e.respondWith(caches.match(r, {ignoreSearch: true}).then(hit => hit || fetch(r).then(res => { if (res.ok){ const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
});
