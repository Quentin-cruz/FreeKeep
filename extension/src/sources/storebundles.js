// Bundles vendus par les stores eux-mêmes : Steam et GOG. Et bundles indés sans DRM : itch.io.
import { ENDPOINTS } from '../config.js';
import { fetchJson, fetchText, decodeEntities, stripHtml } from '../util.js';
import { fetchSteamItems } from './steamstore.js';
import { steamHeaderImages } from './cheapshark.js';
import { toEur, DEFAULT_USD_EUR } from './rates.js';

const BATCH = 50;
const MAX_STEAM = 40;
const pause = () => new Promise((r) => setTimeout(r, 250));

// ---------- Steam ----------

const steamQuery = (ids, data_request) => fetchJson(`${ENDPOINTS.steamItems}?input_json=${encodeURIComponent(JSON.stringify({ ids, context: { language: 'english', country_code: 'FR' }, data_request }))}`);

// Bundles qui contiennent ces jeux : { [bundleid]: { name, price, end } }
export function parsePurchaseOptions(data) {
  const out = {};
  for (const it of data?.response?.store_items || []) {
    for (const p of it?.purchase_options || []) {
      if (!p?.bundleid || !(p.included_game_count >= 2) || !p.final_price_in_cents) continue;
      out[p.bundleid] = { name: p.purchase_option_name, price: Number(p.final_price_in_cents) / 100, end: Number(p.active_discounts?.[0]?.discount_end_date) * 1000 || null };
    }
  }
  return out;
}

export function buildSteamBundles(options, included, items, { minGood = 2, minDiscount = 60 } = {}) {
  const out = [];
  for (const [id, o] of Object.entries(options)) {
    const games = (included[id] || []).map((a) => ({ id: String(a), ...items[a] })).filter((g) => g.name && g.game && g.normal > 0);
    const good = games.filter((g) => (g.rating ?? 0) >= 80 && g.reviews >= 1000).sort((x, y) => y.reviews - x.reviews);
    const value = Math.round(games.reduce((s, g) => s + g.normal, 0) * 100) / 100;
    const discount = value > o.price ? Math.round((1 - o.price / value) * 100) : 0;
    if (games.length < 2 || good.length < minGood || discount < minDiscount) continue;
    out.push({
      id: `sb:${id}`,
      source: 'storebundle',
      section: 'bundle',
      channel: 'bundle',
      store: 'stores',
      title: o.name,
      url: `https://store.steampowered.com/bundle/${id}/`,
      images: steamHeaderImages(good[0].id),
      price: o.price,
      normalPrice: value,
      currency: 'EUR',
      discount,
      merchant: 'Steam',
      platform: 'steam',
      bundle: { games: games.length, good: good.length, highlights: good.slice(0, 4).map((g) => g.name), appids: games.map((g) => g.id) },
      posted: null,
      end: o.end,
      flags: { bundle: true },
    });
  }
  // Un même jeu phare revient dans plusieurs bundles : on garde les plus intéressants
  return out.sort((a, b) => b.bundle.good * b.discount - a.bundle.good * a.discount).slice(0, MAX_STEAM);
}

export async function fetchSteamBundles(appids) {
  const ids = [...new Set(appids.filter(Boolean).map(String))].slice(0, 200);
  const options = {};
  for (let i = 0; i < ids.length; i += BATCH) {
    if (i) await pause();
    Object.assign(options, parsePurchaseOptions(await steamQuery(ids.slice(i, i + BATCH).map((id) => ({ appid: Number(id) })), { include_all_purchase_options: true })));
  }
  const included = {};
  const bundleIds = Object.keys(options).slice(0, 200);
  for (let i = 0; i < bundleIds.length; i += BATCH) {
    await pause();
    const data = await steamQuery(bundleIds.slice(i, i + BATCH).map((id) => ({ bundleid: Number(id) })), {});
    for (const b of data?.response?.store_items || []) if (b?.success === 1 && b.included_appids) included[b.id] = b.included_appids;
  }
  const items = await fetchSteamItems(Object.values(included).flat());
  return buildSteamBundles(options, included, items);
}

// ---------- GOG ----------

export const GOG_PACK = /bundle|trilogy|collection|franchise|saga|anthology|duology|\bpack\b|\d\s*\+\s*\d/i;

export function parseGogPacks(products) {
  const out = [];
  for (const p of products || []) {
    const price = Number(p?.price?.finalMoney?.amount);
    const normal = Number(p?.price?.baseMoney?.amount);
    if (!p?.id || !GOG_PACK.test(p.title || '') || !(normal >= 14.99) || !(price > 0) || p.price.finalMoney.currency !== 'EUR') continue;
    const discount = Math.round((1 - price / normal) * 100);
    const rating = (Number(p.reviewsRating) || 0) / 10;
    // Les gros packs ont souvent peu d'avis : sans note, il faut une très grosse remise
    if (discount < 60 || (rating ? rating < 4 : discount < 75)) continue;
    out.push({
      id: `gp:${p.id}`,
      source: 'storebundle',
      section: 'bundle',
      channel: 'bundle',
      store: 'stores',
      title: p.title,
      url: p.storeLink || `https://www.gog.com/fr/game/${p.slug}`,
      images: [p.coverHorizontal].filter(Boolean),
      price,
      normalPrice: normal,
      currency: 'EUR',
      discount,
      merchant: 'GOG',
      platform: 'gog',
      rating: rating ? { gog: rating, gogCount: Number(p.reviewsCount) || 0 } : {},
      categories: (p.genres || []).map((g) => g.slug).filter(Boolean),
      posted: null,
      end: null,
      flags: { bundle: true },
    });
  }
  return out;
}

export async function fetchGogPacks() {
  const products = [];
  for (let page = 1; page <= 2; page++) {
    if (page > 1) await pause();
    const params = new URLSearchParams({ limit: '48', order: 'desc:trending', discounted: 'eq:true', productType: 'in:pack', page: String(page), countryCode: 'FR', locale: 'fr-FR', currencyCode: 'EUR' });
    const data = await fetchJson(`${ENDPOINTS.gogCatalog}?${params}`);
    if (!Array.isArray(data?.products)) throw new Error('réponse GOG inattendue');
    products.push(...data.products);
  }
  return parseGogPacks(products);
}

// ---------- itch.io (indés, sans DRM) ----------

const DAY = 24 * 3600 * 1000;

export function parseItch(html, rate = DEFAULT_USD_EUR, now = Date.now()) {
  const out = [];
  for (const row of String(html || '').split('<div data-sale_id="').slice(1)) {
    const id = /^(\d+)"/.exec(row)?.[1];
    const link = /sale_title"><a href="([^"]+)">([^<]+)/.exec(row);
    const label = stripHtml(/game_count">([\s\S]*?)<\/div>/.exec(row)?.[1] || '');
    const m = /^(\d+) (games|items) for (.*)$/i.exec(label);
    const end = Date.parse(/date_format">([^<]+)/.exec(row)?.[1] || '') || null;
    if (!id || !link || !m || !/icon-windows8/.test(row) || (end && (end < now || end - now > 120 * DAY))) continue;
    const n = Number(m[1]);
    // Le dernier prix est celui à payer ; le premier, barré, la valeur du contenu
    const prices = [...m[3].replace(/\(.*$/, '').matchAll(/([$€£])(\d+(?:\.\d{2})?)|(\d+(?:\.\d{2})?)\s?([€£])/g)].map((x) => ({ v: Number(x[2] || x[3]), c: x[1] || x[4] }));
    const pay = prices[prices.length - 1];
    if (!pay || !['$', '€'].includes(pay.c) || n < 4) continue;
    const eur = (p) => (p.c === '€' ? p.v : toEur(p.v, rate));
    const price = eur(pay);
    const normal = prices.length > 1 ? eur(prices[0]) : null;
    if (price > 20 || price / n > 2.5) continue; // pas de note sur itch.io : seulement les lots vraiment peu chers
    out.push({
      id: `it:${id}`,
      source: 'itch',
      section: 'bundle',
      channel: 'bundle',
      store: 'indie',
      title: decodeEntities(link[2]).trim(),
      url: link[1].startsWith('http') ? link[1] : `https://itch.io${link[1]}`,
      images: [decodeEntities(/data-lazy_src="([^"]+)"/.exec(row)?.[1] || '')].filter(Boolean),
      price,
      priceNote: `${n} jeux, sans DRM`,
      normalPrice: normal && normal > price ? normal : null,
      currency: 'EUR',
      approx: pay.c !== '€',
      discount: normal && normal > price ? Math.round((1 - price / normal) * 100) : null,
      merchant: 'itch.io',
      platform: 'itch',
      count: n,
      posted: null,
      end,
      flags: { bundle: true },
    });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 15);
}

export async function fetchItchBundles(rate, now = Date.now()) {
  const pages = await Promise.allSettled([fetchText(ENDPOINTS.itchBundles), fetchText(`${ENDPOINTS.itchBundles}/co-op`)]);
  const ok = pages.filter((p) => p.status === 'fulfilled');
  if (!ok.length) throw new Error(String(pages[0].reason?.message || 'itch.io inaccessible'));
  const all = ok.flatMap((p) => parseItch(p.value, rate, now));
  return [...new Map(all.map((d) => [d.id, d])).values()];
}
