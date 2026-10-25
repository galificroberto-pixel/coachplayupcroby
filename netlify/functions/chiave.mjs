// Coach Play Up – chiavi di attivazione (Netlify Functions + Netlify Blobs, gratuito).
// Solo il proprietario (password in CPU_ADMIN su Netlify) crea codici; ogni codice si usa UNA volta
// Su iPhone/iPad (Safari e app installata hanno memorie separate) lo stesso codice si può reinserire UNA volta entro 24 ore
// nell'app installata: resta lo stesso dispositivo, con la stessa scadenza.
// Azioni (POST JSON o GET):  stato · attiva {codice} · admin {password} · nuovo {nome, giorni} · lista · blocca {id} · sblocca {id} · esci
// Recensioni e consigli: fbInvia {tipo, stelle, testo} (giocatori attivati) · fbLista · fbSegna {id|tutti, letto, arch} · fbElimina {id} · fbEliminaLetti · rinomina {codice, nome} (solo proprietario) · fbMiei · fbEliminaMio {id} (giocatore, solo messaggi già letti)
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
// ogni messaggio è un file a parte (fb/<id>): due giocatori che scrivono insieme, o Croby che segna “letto”
// mentre arriva un messaggio, non possono più cancellarsi a vicenda (prima era un elenco unico riscritto ogni volta)
async function legacyFb(){ const s = await store(); return (await s.get('feedback', {type: 'json'})) || {list: []}; }
async function fbKeys(){ const s = await store(); if (!s.list) return []; const r = await s.list({prefix: 'fb/'}); return (r.blobs || []).map(b => b.key); }
async function loadFb(){
  const s = await store(), old = await legacyFb();
  // trasloco una volta sola dei messaggi del vecchio elenco nei file singoli (niente si perde)
  if (old.list?.length){ for (const x of old.list) if (x?.id && !(await s.get('fb/' + x.id, {type: 'json'}))) await s.setJSON('fb/' + x.id, x); await s.setJSON('feedback', {list: [], spostati: Date.now(), n: old.list.length}); }
  const keys = await fbKeys(), list = (await Promise.all(keys.map(k => s.get(k, {type: 'json'}).catch(() => null)))).filter(Boolean);
  return {list: list.sort((a, b) => a.at - b.at)};
}
async function fbPut(x){ const s = await store(); await s.setJSON('fb/' + x.id, x); }
async function fbDel(id){ const s = await store(); if (s.delete) await s.delete('fb/' + id); }
// ultimo accesso di ogni dispositivo: file a parte, così l'apertura dell'app non riscrive l'elenco di codici e dispositivi
async function setVisto(d){ const s = await store(); const k = 'visto/' + d, v = await s.get(k, {type: 'json'}).catch(() => null); if (!v || Date.now() - v.t > 3600e3) await s.setJSON(k, {t: Date.now()}); }
// tempo di utilizzo: un file per dispositivo (uso/<id>) con i secondi e le aperture di ogni giorno e le sezioni usate
const SEZ = ['home', 'reg', 'oil', 'ana', 'game', 'dati', 'altro'];
async function getUso(d){ const s = await store(); return (await s.get('uso/' + d, {type: 'json'}).catch(() => null)) || {days: {}}; }
function usoSum(u){ const now = Date.now(), day = t => new Date(t).toLocaleDateString('sv-SE', {timeZone: 'Europe/Rome'}), oggi = day(now), d7 = day(now - 6 * 864e5), d30 = day(now - 29 * 864e5);
  const r = {oggi: 0, s7: 0, s30: 0, tot: 0, n7: 0, n30: 0, ntot: 0, giorni30: 0, ultimo: null, sez: {}, g14: {}};
  const d14 = day(now - 13 * 864e5);
  for (const [k, v] of Object.entries(u.days || {})){ const sec = v.s || 0, n = v.n || 0; r.tot += sec; r.ntot += n; if (k === oggi) r.oggi += sec; if (k >= d7){ r.s7 += sec; r.n7 += n; } if (k >= d30){ r.s30 += sec; r.n30 += n; if (sec > 0) r.giorni30++; for (const [t, x] of Object.entries(v.t || {})) r.sez[t] = (r.sez[t] || 0) + x; } if (k >= d14) r.g14[k] = sec; if (sec > 0 && (!r.ultimo || k > r.ultimo)) r.ultimo = k; }
  return r; }
async function getVisto(d){ const s = await store(); return (await s.get('visto/' + d, {type: 'json'}).catch(() => null))?.t || null; }
const short = s => String(s || '').slice(0, 60);
// 💳 crediti Netlify: ogni versione caricata (deploy in produzione) costa 15 crediti. Netlify non dà i crediti rimasti a un'app,
// quindi qui si annota ogni deploy nuovo (la prima volta che il server gira con quella versione) e la lettura scritta da Croby.
const SRV_VER = '4.01';
const SRV_BUILD = '4.01-1e7e824d';   // diverso per ogni zip (anche con la stessa versione): così ogni caricamento si conta
let DEPLOY_OK = false;
async function noteDeploy(context){
  if (DEPLOY_OK) return; DEPLOY_OK = true;
  try {
    const id = String(context?.deploy?.id || process.env.DEPLOY_ID || SRV_BUILD).slice(0, 40), s = await store(), D = (await s.get('crediti', {type: 'json'}).catch(() => null)) || {deploy: [], lettura: null};
    if (D.deploy.some(x => x.id === id)) return;
    D.deploy = [...D.deploy, {id, v: SRV_VER, at: Date.now()}].slice(-120); await s.setJSON('crediti', D);
  } catch {}
}
export default async (req, context) => {
  const admin = process.env.CPU_ADMIN || globalThis.__CPU_ADMIN || '';
  const u = new URL(req.url);
  let body = {}; if (req.method === 'POST'){ try { body = await req.json(); } catch {} }
  const a = body.a || u.searchParams.get('a') || 'stato';
  if (!admin) return out({ok: true, lucchetto: false});
  const me = await verify(cookieOf(req, 'cpu_key'), admin);
  await noteDeploy(context);
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
      if (dv) await setVisto(me.d).catch(() => {});
      const f = me.r === 'a' ? null : (dv?.fino || null);
      let fbNuovi = 0, errNuovi = 0; if (me.r === 'a'){ try { fbNuovi = (await loadFb()).list.filter(x => !x.letto && !x.arch).length; } catch {}
        try { const s = await store(); if (s.list){ const ks = (await s.list({prefix: 'err/'})).blobs.map(b => b.key); errNuovi = (await Promise.all(ks.map(k => s.get(k, {type: 'json'}).catch(() => null)))).filter(x => x && !x.letto).length; } } catch {} }
      const cod = me.r !== 'a' && dv?.codice ? dv.codice.slice(0, 4) + '-' + dv.codice.slice(4) : '';
      return out({ok: true, attivo: true, admin: me.r === 'a', nome: me.n || '', fino: f, codice: cod, fbNuovi, errNuovi, lucchetto: true}, 200, setCookie(await sign({...me, f}, admin)));   // la chiave si rinnova a ogni apertura, con la scadenza aggiornata
    }
    if (a === 'esci') return out({ok: true}, 200, delCookie);
    // 🐞 errori dai telefoni: uno per tipo (stesso messaggio + punto + versione), con il conteggio e chi l'ha avuto
    if (a === 'errLog'){
      const L = Array.isArray(body.list) ? body.list.slice(0, 10) : []; if (!L.length) return out({ok: true, n: 0});
      const s = await store(), ua = short(req.headers.get('user-agent')), now = Date.now();
      let who = '–'; if (me){ if (me.r === 'a') who = 'Croby'; else { try { const st0 = await load(); who = st0.dispositivi[me.d]?.nome || me.n || 'giocatore'; } catch { who = me.n || 'giocatore'; } } }
      let n = 0;
      for (const e of L){
        const msg = String(e.msg || '').slice(0, 300).trim(); if (!msg) continue;
        const where = String(e.where || '').slice(0, 160), ver = String(e.ver || '').slice(0, 12), stack = String(e.stack || '').slice(0, 1500);
        let h = 0; for (const ch of msg + '|' + where + '|' + ver) h = (h * 31 + ch.charCodeAt(0)) | 0; const sig = 'e' + (h >>> 0).toString(36);
        const k = 'err/' + sig, old = await s.get(k, {type: 'json'}).catch(() => null);
        if (!old && s.list && (await s.list({prefix: 'err/'})).blobs.length >= 300) continue;   // tetto: niente spam
        const x = old || {sig, msg, where, ver, stack, first: now, count: 0, chi: [], letto: false};
        x.count += Math.min(Math.max(1, parseInt(e.n, 10) || 1), 50); x.last = now; x.letto = false; if (!x.stack && stack) x.stack = stack;
        const dev = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows|Macintosh|Linux/.test(ua) ? 'PC' : '?', os = String(e.os || '').slice(0, 40);
        const tag = who + ' · ' + (os && os.startsWith(dev === 'iPhone' ? 'iOS' : dev) ? os : dev + (os ? ' ' + os : ''));
        if (!x.chi.includes(tag)) x.chi = [...x.chi, tag].slice(-15);
        x.extra = {tab: String(e.tab || '').slice(0, 10), lang: String(e.lang || '').slice(0, 4), app: !!e.app, scr: String(e.scr || '').slice(0, 12), pagina: String(e.pagina || '').slice(0, 30)};
        await s.setJSON(k, x); n++;
      }
      return out({ok: true, n});
    }
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
      const andr = x => /Android/.test(x || '');
      // stesso telefono, memorie separate: iPhone (Safari → app sulla Home) e Android (WhatsApp → Chrome / app installata), entro 24 ore
      const gemello = first && now - usi[0] <= 24 * 3600e3 && ((apple(first.ua) && apple(uaNow) && !/Android|Windows/.test(uaNow)) || (andr(first.ua) && andr(uaNow))) && !(me && me.d === first.id);
      if (usi.length && !gemello) return fail('codice già usato: ogni codice vale una volta sola');
      usi.push(now); c.usi = usi;
      if (gemello){ first.app = now; first.ua = short(uaNow); await save(st);
        return out({ok: true, nome: c.nome || '', fino: first.fino || null, rinnovo: false, ios: true}, 200, setCookie(await sign({d: first.id, r: 'u', n: c.nome || '', i: now, f: first.fino || null}, admin))); }
      const dur = c.durata ? c.durata * 864e5 : 0;
      // rinnovo: stesso dispositivo già attivato (anche se scaduto) → stesso posto, il tempo nuovo si aggiunge a quello che restava
      const old = me && me.r !== 'a' ? st.dispositivi[me.d] : null;
      let d, fino;
      if (old){ d = me.d; fino = dur ? Math.max(now, old.fino || now) + dur : null; Object.assign(old, {codice: code, nome: c.nome || old.nome || '', fino, rinnovi: (old.rinnovi || 0) + 1, rinnovato: now, bloccato: false}); }
      else { d = 'dev-' + rnd(10); fino = c.reset && c.reset.fino && c.reset.fino > now ? c.reset.fino : dur ? usi[0] + dur : null; st.dispositivi[d] = {id: d, nome: c.nome || '', codice: code, at: now, fino, ua: short(req.headers.get('user-agent'))}; }
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
      // stesso messaggio rimandato (es. dalla coda senza internet): non si duplica
      const cid = /^[A-Za-z0-9-]{6,40}$/.test(body.cid || '') ? 'fb-' + body.cid : null;
      if (cid){ const s = await store(); if (await s.get('fb/' + cid, {type: 'json'})) return out({ok: true, id: cid, gia: true}); }
      const fb = await loadFb(), mine = fb.list.filter(x => x.d === me.d && now - x.at < 864e5);
      if (mine.length >= 20) return out({ok: false, error: 'troppi messaggi oggi: riprova domani'}, 429);
      const id = cid || 'fb-' + rnd(8);
      await fbPut({id, at: Number(body.at) > now - 30 * 864e5 && Number(body.at) <= now ? Number(body.at) : now, d: me.d, nome: dv?.nome || me.n || '', codice: dv?.codice ? dv.codice.slice(0, 4) + '-' + dv.codice.slice(4) : '', tipo, stelle, testo,
        ver: short(body.ver).slice(0, 12), lang: short(body.lang).slice(0, 4), ua: short(req.headers.get('user-agent')), letto: false, arch: false, ricevuto: now});
      return out({ok: true, id});
    }
    if (a === 'uso'){
      if (!me || me.r === 'a') return out({ok: true, skip: true});
      const dv = st.dispositivi[me.d]; if (!dv || dv.bloccato) return out({ok: false, error: 'dispositivo non attivo'}, 403);
      const s = await store(), u = await getUso(me.d);
      // stesso pacchetto rimandato (risposta persa): non si conta due volte
      const bid = /^[A-Za-z0-9-]{6,40}$/.test(body.id || '') ? body.id : null; u.ids ||= [];
      if (bid && u.ids.includes(bid)) return out({ok: true, gia: true});
      const oggi = new Date(now + 16 * 3600e3).toISOString().slice(0, 10);   // il giorno del telefono (anche fusi orari avanti, es. Filippine)
      const B = body.buf && typeof body.buf === 'object' ? body.buf : {}; let add = 0;
      for (const [k, v] of Object.entries(B).slice(0, 40)){
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k > oggi || k < new Date(now - 60 * 864e5).toISOString().slice(0, 10)) continue;
        const D = (u.days[k] ||= {s: 0, n: 0, t: {}}), sec = Math.min(Math.max(0, parseInt(v.s, 10) || 0), 20 * 3600), n = Math.min(Math.max(0, parseInt(v.n, 10) || 0), 200);
        D.s = Math.min(D.s + sec, 24 * 3600); D.n += n; add += sec;
        for (const [t, x] of Object.entries(v.t || {})){ const tk = SEZ.includes(t) ? t : 'altro'; D.t[tk] = (D.t[tk] || 0) + Math.min(Math.max(0, parseInt(x, 10) || 0), 20 * 3600); }
      }
      if (bid){ u.ids.push(bid); u.ids = u.ids.slice(-40); }
      const keys = Object.keys(u.days).sort(); while (keys.length > 400) delete u.days[keys.shift()];
      await s.setJSON('uso/' + me.d, u); return out({ok: true, add});
    }
    // il giocatore vede i suoi messaggi (con “letto da Croby”) e può togliere quelli già letti
    if (a === 'fbMiei' || a === 'fbEliminaMio'){
      if (!me || me.r === 'a') return out({ok: false, error: 'app non attivata'}, 403);
      const fb = await loadFb(), mine = fb.list.filter(x => x.d === me.d);
      if (a === 'fbEliminaMio'){ const x = mine.find(y => y.id === body.id); if (!x) return out({ok: false, error: 'messaggio non trovato'}, 404); if (!x.letto && !x.arch) return out({ok: false, error: 'non ancora letto da Croby'}, 400); await fbDel(x.id); return out({ok: true}); }
      return out({ok: true, list: mine.slice().reverse().slice(0, 30).map(x => ({id: x.id, at: x.at, tipo: x.tipo, stelle: x.stelle, testo: String(x.testo || '').slice(0, 200), letto: !!(x.letto || x.arch)}))});
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
    // crediti tolti a mano da Croby (es. consumi che vede su Netlify) e costo di ogni versione caricata
    if (a === 'creditiTogli' || a === 'creditiCosto' || a === 'creditiAnnulla'){
      const s = await store(), D = (await s.get('crediti', {type: 'json'}).catch(() => null)) || {deploy: [], lettura: null};
      if (a === 'creditiTogli'){ const n = Math.round(+body.n); if (!(n > 0 && n <= 100000)) return out({ok: false, error: 'numero non valido'}, 400); D.manuali = [...(D.manuali || []), {n, at: now, nota: short(body.nota)}].slice(-100); }
      if (a === 'creditiAnnulla') D.manuali = (D.manuali || []).filter(x => x.at !== +body.at);
      if (a === 'creditiCosto'){ const co = Math.round(+body.costo); if (!(co >= 0 && co <= 10000)) return out({ok: false, error: 'numero non valido'}, 400); D.lettura = {...(D.lettura || {n: 300, at: now, totale: 300}), costo: co}; }
      await s.setJSON('crediti', D); return out({ok: true, ...D, ora: now, ver: SRV_VER});
    }
    if (a === 'crediti' || a === 'creditiSalva'){
      const s = await store(), D = (await s.get('crediti', {type: 'json'}).catch(() => null)) || {deploy: [], lettura: null};
      if (a === 'creditiSalva'){
        const n = Math.round(+body.n), g = Math.round(+body.giorno || 0), tot = Math.round(+body.totale || 300), co = Math.round(+body.costo || 15);
        if (!(n >= 0 && n <= 100000)) return out({ok: false, error: 'numero non valido'}, 400);
        D.lettura = {n, at: now, giorno: g >= 1 && g <= 31 ? g : null, totale: tot >= 1 && tot <= 100000 ? tot : 300, costo: co >= 0 && co <= 10000 ? co : 15}; D.manuali = []; await s.setJSON('crediti', D);
      }
      return out({ok: true, ...D, ora: now, ver: SRV_VER});
    }
    if (a === 'lista'){
      const VISTO = {}, USO = {}; await Promise.all(Object.keys(st.dispositivi).slice(0, 400).map(async id => { VISTO[id] = await getVisto(id); if (!st.dispositivi[id].admin) USO[id] = usoSum(await getUso(id)); }));
      const codici = Object.values(st.codici).sort((x, y) => y.creato - x.creato).slice(0, 200).map(c => ({codice: c.codice.slice(0, 4) + '-' + c.codice.slice(4), nome: c.nome, creato: c.creato, scade: c.scade, usato: (c.usi || []).length > 0, revocato: !!c.revocato, bloccato: !!c.bloccato, durata: c.durata || null}));
      const dispositivi = Object.values(st.dispositivi).sort((x, y) => y.at - x.at).slice(0, 300).map(d => ({id: d.id, nome: d.nome, codice: d.codice ? d.codice.slice(0, 4) + '-' + d.codice.slice(4) : '', admin: !!d.admin, at: d.at, visto: VISTO[d.id] || d.visto || null, uso: USO[d.id] || null, ua: d.ua, bloccato: !!d.bloccato, fino: d.fino || null, rinnovi: d.rinnovi || 0, questo: d.id === me.d}));
      return out({ok: true, codici, dispositivi});
    }
    // blocca / sblocca un giocatore: tutti i dispositivi attivati con il suo codice
    if (a === 'bloccaGiocatore' || a === 'sbloccaGiocatore'){
      const c = st.codici[normCode(body.codice)]; if (!c) return out({ok: false, error: 'codice non trovato'}, 404);
      const on = a === 'bloccaGiocatore'; c.bloccato = on; let n = 0;
      for (const d of Object.values(st.dispositivi)) if (d.codice === c.codice && !d.admin){ d.bloccato = on; n++; }
      await save(st); return out({ok: true, dispositivi: n});
    }
    // elimina un giocatore: tolti tutti i suoi dispositivi (sul telefono l'app torna alla pagina del codice; i suoi dati restano lì).
    // riattiva: lo STESSO codice torna valido (7 giorni per usarlo) e la scadenza dell'accesso resta quella di prima
    if (a === 'eliminaGiocatore'){
      const code = normCode(body.codice), c = st.codici[code]; if (!c) return out({ok: false, error: 'codice non trovato'}, 404);
      let n = 0, fino = 0; const s = await store();
      for (const d of Object.values(st.dispositivi)) if (d.codice === code && !d.admin){ fino = Math.max(fino, d.fino || 0); delete st.dispositivi[d.id]; n++; if (s.delete){ s.delete('visto/' + d.id).catch(() => {}); } }
      if (body.riattiva){ Object.assign(c, {usi: [], bloccato: false, revocato: false, scade: now + 7 * 864e5, reset: {fino: fino || null, at: now}}); }
      else delete st.codici[code];
      await save(st);
      return out({ok: true, dispositivi: n, riattiva: !!body.riattiva, codice: code.slice(0, 4) + '-' + code.slice(4), nome: c.nome || '', scade: c.scade, durata: c.durata || null, fino: fino || null});
    }
    if (a === 'eliminaDispositivo'){
      const d = st.dispositivi[body.id]; if (!d) return out({ok: false, error: 'dispositivo non trovato'}, 404);
      if (d.admin && d.id === me.d) return out({ok: false, error: 'non puoi eliminare questo dispositivo mentre lo usi'}, 400);
      delete st.dispositivi[body.id]; await save(st); return out({ok: true});
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
    if (a === 'errLista' || a === 'errSegna' || a === 'errElimina'){
      const s = await store(), keys = s.list ? (await s.list({prefix: 'err/'})).blobs.map(b => b.key) : [];
      const all = (await Promise.all(keys.map(k => s.get(k, {type: 'json'}).catch(() => null)))).filter(Boolean);
      if (a === 'errLista') return out({ok: true, list: all.sort((x, y) => y.last - x.last)});
      const ids = body.tutti ? all.map(x => x.sig) : [body.sig]; let n = 0;
      for (const x of all) if (ids.includes(x.sig)){ if (a === 'errElimina'){ if (s.delete) await s.delete('err/' + x.sig); } else { x.letto = body.letto !== false; await s.setJSON('err/' + x.sig, x); } n++; }
      return out({ok: true, n});
    }
    if (a === 'fbLista'){ const fb = await loadFb(); return out({ok: true, list: fb.list.slice().reverse()}); }
    // si cambia solo il messaggio toccato: un messaggio appena arrivato non viene mai sovrascritto
    if (a === 'fbSegna'){ const fb = await loadFb(), ids = body.tutti ? fb.list.filter(x => !x.letto).map(x => x.id) : [body.id]; let n = 0;
      for (const x of fb.list) if (ids.includes(x.id)){ if (body.letto != null) x.letto = !!body.letto; if (body.arch != null){ x.arch = !!body.arch; if (x.arch) x.letto = true; } await fbPut(x); n++; }
      return out({ok: true, n}); }
    if (a === 'fbEliminaLetti'){ const fb = await loadFb(); let n = 0; for (const x of fb.list) if (x.letto && !x.arch){ await fbDel(x.id); n++; } return out({ok: true, n}); }
    // rinomina un giocatore: nome sul codice, sui suoi dispositivi e sui suoi messaggi
    if (a === 'rinomina'){
      const code = normCode(body.codice), c = st.codici[code], nome = short(body.nome).trim(); if (!c) return out({ok: false, error: 'codice non trovato'}, 404); if (!nome) return out({ok: false, error: 'scrivi il nome'}, 400);
      c.nome = nome; const ids = []; for (const d of Object.values(st.dispositivi)) if (d.codice === code && !d.admin){ d.nome = nome; ids.push(d.id); }
      await save(st);
      try { const fb = await loadFb(); for (const x of fb.list) if (ids.includes(x.d) && x.nome !== nome){ x.nome = nome; await fbPut(x); } } catch {}
      return out({ok: true, nome, dispositivi: ids.length});
    }
    // cambia la scadenza di un giocatore attivo (tutti i suoi dispositivi): una data, oppure null = senza scadenza
    if (a === 'scadenza'){
      const code = normCode(body.codice), c = st.codici[code]; if (!c) return out({ok: false, error: 'codice non trovato'}, 404);
      const fino = body.fino == null ? null : Math.round(+body.fino); if (fino != null && !(fino > 0)) return out({ok: false, error: 'data non valida'}, 400);
      let n = 0; for (const d of Object.values(st.dispositivi)) if (d.codice === code && !d.admin){ d.fino = fino; d.cambiata = now; n++; }
      if (!n) return out({ok: false, error: 'nessun dispositivo attivo per questo giocatore'}, 404);
      await save(st); return out({ok: true, fino, dispositivi: n});
    }
    if (a === 'fbElimina'){ const fb = await loadFb(), x = fb.list.find(y => y.id === body.id); if (x) await fbDel(x.id); return out({ok: true, n: x ? 1 : 0}); }
    return out({ok: false, error: 'azione sconosciuta'}, 400);
  } catch (e){ return out({ok: false, error: String(e.message || e)}, 500); }
};
