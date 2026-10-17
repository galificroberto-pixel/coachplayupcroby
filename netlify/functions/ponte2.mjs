// Coach Play Up – "ponte" verso internet (Netlify Functions, gratuito).
// Va SOLO su siti di bowling affidabili (elenco qui sotto), legge il testo delle pagine e lo restituisce all'app.
// Azioni:  ?a=ping  ·  ?a=search&q=...&site=bowwwl.com  ·  ?a=page&url=https://...  ·  ?a=kegel&ids=1,2,3 (schede Kegel Pattern Library)
const SITES = [
  // archivi e riviste specializzate
  'bowwwl.com', 'bowlingthismonth.com', 'nationalbowlingacademy.com', 'bowlingball.com', 'bowling.com',
  // oliatura (Kegel)
  'kegel.net', 'patternlibrary.kegel.net',
  // produttori di palle
  'stormbowling.com', 'rotogrip.com', '900global.com', 'brunswickbowling.com', 'ebonite.com', 'hammerbowling.com',
  'trackbowling.com', 'columbia300.com', 'radicalbowling.com', 'dv8bowling.com', 'motivbowling.com', 'swagbowling.com', 'mkkbowling.com',
  // regolamenti ufficiali
  'fisbb.it', 'bowl.com', 'worldbowling.org', 'ebf-bowling.org'
];
const okHost = h => SITES.some(s => h === s || h.endsWith('.' + s));
const UA = 'Mozilla/5.0 (compatible; CoachPlayUp/1.0; +https://www.netlify.com)';
const H = {'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store, max-age=0', 'netlify-cdn-cache-control': 'no-store', 'cdn-cache-control': 'no-store'};
const out = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: H});
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
// HTML → testo leggibile, tenendo righe di tabella e celle separate da " | "
function toText(html){
  return decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ').replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/dt|\/dd)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({href: decode(m[1]), text: toText(m[2]).slice(0, 120)}));
async function get(url, binary, ms = 12000){
  const r = await fetch(url, {headers: {'user-agent': UA, 'accept-language': 'it,en;q=0.8'}, redirect: 'follow', signal: AbortSignal.timeout(ms)});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return binary ? r : r.text();
}
async function webSearch(query){
  const res = [], seen = new Set(), add = (href, title) => { try { const h = new URL(href).hostname.replace(/^www\./, ''); if (okHost(h) && !seen.has(href)){ seen.add(href); res.push({url: href, title: toText(title || ''), site: h}); } } catch {} };
  let motore = '';
  // 1) DuckDuckGo (versione HTML)
  try {
    const html = await get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
    for (const m of html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){
      let href = decode(m[1]); const k = href.match(/[?&]uddg=([^&]+)/); if (k) href = decodeURIComponent(k[1]);
      add(href, m[2]); if (res.length >= 8) break;
    }
    if (res.length) motore = 'duckduckgo';
  } catch {}
  // 2) se DuckDuckGo non risponde: Bing (formato RSS)
  if (!res.length){
    try {
      const xml = await get('https://www.bing.com/search?format=rss&count=20&q=' + encodeURIComponent(query));
      for (const m of xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>/gi)){ add(decode(m[2].trim()), decode(m[1])); if (res.length >= 8) break; }
      if (res.length) motore = 'bing';
    } catch {}
  }
  return {res, motore};
}
// scheda di un pattern della Kegel Pattern Library → dati compatti
function kegelParse(html, id){
  const name = toText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  if (!name || /not\s*found|error/i.test(name)) return null;
  const t = toText(html).replace(/\s*\|\s*/g, '\n');
  const num = re => { const m = t.match(re); return m ? +m[1] : null; };
  const o = {id: +id, n: name.slice(0, 120),
    l: num(/DISTANCE\s*:?\s*(\d{2}(?:\.\d+)?)/i), r: num(/RATIO\s*:?\s*(\d{1,2}(?:\.\d+)?)\s*:\s*1/i), v: num(/VOLUME\s*:?\s*(\d{1,2}(?:\.\d+)?)/i),
    f: num(/FORWARD\s*:?\s*(\d{1,2}(?:\.\d+)?)/i), b: num(/REVERSE\s*:?\s*(\d{1,2}(?:\.\d+)?)/i), p: num(/PUMP\s*:?\s*(\d{2,3})/i), d: num(/DROP\s*BRUSH\s*:?\s*(\d{1,2})/i)};
  const tk = t.match(/TANKS?\s*:?\s*([A-Za-z][A-Za-z0-9 &+\-]{0,30})/i); if (tk) o.t = tk[1].trim().split(/\s{2,}|\n/)[0];
  // categoria: la riga breve subito dopo il titolo
  const i = t.indexOf(name.slice(0, 30)); if (i >= 0){ const nx = t.slice(i + name.length).split('\n').map(x => x.trim()).filter(Boolean)[0] || ''; if (nx.length < 50 && !/DISTANCE|RATIO|VOLUME|:/.test(nx)) o.c = nx; }
  if (/REVERSE\s*DROP\s*BRUSH/i.test(t)) o.rdb = 1;
  if (o.l == null && o.v == null) return null;
  for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
  return o;
}
const slug = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export default async (req) => {
  const u = new URL(req.url), a = u.searchParams.get('a') || 'ping';
  try {
    if (a === 'ping') return out({ok: true, ponte: 2, siti: SITES});
    if (a === 'search'){
      const q = (u.searchParams.get('q') || '').slice(0, 160), site = u.searchParams.get('site') || '';
      if (!q) return out({error: 'q'}, 400);
      const sites = site ? site.split(',').filter(okHost) : [];
      const query = sites.length ? `${q} ${sites.map(s => 'site:' + s).join(' OR ')}` : q;
      const {res, motore} = await webSearch(query);
      return out({ok: true, q: query, motore, results: res});
    }
    // foto e scheda di una palla dall'archivio Bowwwl: prima l'indirizzo diretto, poi la ricerca
    if (a === 'ballimg'){
      const brand = (u.searchParams.get('brand') || '').slice(0, 60), model = (u.searchParams.get('model') || '').slice(0, 80);
      if (!model) return out({error: 'model'}, 400);
      let page = `https://www.bowwwl.com/bowling-ball-database/${slug(brand)}/${slug(model)}`, html = '';
      try { html = await get(page); } catch {}
      if (!/og:image/i.test(html)){
        const {res} = await webSearch(`${brand} ${model} site:bowwwl.com`);
        const hit = res.find(r => /\/bowling-ball-database\/[^/]+\/[^/?#]+/.test(r.url));
        if (!hit) return out({error: 'foto non trovata'}, 404);
        page = hit.url; html = await get(page);
      }
      const og = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1];
      if (!og) return out({error: 'foto non trovata'}, 404);
      const imgUrl = new URL(decode(og), page).href;
      if (!okHost(new URL(imgUrl).hostname.replace(/^www\./, ''))) return out({error: 'sito non ammesso'}, 403);
      const r = await get(imgUrl, true), ct = r.headers.get('content-type') || 'image/png';
      if (!/^image\//i.test(ct)) return out({error: 'non è un’immagine'}, 415);
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 2.5e6) return out({error: 'immagine troppo grande'}, 413);
      const title = toText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      return out({ok: true, page, imgUrl, type: ct, img: buf.toString('base64'), title, text: toText(html).slice(0, 20000), fetched: new Date().toISOString()});
    }
    // tanti pattern Kegel insieme (fino a 25 per volta), letti in parallelo: per l'archivio completo nell'app
    if (a === 'kegel'){
      const ids = (u.searchParams.get('ids') || '').split(',').map(x => parseInt(x, 10)).filter(x => x > 0 && x < 100000).slice(0, 25);
      if (!ids.length) return out({error: 'ids'}, 400);
      const res = await Promise.all(ids.map(async id => { try { return kegelParse(await get('https://patternlibrary.kegel.net/pattern/' + id, false, 7000), id) || {id, x: 1}; } catch (e){ return {id, x: /404/.test(e.message) ? 1 : 2}; } }));
      return out({ok: true, patterns: res.filter(r => !r.x), missing: res.filter(r => r.x === 1).map(r => r.id), failed: res.filter(r => r.x === 2).map(r => r.id), fetched: new Date().toISOString()});
    }
    if (a === 'page'){
      const target = new URL(u.searchParams.get('url') || '');
      if (!/^https?:$/.test(target.protocol) || !okHost(target.hostname.replace(/^www\./, ''))) return out({error: 'sito non ammesso'}, 403);
      const r = await get(target.href, true), ct = r.headers.get('content-type') || '';
      if (/pdf/i.test(ct)){ const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 6e6) return out({error: 'pdf troppo grande'}, 413); return out({ok: true, url: target.href, pdf: buf.toString('base64'), fetched: new Date().toISOString()}); }
      const html = await r.text();
      const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const mod = r.headers.get('last-modified') || (html.match(/"dateModified"\s*:\s*"([^"]+)"/) || [])[1] || '';
      return out({ok: true, url: target.href, title: toText(title), modified: mod, fetched: new Date().toISOString(), text: toText(html).slice(0, 60000),
        links: links(html).filter(l => { try { return okHost(new URL(l.href, target).hostname.replace(/^www\./, '')); } catch { return false; } }).map(l => ({...l, href: new URL(l.href, target).href})).slice(0, 200)});
    }
    return out({error: 'azione sconosciuta'}, 400);
  } catch (e){ return out({error: String(e.message || e)}, 502); }
};
