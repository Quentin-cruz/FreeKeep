// Source officielle Steam : recherche des jeux à -100 % (gratuits à garder).
import { ENDPOINTS } from '../config.js';
import { fetchJson, decodeEntities } from '../util.js';

export async function fetchSteam() {
  const params = new URLSearchParams({
    query: '', start: '0', count: '50', maxprice: 'free', specials: '1',
    category1: '998', // jeux uniquement (pas de DLC / bandes-son)
    infinite: '1', ndl: '1', cc: 'fr', l: 'french',
  });
  const data = await fetchJson(`${ENDPOINTS.steamSearch}?${params}`);
  if (!data || typeof data.results_html !== 'string') throw new Error('réponse Steam inattendue');
  return parseSteamSearch(data.results_html);
}

export function parseSteamSearch(html) {
  const out = [];
  const seen = new Set();
  const rowRe = /<a\b[^>]*\bhref="https:\/\/store\.steampowered\.com\/app\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const [, appid, body] = m;
    if (seen.has(appid)) continue;
    const title = decodeEntities(/<span class="title">([\s\S]*?)<\/span>/.exec(body)?.[1] || '').trim();
    if (!title) continue;
    const discount = Number(
      /data-discount="(\d+)"/.exec(body)?.[1] ?? /discount_pct">\s*-(\d+)\s*%/.exec(body)?.[1] ?? NaN,
    );
    const finalPrice = /data-price-final="(\d+)"/.exec(body)?.[1];
    const isFree = discount === 100 || (finalPrice === '0' && discount > 0);
    if (!isFree) continue;
    seen.add(appid);

    const capsule = /<img[^>]+src="([^"]+)"/.exec(body)?.[1] || '';
    const original = /discount_original_price">([^<]+)</.exec(body)?.[1];
    out.push({
      source: 'steam',
      store: 'steam',
      appid,
      title,
      url: `https://store.steampowered.com/app/${appid}/`,
      images: steamImages(appid, capsule),
      start: null,
      end: null, // Steam n'expose pas la date de fin ici (GamerPower la complète souvent)
      status: 'active',
      worth: original ? decodeEntities(original).trim() : null,
    });
  }
  return out;
}

function steamImages(appid, capsule) {
  const urls = [];
  if (capsule) {
    const clean = capsule.split('?')[0];
    urls.push(clean.replace(/capsule_[^/]+\.jpg$/, 'header.jpg'));
  }
  urls.push(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`);
  if (capsule) urls.push(capsule);
  return [...new Set(urls)];
}
