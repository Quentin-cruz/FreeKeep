// NEXARDA (nexarda.com) : comparateur de prix avec une API publique, sans compte ni clé.
// Sert à la recherche ciblée : pour chaque promo PC affichée, le meilleur prix sur les sites de clés
// (G2A, Kinguin, Eneba, Gamivo, K4G, Instant Gaming, HRK, Driffle, Loaded…), en euros, code promo compris.
// Leurs conditions : garder leurs liens de redirection tels quels.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';

const DAY = 24 * 3600 * 1000;
const NX_LIMITS = {
  perRun: 16,            // appels par vérification, soit ~1 par minute (NEXARDA bloque les IP trop pressées)
  pause: 700,            // ms entre deux appels
  priceTtl: 6 * 3600e3,  // un prix de clé est relu au plus toutes les 6 h
  foundTtl: 30 * DAY,    // numéro NEXARDA d'un jeu Steam
  missTtl: 3 * DAY,      // jeu absent du catalogue : on réessaie dans 3 jours
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Vendeurs « marketplace » qui vendent surtout des objets physiques ou d'occasion : pas des clés de jeux.
const NOT_KEYSHOP = /^(amazon|ebay|aliexpress|temu|cex|back market|facebook marketplace|gumtree|newegg|onbuy|musicmagpie|itemku)$/i;
const GOOD_REGION = /^(global|europe|eu|france|world ?wide)$/i;

/** Réponse de /api/v3/find?steam=… → numéro NEXARDA, ou null si le jeu n'y est pas. */
export function parseNexardaFind(data) {
  if (data?.code === 'game_not_found') return null;
  const id = data?.success ? Number(data.game?.id) : NaN;
  if (!(id > 0)) throw new Error(data?.message || 'réponse NEXARDA inattendue');
  return id;
}

/**
 * Réponse de /api/v3/prices → meilleure clé Steam (édition standard, Europe ou monde), ou null.
 * Le prix NEXARDA inclut déjà le code promo éventuel : on garde le code pour l'afficher.
 */
export function parseNexardaPrices(data) {
  if (data?.code && /not_found/.test(data.code)) return null;
  const list = data?.prices?.list;
  if (!data?.success || !Array.isArray(list)) throw new Error(data?.message || 'réponse NEXARDA inattendue');
  if (data.prices.currency && data.prices.currency !== 'EUR') throw new Error(`prix NEXARDA en ${data.prices.currency}`);
  const keys = list.filter((o) => o?.available && o.price > 0 && o.platform === 'Steam' && GOOD_REGION.test(o.region || '')
    && o.store && !o.store.official && /^(marketplace|key seller)$/i.test(o.store.type || '') && !NOT_KEYSHOP.test(o.store.name || ''));
  const standard = keys.filter((o) => /^standard( edition)?$/i.test(o.edition || ''));
  const pool = standard.length ? standard : keys.filter((o) => !/deluxe|ultimate|gold|premium|collector|bundle|season pass|dlc/i.test(o.edition || ''));
  const best = pool.sort((a, b) => a.price - b.price)[0];
  if (!best) return null;
  return {
    keyshop: Math.round(best.price * 100) / 100,
    currency: 'EUR',
    url: best.url,
    merchant: best.store.name,
    code: best.coupon?.available && best.coupon.code ? best.coupon.code : null,
    shops: new Set(keys.map((o) => o.store.name)).size,
  };
}

/**
 * Cherche le meilleur prix « clé » des jeux Steam donnés, quelques-uns à chaque vérification.
 * @param appids  jeux à suivre, les plus importants d'abord
 * @param cache   { ids: { [appid]: { id, at } }, prices: { [appid]: { best, at } } } (modifié en place)
 * @returns { [appid]: { keyshop, currency, url, merchant, code, shops } } pour les jeux connus
 */
export async function lookupNexarda(appids, cache, now = Date.now(), limits = NX_LIMITS) {
  cache.ids ||= {};
  cache.prices ||= {};
  const wanted = [...new Set(appids.filter(Boolean).map(String))];
  let left = limits.perRun;
  let failed = null;
  const call = async (url) => {
    if (left <= 0) return undefined;
    left -= 1;
    const data = await fetchJson(url);
    await pause(limits.pause);
    return data;
  };
  for (const appid of wanted) {
    if (left <= 0) break;
    const priced = cache.prices[appid];
    if (priced && now - priced.at < limits.priceTtl) continue;
    try {
      let known = cache.ids[appid];
      const fresh = known && now - known.at < (known.id ? limits.foundTtl : limits.missTtl);
      if (!fresh) {
        const data = await call(`${ENDPOINTS.nexardaFind}?steam=${encodeURIComponent(appid)}&output=json`);
        if (data === undefined) break;
        known = cache.ids[appid] = { id: parseNexardaFind(data), at: now };
      }
      if (!known.id) continue;
      const data = await call(`${ENDPOINTS.nexardaPrices}?type=game&id=${known.id}&currency=EUR`);
      if (data === undefined) break;
      cache.prices[appid] = { best: parseNexardaPrices(data), at: now };
    } catch (e) {
      failed = e; // NEXARDA sature ou a changé : on garde ce qu'on sait et on reprendra plus tard
      break;
    }
  }
  // Ménage : jeux qui ne sont plus en promo depuis longtemps
  for (const [appid, p] of Object.entries(cache.prices)) if (now - p.at > 7 * DAY) delete cache.prices[appid];
  for (const [appid, p] of Object.entries(cache.ids)) if (now - p.at > 60 * DAY) delete cache.ids[appid];
  const out = {};
  for (const appid of wanted) {
    const best = cache.prices[appid]?.best;
    if (best) out[appid] = best;
  }
  if (failed && !Object.keys(out).length && wanted.length) throw failed;
  return out;
}
