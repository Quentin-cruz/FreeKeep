// Jeux voulus : les meilleures ventes Steam en promo, puis leur meilleur prix sur 30+ stores (CheapShark).
// On part de ce que les joueurs achètent, pas de la remise : sinon les jeux de 2011 à -95 % passent devant.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';
import { fetchSteamItems } from './steamstore.js';
import { CHEAPSHARK_STORES, platformOf, dealLink, steamHeaderImages } from './cheapshark.js';

const PAGES = 3;
const PAGE = 100;
const LOOKUP = 25;       // jeux par requête CheapShark
const MAX_LOOKUP = 125;
const LOWS = 50;         // plus bas historiques demandés
const FLOOR = { discount: 20, rating: 70, reviews: 400 }; // au plus large : le tri fin vient ensuite
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Identifiants Steam dans l'ordre des ventes (jeux seuls, pas les bundles). */
export function parseTopSellers(html) {
  const ids = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*\bhref="https:\/\/store\.steampowered\.com\/app\/(\d+)/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

const worthIt = (it) => !!it?.game && it.price > 0 && it.normal > 0 && it.discount >= FLOOR.discount && (it.rating ?? 0) >= FLOOR.rating && it.reviews >= FLOOR.reviews;

/**
 * @param ids    ordre des ventes
 * @param items  fiches Steam
 * @param offers offres CheapShark (dollars)
 */
export function buildWanted(ids, items, offers = [], settings = {}) {
  const byApp = new Map();
  for (const o of offers) {
    if (!o?.steamAppID || !(Number(o.salePrice) > 0) || !(Number(o.normalPrice) > 0)) continue;
    const id = String(o.steamAppID);
    if (!byApp.has(id)) byApp.set(id, []);
    byApp.get(id).push(o);
  }
  const allowed = (platform) => !settings.stores || !!settings.stores[platform];
  const out = [];
  for (const id of ids) {
    const it = items[id];
    if (!worthIt(it)) continue;
    const found = {};
    if (allowed('steam')) {
      found.steam = { price: it.price, normalPrice: it.normal, discount: it.discount, merchant: 'Steam', url: `https://store.steampowered.com/app/${id}/`, currency: 'EUR', approx: false, end: it.end };
    }
    let gameID = null;
    let lowestUsd = null;
    for (const o of byApp.get(id) || []) {
      const usd = Number(o.salePrice);
      gameID = o.gameID;
      lowestUsd = lowestUsd == null ? usd : Math.min(lowestUsd, usd);
      const platform = platformOf(o);
      if (String(o.storeID) === '1' || !allowed(platform)) continue;
      // Même remise appliquée au vrai prix en euros : plus juste qu'une conversion du dollar.
      const price = Math.round(it.normal * (usd / Number(o.normalPrice)) * 100) / 100;
      const discount = Math.round((1 - price / it.normal) * 100);
      const prev = found[platform];
      if (discount < FLOOR.discount || (prev && price > prev.price * 0.97)) continue; // à peine moins cher qu'un prix exact
      found[platform] = { price, normalPrice: it.normal, discount, merchant: CHEAPSHARK_STORES[o.storeID] || 'Store PC', url: dealLink(o.dealID), currency: 'EUR', approx: true, end: null };
    }
    const best = Object.entries(found).sort(([, a], [, b]) => a.price - b.price)[0];
    if (!best) continue;
    out.push({
      id: `st:${id}`,
      source: 'wanted',
      section: 'pc',
      channel: 'official',
      title: it.name,
      // Jeux récents : l'image a une adresse à part chez Steam
      images: [...new Set([it.header, ...steamHeaderImages(id)].filter(Boolean))],
      ...best[1],
      platform: best[0],
      offers: found,
      rating: { steam: it.rating, steamCount: it.reviews, metacritic: null, steamText: null },
      steamAppID: id,
      released: it.released,
      posted: null,
      flags: {},
      gameID,
      lowestUsd,
    });
  }
  return out;
}

export function applyLows(items, games) {
  for (const d of items) {
    const low = Number(games?.[d.gameID]?.cheapestPriceEver?.price);
    if (d.lowestUsd != null && low > 0 && d.lowestUsd <= low + 0.005) d.flags.historicLow = true;
  }
}

export async function fetchWanted(settings, { cheapshark = true } = {}) {
  const ids = [];
  for (let page = 0; page < PAGES; page++) {
    const params = new URLSearchParams({
      query: '', start: String(page * PAGE), count: String(PAGE), specials: '1', filter: 'topsellers', category1: '998', infinite: '1', ndl: '1', cc: 'fr', l: 'french',
    });
    try {
      const data = await fetchJson(`${ENDPOINTS.steamSearch}?${params}`);
      if (typeof data?.results_html !== 'string') throw new Error('réponse Steam inattendue');
      const got = parseTopSellers(data.results_html).filter((id) => !ids.includes(id));
      if (!got.length) break;
      ids.push(...got);
    } catch (e) {
      if (!ids.length) throw e;
      break; // les premières pages suffisent
    }
    await pause(400);
  }
  if (!ids.length) throw new Error('aucune meilleure vente trouvée');
  const items = await fetchSteamItems(ids, { release: true, assets: true });
  const wanted = ids.filter((id) => worthIt(items[id])).slice(0, MAX_LOOKUP);
  const offers = [];
  if (cheapshark) {
    try {
      for (let i = 0; i < wanted.length; i += LOOKUP) {
        const params = new URLSearchParams({ onSale: '1', pageSize: '60', steamAppID: wanted.slice(i, i + LOOKUP).join(',') });
        const res = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${params}`);
        if (Array.isArray(res)) offers.push(...res);
        await pause(700);
      }
    } catch (e) {
      console.warn('[FreeKeep] prix des jeux voulus :', e); // le prix Steam suffit
    }
  }
  const out = buildWanted(ids, items, offers, settings);
  try {
    const known = out.filter((d) => d.gameID).slice(0, LOWS);
    for (let i = 0; i < known.length; i += LOOKUP) {
      applyLows(out, await fetchJson(`${ENDPOINTS.cheapsharkGames}?ids=${known.slice(i, i + LOOKUP).map((d) => d.gameID).join(',')}`));
      await pause(700);
    }
  } catch (e) {
    console.warn('[FreeKeep] plus bas historiques :', e);
  }
  return { items: out, ranks: Object.fromEntries(ids.map((id, i) => [id, i + 1])) };
}
