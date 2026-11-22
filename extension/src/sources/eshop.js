// eShop Nintendo (Europe, France) : promos sur les jeux jouables sur Switch 1.
// Recherche = backend officiel du site Nintendo ; prix exacts + date de fin = API de prix Nintendo.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';

const FIELDS = [
  'title', 'url', 'nsuid_txt', 'fs_id', 'price_regular_f', 'price_lowest_f', 'price_discount_percentage_f',
  'image_url_h2x1_s', 'image_url', 'downloads_rank_i', 'publisher', 'playable_on_txt', 'game_categories_txt',
].join(',');

// Rang de téléchargement Nintendo (1 = le plus téléchargé). Les jeux inconnus bradés à -90 % sont bien plus loin
// (ou sans rang), alors que trier par remise ne remonterait qu'eux : il y a plus de 2 000 promos en permanence.
const POPULAR_RANK = 500;
const KNOWN_RANK = 1500;
const MAX_ITEMS = 100;
const PRICE_BATCH = 50; // l'API de prix accepte 50 jeux par requête

async function search(fq, rows) {
  const params = new URLSearchParams({ q: '*', fq, fl: FIELDS, sort: 'downloads_rank_i asc', rows: String(rows), start: '0', wt: 'json' });
  return fetchJson(`${ENDPOINTS.eshopSearch}?${params}`);
}

export async function fetchEshop(settings) {
  const min = settings.switchMinDiscount;
  const base = 'type:GAME AND price_has_discount_b:true';
  // HAC = Switch 1 (jouable aussi sur Switch 2) ; BEE = Switch 2
  let platform = settings.switch2 ? '(playable_on_txt:HAC OR playable_on_txt:BEE)' : 'playable_on_txt:HAC';
  const known = `price_discount_percentage_f:[${min} TO 100] AND downloads_rank_i:[1 TO ${KNOWN_RANK}]`;
  let big;
  try {
    big = await search(`${base} AND ${platform} AND ${known}`, 400);
    if (!big?.response?.numFound) throw new Error('vide');
  } catch {
    platform = 'system_type:nintendoswitch*';
    // (repli : le tri Switch 1 / Switch 2 se fait ensuite dans parseEshop)
    big = await search(`${base} AND ${platform} AND ${known}`, 400);
  }
  // Les jeux Nintendo dépassent rarement -40 % : on les prend dès -20 %.
  let first = null;
  try {
    first = await search(`${base} AND ${platform} AND publisher:Nintendo AND price_discount_percentage_f:[20 TO 100]`, 100);
  } catch { /* facultatif */ }

  const items = parseEshop([big, first], settings).slice(0, MAX_ITEMS);
  const ids = [...new Set(items.flatMap((it) => it.nsuids))];
  const prices = [];
  for (let i = 0; i < ids.length; i += PRICE_BATCH) {
    try {
      const data = await fetchJson(`${ENDPOINTS.eshopPrice}?country=FR&lang=fr&ids=${ids.slice(i, i + PRICE_BATCH).join(',')}`);
      prices.push(...(data?.prices || []));
    } catch (e) {
      console.warn('[FreeKeep] prix eShop :', e);
    }
  }
  applyEshopPrices(items, { prices });
  return items.filter((i) => i.onSale !== false);
}

// De 0 (inconnu) à 40 (très téléchargé).
export const eshopRankBonus = (rank) => (rank == null ? 0 : Math.max(0, Math.round(40 * (1 - rank / KNOWN_RANK))));

export function parseEshop(responses, settings) {
  const byId = new Map();
  for (const data of responses) {
    const docs = data?.response?.docs;
    if (!Array.isArray(docs)) continue;
    for (const doc of docs) {
      // 7001 = jeu, 7007 = pack ou édition Deluxe, 7005 = DLC (ignoré)
      const nsuids = (doc.nsuid_txt || []).map(String).filter((n) => /^700[17]/.test(n));
      const nsuid = nsuids.find((n) => n.startsWith('7001')) || nsuids[0];
      if (!nsuid || byId.has(nsuid) || !doc.title) continue;
      const playable = doc.playable_on_txt || ['HAC'];
      const platform = playable.some((p) => /HAC/i.test(p)) ? 'switch1' : playable.some((p) => /BEE/i.test(p)) ? 'switch2' : null;
      if (!platform || (platform === 'switch2' && !settings.switch2)) continue;

      const discount = Math.round(Number(doc.price_discount_percentage_f) || 0);
      const regular = Number(doc.price_regular_f) || null;
      const rank = doc.downloads_rank_i ?? null;
      const nintendo = /^nintendo$/i.test(String(doc.publisher || '').trim());
      const big = (regular ?? 0) >= 19.99;
      const popular = rank != null && rank <= POPULAR_RANK;
      const known = rank != null && rank <= KNOWN_RANK;

      // On écarte le « caca » : jeux inconnus bradés à -90 %, même affichés à 20 € et plus.
      const keep = nintendo ? discount >= 20 : discount >= settings.switchMinDiscount && (popular || (big && known));
      if (!keep) continue;

      const price = regular ? Math.round(regular * (100 - discount)) / 100 : null;
      byId.set(nsuid, {
        id: `es:${nsuid}`,
        source: 'eshop',
        section: 'switch',
        channel: 'eshop',
        title: doc.title,
        url: doc.url?.startsWith('http') ? doc.url : `https://www.nintendo.com${doc.url || ''}`,
        images: [doc.image_url_h2x1_s, doc.image_url].filter(Boolean),
        price,
        normalPrice: regular,
        currency: 'EUR',
        discount,
        merchant: 'Nintendo eShop',
        nsuid,
        nsuids,
        rank,
        platform,
        categories: doc.game_categories_txt || [],
        end: null,
        posted: null,
        flags: { nintendo, popular, big },
      });
    }
  }
  // Les jeux Nintendo passent toujours devant : leurs remises, plus petites, les feraient sortir de la liste.
  const score = (i) => i.discount + (i.flags.nintendo ? 100 : 0) + eshopRankBonus(i.rank) + (i.flags.big ? 10 : 0);
  return [...byId.values()].sort((a, b) => score(b) - score(a));
}

// Prix à afficher : le jeu seul s'il est en promo, sinon le pack en promo le moins cher.
// Un pack vendu moins cher que le jeu ne le contient pas (pack de DLC) : il est écarté.
function pickPrice(prices) {
  const regular = (p) => Number(p.regular_price?.raw_value) || 0;
  const cheapest = (list) => list.filter((p) => p.discount_price)
    .sort((a, b) => Number(a.discount_price.raw_value) - Number(b.discount_price.raw_value))[0];
  const games = prices.filter((p) => String(p.title_id).startsWith('7001') && regular(p) > 0);
  const gamePrice = games.length ? Math.min(...games.map(regular)) : 0;
  const packs = prices.filter((p) => String(p.title_id).startsWith('7007') && regular(p) >= gamePrice);
  return cheapest(games) || cheapest(packs) || null;
}

export function applyEshopPrices(items, data) {
  const prices = data?.prices;
  if (!Array.isArray(prices)) return;
  const byId = new Map(prices.map((p) => [String(p.title_id), p]));
  for (const it of items) {
    const found = (it.nsuids || [it.nsuid]).map((id) => byId.get(String(id))).filter(Boolean);
    if (!found.length) continue;
    const p = pickPrice(found);
    if (!p) {
      it.onSale = false; // la promo est terminée
      continue;
    }
    const dp = p.discount_price;
    const regular = Number(p.regular_price?.raw_value);
    if (String(p.title_id) !== it.nsuid) it.merchant = 'Nintendo eShop (pack ou Deluxe)';
    it.price = Number(dp.raw_value);
    if (Number.isFinite(regular) && regular > 0) {
      it.normalPrice = regular;
      it.discount = Math.round((1 - it.price / regular) * 100);
    }
    it.end = Date.parse(dp.end_datetime) || null;
  }
}
