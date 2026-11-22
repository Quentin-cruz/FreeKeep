// Dealabs (dealabs.com) : bons plans postés et votés par la communauté française.
// Sert pour les jeux en boîte (Amazon, Fnac, Leclerc…), les sites de clés (Eneba, Instant Gaming, G2A…)
// et les erreurs de prix. Lu via les flux RSS publics.
import { ENDPOINTS, KEYSHOPS, PHYSICAL_STORES, NOT_A_GAME, bundleStoreOf } from '../config.js';
import { fetchText, decodeEntities, normText, parsePrice, stripHtml } from '../util.js';

export const FEEDS = {
  hot: `${ENDPOINTS.dealabs}/hot`,
  jeux: `${ENDPOINTS.dealabs}/groupe/consoles-jeux-video`,
  switch: `${ENDPOINTS.dealabs}/groupe/jeux-nintendo-switch`,
  pc: `${ENDPOINTS.dealabs}/groupe/jeux-pc`,
  erreur: `${ENDPOINTS.dealabs}/groupe/erreur-de-prix`,
};

// Flux qui mélangent toutes les catégories (pas seulement les jeux vidéo).
const MIXED_FEEDS = ['hot', 'erreur'];

// ---------- Départements ----------

const DEPT = /^(0[1-9]|[1-8]\d|9[0-5]|97[1-6]|2[AB])$/i;

// « Dainville (62) / Templeuve (59) », « Toulouse (31) (console uniquement) », « (59/62) » → départements cités.
export function localDepartments(title) {
  const out = new Set();
  for (const m of String(title || '').matchAll(/\(([^()]*)\)/g)) {
    const parts = m[1].trim().split(/\s*(?:[,/&+]|\bet\b)\s*/i);
    if (parts.every((p) => DEPT.test(p))) parts.forEach((p) => out.add(p.toUpperCase()));
  }
  return [...out];
}

// Saisie de l'utilisateur : « 80, 60 », « 1 », un code postal (« 80000 »), « 2a ».
export function parseDepartments(text) {
  const out = new Set();
  for (const raw of String(text || '').toUpperCase().split(/[\s,;/]+/).filter(Boolean)) {
    const postal = /^(\d{2})(\d)\d{2}$/.exec(raw);
    const d = postal ? (postal[1] === '97' ? postal[1] + postal[2] : postal[1]) : raw.padStart(2, '0');
    if (d === '20') ['2A', '2B'].forEach((x) => out.add(x));
    else if (DEPT.test(d)) out.add(d);
  }
  return [...out];
}

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

// Le flux « hot » préfixe chaque titre par la température : « 119° - Moonlighter… ».
const TEMPERATURE = /^\s*-?\d+\s*°\s*[-–]\s*/;
export const stripTemperature = (title) => String(title ?? '').replace(TEMPERATURE, '').trim();

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
      title: stripTemperature(decodeEntities(tag('title'))),
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

export const mentionsSwitch2 = (title) => /switch\s*2\b/i.test(String(title));

// Plateforme d'activation d'un jeu PC d'après le titre Dealabs.
export function pcPlatformOf(title, merchant = '') {
  const t = `${title} ${merchant}`;
  if (/^\s*(xbox|microsoft)\b/i.test(merchant) && !/\bsteam\b/i.test(title)) return 'microsoft';
  if (/^\s*(ea|electronic arts)\s*$/i.test(merchant) && !/\bsteam\b/i.test(title)) return 'ea';
  if (/\bsteam\b/i.test(t)) return 'steam';
  if (/\bepic\b/i.test(t)) return 'epic';
  if (/\bgog\b/i.test(t)) return 'gog';
  if (/ubisoft|uplay/i.test(t)) return 'ubisoft';
  if (/\b(ea app|origin)\b/i.test(t)) return 'ea';
  if (/itch\.io/i.test(t)) return 'itch';
  if (/indie\s?gala/i.test(t)) return 'indiegala';
  if (/battle\.?net|blizzard/i.test(t)) return 'battlenet';
  if (/microsoft store|xbox app|windows store|xbox pc/i.test(t)) return 'microsoft';
  if (/legacy games/i.test(t)) return 'legacy';
  if (/amazon games/i.test(t)) return 'amazon';
  return null; // inconnu : on ne filtre pas
}

// Revendeurs de clés Steam : sans autre précision, le jeu s'active sur Steam.
const STEAM_SELLERS = /fanatical|humble|green ?man|\bgmg\b|gamesplanet|gamebillet|2game|voidu|wingamestore|dlgamer|gamersgate|indiegala|nuuvem|noctre|dreamgame|lenovo|planetplay|digiphile/i;

const PC_WORDS = /\b(pc|steam|epic games|gog|ubisoft connect|uplay|ea app|battle\.?net|microsoft store|xbox app|windows|mac)\b/i;
const OTHER_CONSOLES = /\b(ps[345]|playstation|xbox|switch)\b/i;
const PRICE_ERROR = /erreur de prix|bug de prix|prix bugg?[ée]|price error|prix cass[ée] par erreur/i;

const isKeyshop = (merchant) => {
  const m = normText(merchant);
  return !!m && KEYSHOPS.some((k) => m.includes(normText(k)));
};

const biggerImage = (url) => (url ? url.replace(/\/re\/\d+x\d+\//, '/re/300x300/') : null);

// ---------- Jeux PC offerts à garder (Prime, Microsoft Store, Battle.net…) ----------

const FREE_WORDS = /\b(gratuite?s?|gratuitement|offerte?s?|free)\b|\b0[,.]?0{0,2}\s?€/i;
// Pas « à garder » : week-end gratuit, démo, free-to-play, DLC, abonnement…
const NOT_KEEP = /week-?end|jouable gratuitement|en essai|essai gratuit|d[ée]mo\b|free[- ]to[- ]play|\bf2p\b|\bdlc\b|extension|contenu|\bskin|cosm[ée]tique|bonus in-?game|monnaie|game ?pass|ps plus|playstation plus|abonnement|jours? d'essai|pr[ée]co/i;
const PRIME_TEXT = /prime gaming|amazon prime|\bprime\b.*\bluna\b|amazon luna|\bluna\b|avec prime|abonn[ée]s? prime|membres? prime/i;
// Dans la description, seulement des tournures qui réservent le jeu aux abonnés (ou un lien Amazon Gaming / Luna) :
// « Optimus Prime » ou « à voir sur Prime Video » ne comptent pas.
const PRIME_DESC = /prime gaming|amazon (?:gaming|luna)\b|(?:gaming|luna)\.amazon\.|(?:abonn[ée]e?s?|abonnement|membres?|clients?|n[ée]cessite|requiert|r[ée]serv[ée]e?s? (?:à|aux?)|avec)\s+(?:à |aux? )?(?:amazon )?prime\b(?!\s*vid[ée]o)/i;
// Phrases qui disent le contraire, ou qui parlent d'une offre passée : retirées avant le test.
const PRIME_NOT = /[^.!?\n]*\b(?:sans|aucun|pas besoin|pas n[ée]cessaire|pas r[ée]serv[ée]|d[ée]j[àa]|pr[ée]c[ée]demment|auparavant|avai(?:t|ent))(?![a-zà-ÿ])[^.!?\n]*\bprime\b[^.!?\n]*/gi;

function primeOnly(title, merchant, description) {
  if (PRIME_TEXT.test(`${title} ${merchant || ''}`)) return true;
  const raw = String(description || '');
  if (/(?:gaming|luna)\.amazon\./i.test(raw)) return true; // lien, souvent caché derrière « cette page »
  return PRIME_DESC.test(stripHtml(raw.replace(/<br\s*\/?>|<\/p>/gi, '. ')).replace(PRIME_NOT, ' '));
}

const CLOUD = /\bcloud\b|streaming|en ligne via luna|jouable sur luna/i;

// Bonus de stream et contenu de jeu : offerts, mais ce ne sont pas des jeux.
const STREAM_BONUS = /\btwitch\b|\bdrops\b|\bbadges?\b|en (?:visionnant|regardant)|\bstreams?\b/i;
const GAME_CONTENT = /\bemotes?\b|\bpour avatar\b|\bjours? de jeu\b|\btenues?\b|\b(?:starter|bonus|welcome|founder'?s?|supporter) pack\b|\bpack (?:de )?(?:d[ée]marrage|bienvenue|bonus|ressources)|\bpack\b.*\bpour\b|\s[-–:]\s[^-–:]*\bpack\b/i;
// … sauf les vrais jeux et lots de jeux (« Jackbox Party Pack », « pack de 5 jeux »)
const GAME_PACK = /\bparty pack\b|\bpack de \d+ jeux\b/i;
const mobileOnly = (t) => /\b(android|ios|iphone|ipad|play store|google play|app store)\b/i.test(t) && !/\b(pc|windows|mac|steam|gog)\b/i.test(t);

// Offert, mais pas un jeu PC à garder.
const notKeepable = (title, merchant = '') => NOT_KEEP.test(title) || STREAM_BONUS.test(title)
  || (GAME_CONTENT.test(title) && !GAME_PACK.test(title)) || mobileOnly(`${title} ${merchant}`);

export const isFreebieTitle = (title, merchant = '') => FREE_WORDS.test(title) && !notKeepable(title, merchant);
// Console seulement (l'Xbox App / Xbox PC, c'est le Microsoft Store sur PC).
const consoleOnly = (t) => /\b(ps[345]|playstation)\b/i.test(t) || (/\bxbox\b/i.test(t) && !/\b(pc|windows|xbox app|xbox pc|microsoft store)\b/i.test(t));
// Post qui regroupe plusieurs jeux (« 8 jeux offerts avec Prime en novembre »)
const MULTI = /^(\[[^\]]*\]\s*)*(\d+\s+)?jeux\b|s[ée]lection|\b\d+\s+jeux\b/i;

// Nom du jeu dans un titre Dealabs du type « Jeu Mafia offert sur PC (Dématérialisé - GOG) ».
export function freebieName(title) {
  const base = String(title || '')
    .replace(/^\s*(\[[^\]]*\]\s*)+/, '')
    .replace(/^(jeux?|le jeu)\s+(pc\s+)?/i, '');
  const [head] = base.split(/\s+(?:offerte?s?|gratuite?s?|gratuitement|free|jouable)\b/i);
  const name = head.split(/\s+(?:sur|pour|via|avec|on)\s+(?:pc|steam|epic|gog|amazon|prime|luna|le |l'|xbox|microsoft|battle)|\s*[([]/i)[0];
  // « Epic World - Hunt For Quest gratuit » : le tiret fait partie du nom. Sans « gratuit » après, il introduit un détail.
  return (head === base ? name.split(/\s+[-–]\s+/)[0] : name).trim();
}

/**
 * Jeu PC offert repéré sur Dealabs → même format que les autres sources de jeux gratuits.
 * Sert surtout pour Amazon Prime (pas d'API publique), le Microsoft Store et Battle.net.
 * @param settings réglages effectifs ; `stores` = liste des plateformes voulues
 */
export function dealabsFreebie(it, { stores = [], prime = false, maxAgeDays = 7 } = {}, now = Date.now()) {
  const title = it.title || '';
  if (!title || it.expired || (it.end && it.end < now) || (it.pubDate && now - it.pubDate > maxAgeDays * DAY)) return null;
  const price = parsePrice(it.priceText);
  if (price > 0) return null; // « … + poster offert à 19,99 € » est une promo
  if (!(isFreebieTitle(title, it.merchant) || (price === 0 && !notKeepable(title, it.merchant)))) return null;
  if (consoleOnly(title) || mentionsSwitch1(title) || mentionsSwitch2(title)) return null;
  const text = `${title} ${it.merchant || ''} ${stripHtml(it.description).slice(0, 600)}`;
  const isPrime = primeOnly(title, it.merchant, it.description);
  if (isPrime && !prime) return null;
  let store = pcPlatformOf(title, it.merchant);
  if (isPrime) {
    if (/\bluna\b/i.test(text) && CLOUD.test(text)) store = 'luna';
    else if (!store || store === 'amazon') store = /legacy games/i.test(text) ? 'legacy' : /microsoft store|xbox app/i.test(text) ? 'microsoft' : 'amazon';
  }
  if (!store || !stores.includes(store)) return null;
  const name = MULTI.test(title) ? title.replace(/^\s*(\[[^\]]*\]\s*)+/, '').trim() : freebieName(title) || title;
  if (name.length < 2) return null;
  return {
    source: 'dealabs',
    store,
    via: isPrime ? 'Amazon Prime' : 'Dealabs',
    title: name,
    url: it.link,
    images: [biggerImage(it.image)].filter(Boolean),
    start: it.pubDate || null,
    end: null,
    status: 'active',
    worth: null,
    description: stripHtml(it.description).slice(0, 280),
    prime: isPrime,
    multi: MULTI.test(title),
    cloud: store === 'luna',
  };
}

export function classifyDealabs(it, settings, now = Date.now()) {
  const title = it.title || '';
  if (it.expired || (it.end && it.end < now) || (it.temperature ?? 0) < 0 || /m[ée]ga ?thread|rejoint le catalogue/i.test(title)) return null;
  // Offert mais pas à garder (week-end gratuit, mobile, bonus de stream…) : ce n'est pas une promo non plus.
  const unpaid = !parsePrice(it.priceText);
  if (unpaid && FREE_WORDS.test(title) && notKeepable(title, it.merchant)) return null;
  // Les jeux PC offerts à garder vont dans « Jeux gratuits », pas dans les promos.
  if (unpaid && isFreebieTitle(title, it.merchant) && !consoleOnly(title) && !mentionsSwitch1(title) && !mentionsSwitch2(title)) return null;
  if (MIXED_FEEDS.includes(it.feed) && !/consoles|jeux vid/i.test(it.category)) return null;
  if (!title || NOT_A_GAME.test(title)) return null;
  // Offre vue sur une page Dealabs : toujours active, même postée il y a deux semaines.
  if (it.pubDate && now - it.pubDate > (it.verified ? 30 : settings.dealMaxAgeDays || 7) * DAY) return null;
  if (/frontalier/i.test(title)) return null;

  // Deals en magasin : seulement dans tes départements.
  const local = localDepartments(title);
  const depts = parseDepartments(settings.departments);
  if (local.length && !local.some((d) => depts.includes(d))) return null;
  if (it.local && !local.length) return null; // locale, sans département connu

  const switch1 = mentionsSwitch1(title);
  const switch2Only = !switch1 && mentionsSwitch2(title);
  if (switch2Only && !settings.switch2) return null;
  const isSwitch = switch1 || switch2Only;
  const keyshop = isKeyshop(it.merchant);
  const isPC = !isSwitch && (PC_WORDS.test(title) || ((keyshop || /steam|gog|epic|fanatical|humble|gamesplanet|green ?man/i.test(it.merchant)) && !OTHER_CONSOLES.test(title)));
  if (!isSwitch && !isPC) return null;
  const pcPlatform = isPC
    ? pcPlatformOf(title, it.merchant) || pcPlatformOf(stripHtml(it.description).slice(0, 400)) || (keyshop || STEAM_SELLERS.test(it.merchant || '') ? 'steam' : null)
    : null;
  if (pcPlatform && settings.stores && !settings.stores[pcPlatform]) return null;

  const text = `${title} ${stripHtml(it.description).slice(0, 800)}`;
  const priceError = !!it.priceError || PRICE_ERROR.test(text);
  const hot = !!it.hot || (it.temperature ?? 0) >= 100;
  const bundle = /\bbundle\b|pack de \d+ jeux|lot de \d+ jeux/i.test(title);
  const section = isSwitch ? 'switch' : bundle ? 'bundle' : 'pc';
  let channel;
  if (keyshop) channel = 'keyshop';
  else if (bundle) channel = 'bundle';
  else if (section === 'switch') channel = /nintendo/i.test(it.merchant) || /d[ée]mat[ée]rialis[ée]/i.test(title) ? 'eshop' : 'physical';
  else channel = 'official';
  const price = parsePrice(it.priceText);
  const normalPrice = price != null && it.refPrice > price ? it.refPrice : null;
  const discount = Number(/-\s?(\d{1,2})\s?%/.exec(title)?.[1]) || (normalPrice ? Math.round((1 - price / normalPrice) * 100) : null);
  // Le flux « hot » ne couvre que quelques heures : l'exiger ferait disparaître presque tous les jeux en boîte,
  // locaux comme nationaux (Amazon, Fnac…). Ils passent donc sans, sauf au niveau « Que les affaires de fou ».
  const needsHot = settings.dealabsOnlyHot && settings.level !== 'wide' && !(channel === 'physical' && settings.level !== 'strict');
  if (needsHot && !hot && !priceError) return null;
  // Niveau « affaires de fou » : très chaud, ou au moins moitié prix
  if (settings.level === 'strict' && !priceError && it.temperature != null && it.temperature < 300 && !(discount >= 50)) return null;
  if ((channel === 'keyshop' && settings.keyshops === false) || (channel === 'physical' && settings.physical === false) || (channel === 'bundle' && settings.bundles === false)) return null;

  const id = /-(\d{5,})(?:[/?#]|$)/.exec(it.link)?.[1] || normText(it.guid).slice(-40);

  return {
    id: `dl:${id}`,
    source: 'dealabs',
    section,
    channel,
    ...(section === 'bundle' ? { store: bundleStoreOf(it.merchant) } : {}),
    title,
    url: it.link,
    images: [biggerImage(it.image)].filter(Boolean),
    square: true,
    price,
    normalPrice,
    currency: 'EUR',
    discount,
    temperature: it.temperature ?? null,
    merchant: it.merchant || merchantInTitle(title) || 'Dealabs',
    platform: section === 'switch' ? (switch2Only ? 'switch2' : 'switch1') : pcPlatform,
    posted: it.pubDate,
    end: it.end || null,
    flags: { hot, priceError, free: price === 0, local: local.length > 0, bundle },
  };
}

// Magasin cité dans le titre quand Dealabs ne le donne pas (« … - Amazon / E.Leclerc »).
function merchantInTitle(title) {
  const t = ` ${normText(title)} `;
  const found = PHYSICAL_STORES.find((s) => t.includes(` ${normText(s)} `));
  return found ? found.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : '';
}

// Fusionne les items des flux (un même deal peut être dans « hot » et dans un groupe).
export function mergeDealabsItems(items) {
  const byGuid = new Map();
  for (const it of items) {
    const key = /-(\d{5,})(?:[/?#]|$)/.exec(it.link || it.guid || '')?.[1] || it.guid;
    const prev = byGuid.get(key);
    const live = it.verified ? it : prev?.verified ? prev : null; // page Dealabs : informations plus complètes
    const hot = it.feed === 'hot' || !!it.hot || !!prev?.hot;
    const priceError = it.feed === 'erreur' || !!it.priceError || !!prev?.priceError;
    // On garde la version « groupe » (catégorie fiable) quand elle existe.
    const base = prev && !MIXED_FEEDS.includes(prev.feed) ? prev : it;
    // Titre nettoyé ici aussi : le cache peut contenir des annonces lues par une ancienne version.
    const extra = live ? { temperature: live.temperature, refPrice: live.refPrice, end: live.end, expired: live.expired, local: live.local, verified: true } : {};
    byGuid.set(key, { ...base, ...extra, title: stripTemperature(base.title), feed: base.feed, hot, priceError });
  }
  return [...byGuid.values()];
}
