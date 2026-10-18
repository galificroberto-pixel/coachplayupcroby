// Coach Play Up – chiavi di attivazione (Netlify Functions + Netlify Blobs, gratuito).
// Solo il proprietario (password in CPU_ADMIN su Netlify) crea codici; ogni codice si usa UNA volta
// (con 30 minuti di tolleranza per installare l'app su iPhone dopo averla aperta in Safari, massimo 2 dispositivi).
// Azioni (POST JSON o GET):  stato · attiva {codice} · admin {password} · nuovo {nome, giorni} · lista · blocca {id} · sblocca {id} · esci
const enc = new TextEncoder();
const b64u = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let KEY = null, KEYSRC = null;
async function hmacKey(admin){
  if (KEY && KEYSRC === admin) return KEY;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('coach-play-up|' + admin));
  KEY = await crypto.subtle.importKey('raw', raw, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']); KEYSRC = admin; return KEY;
}
async function sign(obj, admin){ const p = b64u(enc.encode(JSON.stringify(obj))); const s = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(admin), enc.encode(p))); return p + '.' + b64u(s); }
async function verify(tok, admin){
  try { const [p, s] = String(tok || '').split('.'); if (!p || !s) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(admin), Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), enc.encode(p));
    return ok ? JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) : null; } catch { return null; }
}
const H = {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store'};
const COOKIE_AGE = 400 * 24 * 3600;
const out = (o, s = 200, cookie) => { const h = new Headers(H); if (cookie != null) h.append('set-cookie', cookie); return new Response(JSON.stringify(o), {status: s, headers: h}); };
const setCookie = tok => `cpu_key=${tok}; Path=/; Max-Age=${COOKIE_AGE}; HttpOnly; Secure; SameSite=Lax`;
const delCookie = 'cpu_key=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
const cookieOf = (req, name) => { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; };
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rnd = n => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => ALPH[x % ALPH.length]).join(''); };
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);   // senza trattini e spazi
const eqSafe = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
async function store(){ if (globalThis.__CPU_DB) return globalThis.__CPU_DB; const {getStore} = await import('@netlify/blobs'); return getStore({name: 'coach-play-up-chiavi', consistency: 'strong'}); }
async function load(){ const s = await store(); return (await s.get('stato', {type: 'json'})) || {codici: {}, dispositivi: {}, errori: []}; }
async function save(st){ const s = await store(); await s.setJSON('stato', st); }
const short = s => String(s || '').slice(0, 60);
export default async (req) => {
  const admin = process.env.CPU_ADMIN || globalThis.__CPU_ADMIN || '';
  const u = new URL(req.url);
  let body = {}; if (req.method === 'POST'){ try { body = await req.json(); } catch {} }
  const a = body.a || u.searchParams.get('a') || 'stato';
  if (!admin) return out({ok: true, lucchetto: false});
  const me = await verify(cookieOf(req, 'cpu_key'), admin);
  try {
    if (a === 'stato'){
      if (!me) return out({ok: false, attivo: false, lucchetto: true});
      const st = await load(), dv = st.dispositivi[me.d];
      if (me.r !== 'a' && dv && dv.codice && st.codici[dv.codice]?.bloccato) dv.bloccato = true;   // giocatore bloccato: tutti i suoi dispositivi
      // bloccato: l'app non si apre, ma la chiave resta sul dispositivo così con “Sblocca” torna a funzionare senza un codice nuovo
      if (me.r !== 'a' && dv?.bloccato) return out({ok: false, attivo: false, bloccato: true, lucchetto: true});
      if (me.r !== 'a' && !dv) return out({ok: false, attivo: false, lucchetto: true}, 200, delCookie);
      if (dv){ dv.visto = Date.now(); await save(st); }
      return out({ok: true, attivo: true, admin: me.r === 'a', nome: me.n || '', lucchetto: true}, 200, setCookie(await sign(me, admin)));   // la chiave si rinnova a ogni apertura
    }
    if (a === 'esci') return out({ok: true}, 200, delCookie);
    // protezione dai tentativi a raffica: massimo 12 errori in 15 minuti per tutto il sito
    const st = await load(); const now = Date.now(); st.errori = (st.errori || []).filter(t => now - t < 15 * 60e3);
    const tooMany = st.errori.length >= 12;
    const fail = async (msg, s = 403) => { st.errori.push(now); await save(st); return out({ok: false, error: msg}, s); };
    if (a === 'admin'){
      if (tooMany) return out({ok: false, error: 'troppi tentativi: riprova fra 15 minuti'}, 429);
      if (!eqSafe(body.password || '', admin)) return fail('password sbagliata');
      const d = 'adm-' + rnd(10); st.dispositivi[d] = {id: d, nome: 'Croby (proprietario)', admin: true, at: now, ua: short(req.headers.get('user-agent'))}; await save(st);
      return out({ok: true, admin: true}, 200, setCookie(await sign({d, r: 'a', n: 'Croby', i: now}, admin)));
    }
    if (a === 'attiva'){
      if (tooMany) return out({ok: false, error: 'troppi tentativi: riprova fra 15 minuti'}, 429);
      const code = normCode(body.codice), c = st.codici[code];
      if (!c || c.revocato || c.bloccato) return fail('codice non valido');
      if (c.scade && now > c.scade && !c.usi?.length) return fail('codice scaduto: chiedine uno nuovo');
      const usi = c.usi || [];
      if (usi.length && (now - usi[0] > 30 * 60e3 || usi.length >= 2)) return fail('codice già usato: ogni codice vale una volta sola');
      const d = 'dev-' + rnd(10); usi.push(now); c.usi = usi;
      st.dispositivi[d] = {id: d, nome: c.nome || '', codice: code, at: now, ua: short(req.headers.get('user-agent'))}; await save(st);
      return out({ok: true, nome: c.nome || ''}, 200, setCookie(await sign({d, r: 'u', n: c.nome || '', i: now}, admin)));
    }
    // da qui in poi: solo il proprietario
    if (!me || me.r !== 'a') return out({ok: false, error: 'solo il proprietario'}, 403);
    if (a === 'nuovo'){
      const giorni = Math.min(60, Math.max(1, parseInt(body.giorni, 10) || 7));
      let code; do { code = rnd(8); } while (st.codici[code]);
      st.codici[code] = {codice: code, nome: short(body.nome).trim(), creato: now, scade: now + giorni * 864e5, usi: []};
      await save(st);
      return out({ok: true, codice: code.slice(0, 4) + '-' + code.slice(4), scade: st.codici[code].scade, nome: st.codici[code].nome});
    }
    if (a === 'lista'){
      const codici = Object.values(st.codici).sort((x, y) => y.creato - x.creato).slice(0, 200).map(c => ({codice: c.codice.slice(0, 4) + '-' + c.codice.slice(4), nome: c.nome, creato: c.creato, scade: c.scade, usato: (c.usi || []).length > 0, revocato: !!c.revocato, bloccato: !!c.bloccato}));
      const dispositivi = Object.values(st.dispositivi).sort((x, y) => y.at - x.at).slice(0, 300).map(d => ({id: d.id, nome: d.nome, codice: d.codice ? d.codice.slice(0, 4) + '-' + d.codice.slice(4) : '', admin: !!d.admin, at: d.at, visto: d.visto || null, ua: d.ua, bloccato: !!d.bloccato, questo: d.id === me.d}));
      return out({ok: true, codici, dispositivi});
    }
    // blocca / sblocca un giocatore: tutti i dispositivi attivati con il suo codice
    if (a === 'bloccaGiocatore' || a === 'sbloccaGiocatore'){
      const c = st.codici[normCode(body.codice)]; if (!c) return out({ok: false, error: 'codice non trovato'}, 404);
      const on = a === 'bloccaGiocatore'; c.bloccato = on; let n = 0;
      for (const d of Object.values(st.dispositivi)) if (d.codice === c.codice && !d.admin){ d.bloccato = on; n++; }
      await save(st); return out({ok: true, dispositivi: n});
    }
    if (a === 'blocca' || a === 'sblocca'){
      const d = st.dispositivi[body.id]; if (!d) return out({ok: false, error: 'dispositivo non trovato'}, 404);
      if (d.admin) return out({ok: false, error: 'i dispositivi del proprietario non si bloccano da qui'}, 400);
      d.bloccato = a === 'blocca'; await save(st); return out({ok: true});
    }
    if (a === 'annulla'){
      const c = st.codici[normCode(body.codice)]; if (!c) return out({ok: false, error: 'codice non trovato'}, 404);
      c.revocato = true; await save(st); return out({ok: true});
    }
    return out({ok: false, error: 'azione sconosciuta'}, 400);
  } catch (e){ return out({ok: false, error: String(e.message || e)}, 500); }
};
