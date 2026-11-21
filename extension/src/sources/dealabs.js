// Dealabs (dealabs.com) : bons plans postés et votés par la communauté française.
// Sert pour les jeux en boîte (Amazon, Fnac, Leclerc…), les sites de clés (Eneba, Instant Gaming, G2A…)
// et les erreurs de prix. Lu via les flux RSS publics.
import { ENDPOINTS, KEYSHOPS, NOT_A_GAME } from '../config.js';
import { fetchText, decodeEntities, normText, parsePrice, stripHtml } from '../util.js';

export const FEEDS = {
  hot: `${ENDPOINTS.dealabs}/hot`,
  jeux: `${ENDPOINTS.dealabs}/groupe/consoles-jeux-video`,
  switch: `${ENDPOINTS.dealabs}/groupe/jeux-nintendo-switch`,
};

const DAY = 24 * 3600 * 1000;

export async function fetchDealabs() {
  const results = await Promise.allSettled(
    Object.entries(FEEDS).map(async ([name, url]) => [name, await fetchText(url, { timeout: 20000 })]),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw new Error(results[0]?.reason?.message || 'Dealabs inaccessible');
  return ok.flatMap(([name, xml]) => parseRss(xml).map((it) => ({ ...it, feed: name })));
}

// ---------- Lecture RSS (sans DOMParser : indisponible dans un service worker) ----------

const unCdata = (s) => String(s ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

export function parseRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const tag = (name) => {
      const r = new RegExp(`<${escapeRe(name)}\\b[^>]*>([\\s\\S]*?)</${escapeRe(name)}>`, 'i').exec(x);
      return r ? unCdata(r[1]).trim() : '';
    };
    const attrs = (name) => {
      const r = new RegExp(`<${escapeRe(name)}\\b([^>]*?)/?>`, 'i').exec(x);
      return r ? parseAttrs(r[1]) : {};
    };
    const merchant = attrs('pepper:merchant');
    const link = decodeEntities(tag('link'));
    out.push({
      guid: decodeEntities(tag('guid')) || link,
      title: decodeEntities(tag('title')),
      link,
      pubDate: Date.parse(tag('pubDate')) || null,
      category: decodeEntities(tag('category')),
      description: tag('description'),
      merchant: merchant.name || '',
      priceText: merchant.price || '',
      image: attrs('media:content').url || attrs('media:thumbnail').url || null,
    });
  }
  return out;
}

// ---------- Classement ----------

// « Switch » mais pas uniquement « Switch 2 » (tu as une Switch 1).
export function mentionsSwitch1(title) {
  const t = String(title).toLowerCase();
  const hits = [...t.matchAll(/switch(\s*\d)?/g)];
  if (!hits.length) return false;
  return hits.some((h) => !h[1] || h[1].trim() !== '2');
}

const PC_WORDS = /\b(pc|steam|epic games|gog|ubisoft connect|uplay|ea app|battle\.?net|windows|mac)\b/i;
const OTHER_CONSOLES = /\b(ps[345]|playstation|xbox|switch)\b/i;
const PRICE_ERROR = /erreur de prix|bug de prix|prix bugg?[ée]|price error|prix cass[ée] par erreur/i;

const isKeyshop = (merchant) => {
  const m = normText(merchant);
  return !!m && KEYSHOPS.some((k) => m.includes(normText(k)));
};

const biggerImage = (url) => (url ? url.replace(/\/re\/\d+x\d+\//, '/re/300x300/') : null);

export function classifyDealabs(it, settings, now = Date.now()) {
  const title = it.title || '';
  // Le flux « hot » mélange toutes les catégories : on ne garde que les jeux vidéo.
  if (it.feed === 'hot' && !/consoles|jeux vid/i.test(it.category)) return null;
  if (!title || NOT_A_GAME.test(title)) return null;
  if (it.pubDate && now - it.pubDate > (settings.dealMaxAgeDays || 7) * DAY) return null;
  if (/frontalier/i.test(title)) return null;

  // Deals en magasin : seulement dans tes départements.
  const dept = /\((\d{2,3}|2A|2B)\)\s*$/i.exec(title)?.[1]?.toUpperCase();
  const depts = String(settings.departments || '').split(/[\s,;]+/).map((d) => d.trim().toUpperCase()).filter(Boolean);
  if (dept && !depts.includes(dept)) return null;

  const isSwitch = mentionsSwitch1(title);
  const keyshop = isKeyshop(it.merchant);
  const isPC = !isSwitch && (PC_WORDS.test(title) || ((keyshop || /steam|gog|epic|fanatical|humble|gamesplanet|green ?man/i.test(it.merchant)) && !OTHER_CONSOLES.test(title)));
  if (!isSwitch && !isPC) return null;

  const text = `${title} ${stripHtml(it.description).slice(0, 800)}`;
  const priceError = PRICE_ERROR.test(text);
  const hot = !!it.hot;
  if (settings.dealabsOnlyHot && !hot && !priceError) return null;

  const section = isSwitch ? 'switch' : 'pc';
  const bundle = /\bbundle\b|pack de \d+ jeux|lot de \d+ jeux/i.test(title);
  let channel;
  if (keyshop) channel = 'keyshop';
  else if (bundle) channel = 'bundle';
  else if (section === 'switch') channel = /nintendo/i.test(it.merchant) || /d[ée]mat[ée]rialis[ée]/i.test(title) ? 'eshop' : 'physical';
  else channel = 'official';

  const price = parsePrice(it.priceText);
  const discount = Number(/-\s?(\d{1,2})\s?%/.exec(title)?.[1]) || null;
  const id = /-(\d{5,})(?:[/?#]|$)/.exec(it.link)?.[1] || normText(it.guid).slice(-40);

  return {
    id: `dl:${id}`,
    source: 'dealabs',
    section,
    channel,
    title,
    url: it.link,
    images: [biggerImage(it.image)].filter(Boolean),
    square: true,
    price,
    normalPrice: null,
    currency: 'EUR',
    discount,
    merchant: it.merchant || 'Dealabs',
    posted: it.pubDate,
    end: null,
    flags: { hot, priceError, free: price === 0, local: !!dept, bundle },
  };
}

// Fusionne les items des 3 flux (un même deal peut être dans « hot » et dans un groupe).
export function mergeDealabsItems(items) {
  const byGuid = new Map();
  for (const it of items) {
    const prev = byGuid.get(it.guid);
    const hot = it.feed === 'hot' || !!it.hot || !!prev?.hot;
    // On garde la version « groupe » (catégorie fiable) quand elle existe.
    const base = prev && prev.feed !== 'hot' ? prev : it;
    byGuid.set(it.guid, { ...base, feed: base.feed, hot });
  }
  return [...byGuid.values()];
}
