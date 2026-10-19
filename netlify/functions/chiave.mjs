// Coach Play Up – chiavi di attivazione (Netlify Functions + Netlify Blobs, gratuito).
// Solo il proprietario (password in CPU_ADMIN su Netlify) crea codici; ogni codice si usa UNA volta
// Su iPhone/iPad (Safari e app installata hanno memorie separate) lo stesso codice si può reinserire UNA volta entro 24 ore
// nell'app installata: resta lo stesso dispositivo, con la stessa scadenza.
// Azioni (POST JSON o GET):  stato · attiva {codice} · admin {password} · nuovo {nome, giorni} · lista · blocca {id} · sblocca {id} · esci
// Recensioni e consigli: fbInvia {tipo, stelle, testo} (giocatori attivati) · fbLista · fbSegna {id|tutti, letto, arch} · fbElimina {id} (solo proprietario)
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
// recensioni e consigli dei giocatori: archivio a parte, lo legge solo il proprietario
async function loadFb(){ const s = await store(); return (await s.get('feedback', {type: 'json'})) || {list: []}; }
async function saveFb(fb){ const s = await store(); fb.list = fb.list.slice(-2000); await s.setJSON('feedback', fb); }
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
      // accesso scaduto: l'app si ferma finché Croby non manda un codice nuovo (i dati sul telefono restano)
      if (me.r !== 'a' && dv.fino && Date.now() > dv.fino) return out({ok: false, attivo: false, scaduto: true, fino: dv.fino, nome: dv.nome || me.n || '', lucchetto: true});
      if (dv){ dv.visto = Date.now(); await save(st); }
      const f = me.r === 'a' ? null : (dv?.fino || null);
      let fbNuovi = 0; if (me.r === 'a'){ try { fbNuovi = (await loadFb()).list.filter(x => !x.letto && !x.arch).length; } catch {} }
      const cod = me.r !== 'a' && dv?.codice ? dv.codice.slice(0, 4) + '-' + dv.codice.slice(4) : '';
      return out({ok: true, attivo: true, admin: me.r === 'a', nome: me.n || '', fino: f, codice: cod, fbNuovi, lucchetto: true}, 200, setCookie(await sign({...me, f}, admin)));   // la chiave si rinnova a ogni apertura, con la scadenza aggiornata
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
      const usi = c.usi || [], uaNow = req.headers.get('user-agent') || '';
      const apple = x => /iPhone|iPad|iPod|Macintosh/.test(x || '');   // (nell'elenco l'user-agent è accorciato)
      // iPhone: Safari → app sulla schermata Home (stesso telefono, memorie separate): si riusa lo stesso posto
      const first = usi.length === 1 ? Object.values(st.dispositivi).find(x => x.codice === code && !x.admin) : null;
      const gemello = first && now - usi[0] <= 24 * 3600e3 && apple(first.ua) && apple(uaNow) && !/Android|Windows/.test(uaNow) && !(me && me.d === first.id);
      if (usi.length && !gemello) return fail('codice già usato: ogni codice vale una volta sola');
      usi.push(now); c.usi = usi;
      if (gemello){ first.app = now; first.ua = short(uaNow); await save(st);
        return out({ok: true, nome: c.nome || '', fino: first.fino || null, rinnovo: false, ios: true}, 200, setCookie(await sign({d: first.id, r: 'u', n: c.nome || '', i: now, f: first.fino || null}, admin))); }
      const dur = c.durata ? c.durata * 864e5 : 0;
      // rinnovo: stesso dispositivo già attivato (anche se scaduto) → stesso posto, il tempo nuovo si aggiunge a quello che restava
      const old = me && me.r !== 'a' ? st.dispositivi[me.d] : null;
      let d, fino;
      if (old){ d = me.d; fino = dur ? Math.max(now, old.fino || now) + dur : null; Object.assign(old, {codice: code, nome: c.nome || old.nome || '', fino, rinnovi: (old.rinnovi || 0) + 1, rinnovato: now, bloccato: false}); }
      else { d = 'dev-' + rnd(10); fino = dur ? usi[0] + dur : null; st.dispositivi[d] = {id: d, nome: c.nome || '', codice: code, at: now, fino, ua: short(req.headers.get('user-agent'))}; }
      await save(st);
      return out({ok: true, nome: c.nome || '', fino, rinnovo: !!old}, 200, setCookie(await sign({d, r: 'u', n: c.nome || '', i: now, f: fino}, admin)));
    }
    if (a === 'fbInvia'){
      if (!me) return out({ok: false, error: 'app non attivata'}, 403);
      const dv = st.dispositivi[me.d];
      if (me.r !== 'a' && (!dv || dv.bloccato)) return out({ok: false, error: 'dispositivo non attivo'}, 403);
      const testo = String(body.testo || '').replace(/\s+$/g, '').slice(0, 1500), tipo = ['recensione', 'consiglio', 'problema'].includes(body.tipo) ? body.tipo : 'consiglio';
      const stelle = tipo === 'recensione' ? Math.min(5, Math.max(1, parseInt(body.stelle, 10) || 0)) || null : null;
      if (testo.trim().length < 3 && !stelle) return out({ok: false, error: 'scrivi qualcosa'}, 400);
      const fb = await loadFb(), mine = fb.list.filter(x => x.d === me.d && now - x.at < 864e5);
      if (mine.length >= 5) return out({ok: false, error: 'troppi messaggi oggi: riprova domani'}, 429);
      fb.list.push({id: 'fb-' + rnd(8), at: now, d: me.d, nome: dv?.nome || me.n || '', codice: dv?.codice ? dv.codice.slice(0, 4) + '-' + dv.codice.slice(4) : '', tipo, stelle, testo,
        ver: short(body.ver).slice(0, 12), lang: short(body.lang).slice(0, 4), ua: short(req.headers.get('user-agent')), letto: false, arch: false});
      await saveFb(fb); return out({ok: true});
    }
    // da qui in poi: solo il proprietario
    if (!me || me.r !== 'a') return out({ok: false, error: 'solo il proprietario'}, 403);
    if (a === 'nuovo'){
      const giorni = Math.min(60, Math.max(1, parseInt(body.giorni, 10) || 7));          // tempo per attivarlo
      const durata = Math.min(1095, Math.max(1, parseInt(body.durata, 10) || 30));        // durata dell'accesso dopo l'attivazione
      let code; do { code = rnd(8); } while (st.codici[code]);
      st.codici[code] = {codice: code, nome: short(body.nome).trim(), creato: now, scade: now + giorni * 864e5, durata, usi: []};
      await save(st);
      return out({ok: true, codice: code.slice(0, 4) + '-' + code.slice(4), scade: st.codici[code].scade, durata, nome: st.codici[code].nome});
    }
    if (a === 'lista'){
      const codici = Object.values(st.codici).sort((x, y) => y.creato - x.creato).slice(0, 200).map(c => ({codice: c.codice.slice(0, 4) + '-' + c.codice.slice(4), nome: c.nome, creato: c.creato, scade: c.scade, usato: (c.usi || []).length > 0, revocato: !!c.revocato, bloccato: !!c.bloccato, durata: c.durata || null}));
      const dispositivi = Object.values(st.dispositivi).sort((x, y) => y.at - x.at).slice(0, 300).map(d => ({id: d.id, nome: d.nome, codice: d.codice ? d.codice.slice(0, 4) + '-' + d.codice.slice(4) : '', admin: !!d.admin, at: d.at, visto: d.visto || null, ua: d.ua, bloccato: !!d.bloccato, fino: d.fino || null, rinnovi: d.rinnovi || 0, questo: d.id === me.d}));
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
    if (a === 'fbLista'){ const fb = await loadFb(); return out({ok: true, list: fb.list.slice().reverse()}); }
    if (a === 'fbSegna'){ const fb = await loadFb(), ids = body.tutti ? fb.list.map(x => x.id) : [body.id]; let n = 0;
      for (const x of fb.list) if (ids.includes(x.id)){ if (body.letto != null) x.letto = !!body.letto; if (body.arch != null){ x.arch = !!body.arch; if (x.arch) x.letto = true; } n++; }
      await saveFb(fb); return out({ok: true, n}); }
    if (a === 'fbElimina'){ const fb = await loadFb(), n0 = fb.list.length; fb.list = fb.list.filter(x => x.id !== body.id); await saveFb(fb); return out({ok: true, n: n0 - fb.list.length}); }
    return out({ok: false, error: 'azione sconosciuta'}, 400);
  } catch (e){ return out({ok: false, error: String(e.message || e)}, 500); }
};
