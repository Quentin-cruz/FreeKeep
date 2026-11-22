// eShop Nintendo (Europe, France) : promos sur les jeux jouables sur Switch 1.
// Recherche = backend officiel du site Nintendo ; prix exacts + date de fin = API de prix Nintendo.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';

const FIELDS = [
  'title', 'url', 'nsuid_txt', 'fs_id', 'price_regular_f', 'price_lowest_f', 'price_discount_percentage_f',
  'image_url_h2x1_s', 'image_url', 'downloads_rank_i', 'publisher', 'playable_on_txt', 'game_categories_txt',
].join(',');

async function search(fq, rows) {
  const params = new URLSearchParams({ q: '*', fq, fl: FIELDS, sort: 'price_discount_percentage_f desc', rows: String(rows), start: '0', wt: 'json' });
  return fetchJson(`${ENDPOINTS.eshopSearch}?${params}`);
}

export async function fetchEshop(settings) {
  const min = settings.switchMinDiscount;
  const base = 'type:GAME AND price_has_discount_b:true';
  // HAC = Switch 1 (jouable aussi sur Switch 2) ; BEE = Switch 2
  let platform = settings.switch2 ? '(playable_on_txt:HAC OR playable_on_txt:BEE)' : 'playable_on_txt:HAC';
  let big;
  try {
    big = await search(`${base} AND ${platform} AND price_discount_percentage_f:[${min} TO 100]`, 400);
    if (!big?.response?.numFound) throw new Error('vide');
  } catch {
    platform = 'system_type:nintendoswitch*';
    // (repli : le tri Switch 1 / Switch 2 se fait ensuite dans parseEshop)
    big = await search(`${base} AND ${platform} AND price_discount_percentage_f:[${min} TO 100]`, 400);
  }
  // Les jeux Nintendo dépassent rarement -40 % : on les prend dès -20 %.
  let first = null;
  try {
    first = await search(`${base} AND ${platform} AND publisher:Nintendo AND price_discount_percentage_f:[20 TO 100]`, 100);
  } catch { /* facultatif */ }

  const items = parseEshop([big, first], settings).slice(0, 50);
  try {
    applyEshopPrices(items, await fetchJson(`${ENDPOINTS.eshopPrice}?country=FR&lang=fr&ids=${items.map((i) => i.nsuid).join(',')}`));
  } catch (e) {
    console.warn('[FreeKeep] prix eShop :', e);
  }
  return items.filter((i) => i.onSale !== false);
}

export function parseEshop(responses, settings) {
  const byId = new Map();
  for (const data of responses) {
    const docs = data?.response?.docs;
    if (!Array.isArray(docs)) continue;
    for (const doc of docs) {
      const nsuid = (doc.nsuid_txt || []).find((n) => String(n).startsWith('7001'));
      if (!nsuid || byId.has(nsuid) || !doc.title) continue;
      const playable = doc.playable_on_txt || ['HAC'];
      const platform = playable.some((p) => /HAC/i.test(p)) ? 'switch1' : playable.some((p) => /BEE/i.test(p)) ? 'switch2' : null;
      if (!platform || (platform === 'switch2' && !settings.switch2)) continue;

      const discount = Math.round(Number(doc.price_discount_percentage_f) || 0);
      const regular = Number(doc.price_regular_f) || null;
      const rank = doc.downloads_rank_i ?? null;
      const nintendo = /^nintendo$/i.test(String(doc.publisher || '').trim());
      const big = (regular ?? 0) >= 19.99;
      const popular = rank != null && rank <= 500;

      // On écarte le « caca » : petits jeux inconnus bradés à -90 %.
      const keep = nintendo ? discount >= 20 : discount >= settings.switchMinDiscount && (big || popular);
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
        rank,
        platform,
        categories: doc.game_categories_txt || [],
        end: null,
        posted: null,
        flags: { nintendo, popular, big },
      });
    }
  }
  const score = (i) => i.discount + (i.flags.nintendo ? 30 : 0) + (i.flags.popular ? 15 : 0) + (i.flags.big ? 10 : 0);
  return [...byId.values()].sort((a, b) => score(b) - score(a));
}

export function applyEshopPrices(items, data) {
  const prices = data?.prices;
  if (!Array.isArray(prices)) return;
  const byId = new Map(prices.map((p) => [String(p.title_id), p]));
  for (const it of items) {
    const p = byId.get(it.nsuid);
    if (!p) continue;
    const dp = p.discount_price;
    if (!dp) {
      it.onSale = false; // la promo est terminée
      continue;
    }
    const regular = Number(p.regular_price?.raw_value);
    it.price = Number(dp.raw_value);
    if (Number.isFinite(regular) && regular > 0) {
      it.normalPrice = regular;
      it.discount = Math.round((1 - it.price / regular) * 100);
    }
    it.end = Date.parse(dp.end_datetime) || null;
  }
}
