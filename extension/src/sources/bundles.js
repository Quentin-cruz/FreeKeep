// Bundles de jeux Steam (Humble Bundle, Fanatical, Green Man Gaming, Digiphile, IndieGala).
// Contenu : Barter.vg. Qualité : avis Steam. Prix : API Fanatical et pages Humble Bundle.
import { ENDPOINTS, bundleStoreOf } from '../config.js';
import { MIN_GOOD } from '../levels.js';
import { fetchJson, fetchText } from '../util.js';
import { toEur, DEFAULT_USD_EUR } from './rates.js';
import { fetchSteamItems } from './steamstore.js';
import { steamHeaderImages } from './cheapshark.js';

const STORES = {
  'humble bundle': 'Humble Bundle', fanatical: 'Fanatical', 'green man gaming': 'Green Man Gaming', digiphile: 'Digiphile', indiegala: 'IndieGala',
};
// Sites dont la page donne le prix
const PRICED = { 'Humble Bundle': humbleTiers, 'Green Man Gaming': gmgTiers, IndieGala: indieGalaTiers };
const ADULT = /\b(adult|sexy|lust\w*|hentai|nsfw|futa\w*|femboy|orgasm\w*|erotic\w*)\b|18\+|🔞/i;
const MAX_PAGES = 20;
const MAX_ITEMS = 60;
const pause = () => new Promise((r) => setTimeout(r, 300));


export function parseBarter(data, now = Date.now()) {
  if (!data?.bundles || typeof data.bundles !== 'object') throw new Error('réponse Barter.vg inattendue');
  const out = [];
  for (const [id, b] of Object.entries(data.bundles)) {
    const m = b?.meta || {};
    const merchant = STORES[String(m.storename || '').toLowerCase()];
    const start = Number(m.start) * 1000;
    const end = Number(m.end) * 1000;
    if (!merchant || !m.url || !m.title || ADULT.test(m.title) || start > now || !(end > now)) continue;
    const appids = new Set();
    for (const g of Object.values(b.games || {})) {
      if (g?.type === 1 && g.id) appids.add(String(g.id));
      for (const inc of Object.values(g?.included || {})) appids.add(String(inc));
    }
    if (appids.size) out.push({ id, merchant, title: String(m.title).replace(/\s*\(previously:.*\)$/i, ''), url: m.url, start, end, appids: [...appids] });
  }
  return out;
}

// Prix Fanatical (centimes) : paliers « 3 jeux pour 4,95 € ».
export function fanaticalTiers(data) {
  const out = {};
  for (const b of data?.pickandmix || []) {
    if (b?.type !== 'bundle' || !b.slug) continue;
    const tiers = (b.tiers || [])
      .filter((t) => !t.invisible && t.price?.EUR)
      .map((t) => ({ n: t.quantity, price: Math.round(t.price.EUR) / 100 }))
      .sort((a, c) => a.n - c.n);
    if (tiers.length) out[b.slug] = tiers;
  }
  return out;
}

// Prix Humble : « 9 items for €35.80 »
export function humbleTiers(html) {
  const tiers = [...String(html || '').matchAll(/(\d+) items? for €\s?(\d+(?:[.,]\d{2})?)/gi)]
    .map((m) => ({ n: Number(m[1]), price: Number(m[2].replace(',', '.')) }));
  return [...new Map(tiers.map((t) => [t.n, t])).values()].sort((a, b) => a.n - b.n);
}

// Green Man Gaming : <span class="price">€5.00</span> par palier
export function gmgTiers(html) {
  return [...new Set([...String(html || '').matchAll(/class="price">\s*€\s?(\d+(?:[.,]\d{2})?)/g)].map((m) => Number(m[1].replace(',', '.'))))]
    .sort((a, b) => a - b).map((price, i) => ({ n: i + 1, price }));
}

// IndieGala : « Pay $3.99 or more to get this bundle » (dollars)
export function indieGalaTiers(html) {
  const usd = [...String(html || '').matchAll(/Pay\s*<strong[^>]*>\s*\$\s?(\d+(?:\.\d{2})?)/g)].map((m) => Number(m[1]));
  return [...new Set(usd)].sort((a, b) => a - b).map((price, i) => ({ n: i + 1, price, usd: true }));
}

const slugOf = (url) => String(url).split(/[?#]/)[0].replace(/\/$/, '').split('/').pop();

export function buildBundles(bundles, items, prices, settings, rate = DEFAULT_USD_EUR) {
  const minGood = MIN_GOOD[settings.level] ?? 3;
  const out = [];
  for (const b of bundles) {
    const games = b.appids.map((id) => ({ id, ...items[id] })).filter((g) => g.name && g.game);
    const good = games.filter((g) => (g.rating ?? 0) >= 80 && g.reviews >= 1000).sort((x, y) => y.reviews - x.reviews);
    const store = bundleStoreOf(b.merchant);
    const indie = store === 'indie';
    // Petits jeux indés : trop peu d'avis pour le critère des gros jeux. On demande au moins 4 jeux et une bonne moyenne.
    const rated = games.filter((g) => g.rating != null && g.reviews >= 4);
    const average = rated.length ? Math.round(rated.reduce((s, g) => s + g.rating, 0) / rated.length) : 0;
    if (indie ? games.length < 4 || rated.length < 4 || average < 70 || games.some((g) => ADULT.test(g.name)) : good.length < minGood) continue;
    const tiers = (prices[b.id] || []).map((t) => (t.usd ? { ...t, price: toEur(t.price, rate) } : t));
    const pick = /pick-and-mix|build your own/i.test(`${b.url} ${b.title}`);
    const top = tiers[tiers.length - 1];
    const value = Math.round(games.reduce((s, g) => s + (g.normal || 0), 0) * 100) / 100;
    // Bundle à composer : le prix d'entrée ; sinon le prix de tout le contenu, comparé à sa valeur sur Steam.
    const price = pick ? tiers[0]?.price ?? null : top?.price ?? null;
    out.push({
      id: `bd:${b.id}`,
      source: 'bundle',
      section: 'bundle',
      channel: 'bundle',
      store,
      title: b.title,
      url: b.url,
      images: steamHeaderImages((good[0] || [...games].sort((x, y) => y.reviews - x.reviews)[0]).id),
      price,
      priceNote: pick && tiers[0] ? `${tiers[0].n} jeu${tiers[0].n > 1 ? 'x' : ''} au choix` : tiers.length > 1 ? `dès ${tiers[0].price.toFixed(2).replace('.', ',')} €` : indie ? `${games.length} jeux, clés Steam` : null,
      approx: tiers.some((t) => t.usd),
      normalPrice: !pick && price ? value : null,
      currency: 'EUR',
      discount: !pick && price && value > price ? Math.round((1 - price / value) * 100) : null,
      merchant: b.merchant,
      platform: 'steam',
      bundle: { games: games.length, good: good.length, ...(indie ? { average } : {}), highlights: (indie ? [...games].sort((x, y) => y.reviews - x.reviews) : good).slice(0, 4).map((g) => g.name), appids: games.map((g) => g.id) },
      posted: b.start,
      end: b.end,
      flags: { bundle: true },
    });
  }
  return out.sort((a, b) => b.bundle.good - a.bundle.good).slice(0, MAX_ITEMS);
}

/** @param known prix Humble déjà lus : { [id du bundle]: paliers } (modifié en place) */
export async function fetchBundles(settings, known = {}, now = Date.now(), rate = DEFAULT_USD_EUR) {
  const bundles = parseBarter(await fetchJson(ENDPOINTS.barter, { timeout: 25000 }), now);
  const items = await fetchSteamItems(bundles.flatMap((b) => b.appids));
  const prices = {};
  try {
    const fan = fanaticalTiers(await fetchJson(ENDPOINTS.fanatical, { timeout: 25000 }));
    for (const b of bundles) if (b.merchant === 'Fanatical' && fan[slugOf(b.url)]) prices[b.id] = fan[slugOf(b.url)];
  } catch (e) {
    console.warn('[FreeKeep] prix Fanatical :', e);
  }
  const order = buildBundles(bundles, items, {}, settings, rate).map((d) => d.id.slice(3)); // les meilleurs d'abord
  let left = MAX_PAGES;
  for (const id of order) {
    const b = bundles.find((x) => x.id === id);
    const read = PRICED[b.merchant];
    if (!read || (b.merchant === 'Humble Bundle' && !/\/games\//.test(b.url))) continue;
    if (!known[b.id] && left > 0) {
      left -= 1;
      try {
        known[b.id] = read(await fetchText(b.url, { timeout: 20000 }));
      } catch (e) {
        console.warn(`[FreeKeep] prix ${b.merchant} :`, e);
      }
      await pause();
    }
    if (known[b.id]?.length) prices[b.id] = known[b.id];
  }
  for (const id of Object.keys(known)) if (!bundles.some((b) => b.id === id)) delete known[id];
  return buildBundles(bundles, items, prices, settings, rate);
}
