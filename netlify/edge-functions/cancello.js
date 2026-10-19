// Coach Play Up – "cancello": l'app si apre solo sui dispositivi attivati con un codice di Croby.
// Senza la chiave giusta (cookie firmato) si vede solo la pagina di attivazione.
// Se su Netlify non è impostata la variabile CPU_ADMIN il cancello resta aperto (app libera come prima).
const enc = new TextEncoder();
const fromB64u = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
let KEY = null, KEYSRC = null;
async function hmacKey(admin){
  if (KEY && KEYSRC === admin) return KEY;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('coach-play-up|' + admin));
  KEY = await crypto.subtle.importKey('raw', raw, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']); KEYSRC = admin; return KEY;
}
export async function verifyToken(tok, admin){
  try {
    if (!tok || !admin) return null; const [p, s] = String(tok).split('.'); if (!p || !s) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(admin), Uint8Array.from(fromB64u(s), c => c.charCodeAt(0)), enc.encode(p));
    return ok ? JSON.parse(fromB64u(p)) : null;
  } catch { return null; }
}
const cookieOf = (req, name) => { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; };
// sempre aperti: la pagina di attivazione, la funzione delle chiavi, le icone e il manifest (per installare l'app)
const OPEN = [/^\/attiva\.html$/, /^\/\.netlify\/functions\/chiave/, /^\/manifest\.webmanifest$/, /^\/icons\//, /^\/favicon\.ico$/, /^\/robots\.txt$/];
export default async (req, context) => {
  const admin = (globalThis.Netlify?.env?.get?.('CPU_ADMIN')) || '';
  if (!admin) return;                                   // lucchetto non impostato: tutto come prima
  const u = new URL(req.url);
  if (OPEN.some(r => r.test(u.pathname))) return;
  const t = await verifyToken(cookieOf(req, 'cpu_key'), admin);
  const scaduto = t && t.r !== 'a' && t.f && Date.now() > t.f;      // accesso finito: serve un codice nuovo di Croby
  if (t && !scaduto) return;                                        // dispositivo attivato e nel periodo: avanti
  const html = req.method === 'GET' && (u.pathname === '/' || u.pathname.endsWith('.html') || (req.headers.get('accept') || '').includes('text/html'));
  if (html) return Response.redirect(new URL(scaduto ? '/attiva.html?scaduto=1' : '/attiva.html', u), 302);
  return new Response(JSON.stringify({error: scaduto ? 'accesso scaduto: serve un nuovo codice' : 'app bloccata: serve il codice di attivazione'}), {status: 401, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
};
export const config = {path: '/*'};
