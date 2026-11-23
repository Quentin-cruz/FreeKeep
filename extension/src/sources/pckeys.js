// Clés Steam PC (marché gris) : Eneba et Instant Gaming, lus directement, sans compte ni clé API.
// Chaque clé est comparée au prix officiel en euros sur Steam (recherche du store) : une clé à peine
// moins chère que Steam n'est pas une affaire.
import { ENDPOINTS } from '../config.js';
import { fetchJson, fetchText, decodeEntities, normTitle } from '../util.js';
import { sameGameStrict } from '../prefs.js';
import { steamHeaderImages } from './cheapshark.js';

const MAX_LOOKUPS = 30;      // recherches Steam par vérification
const REF_TTL = 3 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const LOW_AFTER = 30 * DAY;  // « plus bas » seulement après un mois de suivi
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Abonnements, cartes, DLC, comptes partagés… : pas des jeux.
const NOT_KEY_GAME = /\b(dlc|season pass|expansion|upgrade|soundtrack|ost|account|compte|gift card|carte cadeau|wallet|prepaid|pr[ée]pay[ée]e?|points?|coins?|add-?on|booster|bundle|pass)\b/i;
const GOOD_REGION = /^(?:global|europe|eu|eu\/uk|eu & uk|france|fr|world ?wide|ww)?$/i;

/**
 * « Elden Ring (PC) Clé Steam EUROPE », « Ready or Not Steam Key (PC) GLOBAL » (Eneba),
 * « Football Manager 27 - PC & Mac (Steam) » (Instant Gaming) → { name }, ou null.
 */
export function parsePcKeyName(raw) {
  const s = decodeEntities(String(raw || '')).replace(/\s+/g, ' ').trim();
  if (!s || NOT_KEY_GAME.test(s)) return null;
  const eneba = /^(.*?)\s*(?:\(PC\)\s*)?(?:cl[ée] steam|steam (?:cd[- ])?key)\s*(?:\(PC\)\s*)?(.*)$/i.exec(s);
  const ig = /^(.*?)\s+-\s+PC(?:\s*&\s*Mac)?(?:\s*&\s*Linux)?\s*\(Steam\)\s*(?:-\s*(.*))?$/i.exec(s);
  const m = eneba || ig;
  if (!m || !GOOD_REGION.test((m[2] || '').trim())) return null;
  const name = m[1].replace(/\s*\(PC\)\s*$/i, '').replace(/[\s:–-]+$/, '').trim();
  return name.length > 1 ? { name } : null;
}

export function parseEnebaPc(html) {
  const raw = /<script id="__APOLLO_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''))?.[1];
  if (!raw) throw new Error('page Eneba inattendue');
  const state = JSON.parse(raw);
  const deref = (v) => (v?.__ref ? state[v.__ref] : v);
  const field = (o, name) => o?.[Object.keys(o || {}).find((k) => k === name || k.startsWith(`${name}(`))];
  const out = [];
  for (const p of Object.values(state)) {
    if (p?.__typename !== 'Product' || p.type?.value !== 'GAME') continue;
    const key = parsePcKeyName(p.name);
    const auction = deref(field(p, 'cheapestAuction'));
    if (!key || !auction || auction.isInStock === false) continue;
    const price = Number(field(auction, 'price')?.amount) / 100;
    if (!(price > 0)) continue;
    out.push({ ...key, price, merchant: 'Eneba', url: `https://www.eneba.com/fr/${p.slug}`, ref: `eneba-${p.slug}` });
  }
  return out;
}

export function parseInstantGamingPc(html) {
  const s = String(html || '');
  const json = new Map([...s.matchAll(/"item_id":(\d+),"price":"[\d.]+","price_eur":"([\d.]+)"/g)].map((m) => [m[1], Number(m[2])]));
  const out = new Map();
  for (const block of s.split(/<article\b/i).slice(1)) {
    const a = /<a\b[^>]*href="(https:\/\/www\.instant-gaming\.com\/fr\/(\d+)-[^"]+)"[^>]*>/i.exec(block);
    if (!a) continue;
    const title = /title="([^"]+)"/i.exec(a[0])?.[1] || /class="title"[^>]*title="([^"]+)"/i.exec(block)?.[1];
    const shown = /class="\s*price\s*"[^>]*>\s*([\d]+(?:[.,]\d+)?)\s*(?:&nbsp;|\s)*€/i.exec(block);
    const price = json.get(a[2]) ?? (shown ? Number(shown[1].replace(',', '.')) : NaN);
    const key = title && parsePcKeyName(decodeEntities(title).replace(/^acheter\s+/i, ''));
    if (key && price > 0) out.set(a[2], { ...key, price, merchant: 'Instant Gaming', url: a[1], ref: `ig-${a[2]}` });
  }
  return [...out.values()];
}

/** Fiche Steam du jeu : appid, prix normal et prix du moment en euros. */
export function pickSteamRef(data, name) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const it = items.find((i) => i?.type === 'app' && i.price?.initial > 0 && sameGameStrict(i.name, name));
  if (!it) return null;
  return { appid: String(it.id), title: it.name.replace(/[™®©]/g, '').trim(), regular: it.price.initial / 100, now: (it.price.final ?? it.price.initial) / 100, meta: Number(it.metascore) || null };
}

async function steamReference(name) {
  const params = new URLSearchParams({ term: name.replace(/[^\p{L}\p{N}' ]+/gu, ' ').trim(), cc: 'fr', l: 'french' });
  return pickSteamRef(await fetchJson(`${ENDPOINTS.steamStoreSearch}?${params}`), name);
}

const refKey = (k) => normTitle(k.name);

/**
 * @param keys  clés lues sur les sites
 * @param refs  { [nom]: { ref, at } } fiches Steam
 * @param lows  { [appid]: { price, since } } plus bas prix « clé » vu par FreeKeep<3 (modifié en place)
 * @returns { items, prices } : bons plans clés, et meilleur prix « clé » par appid Steam
 */
export function buildPcKeyDeals(keys, refs, lows = {}, now = Date.now()) {
  const best = new Map();
  for (const k of keys) {
    const ref = refs[refKey(k)]?.ref;
    if (!ref) continue;
    if (best.has(ref.appid) && best.get(ref.appid).k.price <= k.price) continue;
    best.set(ref.appid, { k, ref });
  }
  const items = [];
  const prices = {};
  for (const [appid, { k, ref }] of best) {
    prices[appid] = { keyshop: k.price, currency: 'EUR', url: k.url, merchant: k.merchant };
    const low = lows[appid];
    const historicLow = !!low && now - low.since >= LOW_AFTER && k.price <= low.price + 0.005;
    lows[appid] = { price: Math.min(k.price, low?.price ?? Infinity), since: low?.since ?? now, at: now };
    const discount = Math.round((1 - k.price / ref.regular) * 100);
    items.push({
      id: `pckey:${appid}`,
      source: 'pckeys',
      section: 'pc',
      channel: 'keyshop',
      title: ref.title,
      url: k.url,
      images: steamHeaderImages(appid),
      price: k.price,
      normalPrice: ref.regular,
      currency: 'EUR',
      discount,
      merchant: k.merchant,
      steamAppID: appid,
      platform: 'steam',
      steamNow: ref.now,
      rating: ref.meta ? { metacritic: ref.meta } : undefined,
      end: null,
      posted: null,
      flags: { historicLow, watch: true },
      // Visible seulement si c'est une vraie affaire (voir deals.js) : sinon simple surveillance du prix.
      candidate: ref.regular >= 14.99 && discount >= 50 && k.price <= ref.now * 0.9,
    });
  }
  return { items, prices };
}

/**
 * Ajoute les prix trouvés par la recherche ciblée (NEXARDA) : le moins cher gagne,
 * sur la carte « clé » comme sur le prix affiché à côté des promos officielles.
 * @param built  résultat de buildPcKeyDeals
 * @param found  { [appid]: { keyshop, currency, url, merchant, code, shops } }
 * @param lows   plus bas prix vus (modifié en place)
 */
export function mergeKeyPrices(built, found = {}, lows = {}, now = Date.now()) {
  const prices = { ...built.prices };
  const items = built.items.map((d) => ({ ...d, flags: { ...d.flags } }));
  for (const [appid, p] of Object.entries(found)) {
    if (!(p?.keyshop > 0)) continue;
    if (!prices[appid] || p.keyshop < prices[appid].keyshop) prices[appid] = { ...p };
    const low = lows[appid];
    lows[appid] = { price: Math.min(p.keyshop, low?.price ?? Infinity), since: low?.since ?? now, at: now };
    const d = items.find((i) => i.steamAppID === appid);
    if (!d || p.keyshop >= d.price) continue;
    d.flags.historicLow = !!low && now - low.since >= LOW_AFTER && p.keyshop <= low.price + 0.005;
    Object.assign(d, { price: p.keyshop, url: p.url, merchant: p.merchant, code: p.code || null, discount: Math.round((1 - p.keyshop / d.normalPrice) * 100) });
    d.candidate = d.normalPrice >= 14.99 && d.discount >= 50 && d.price <= (d.steamNow ?? d.normalPrice) * 0.9;
  }
  return { items, prices };
}

/**
 * @param refs fiches Steam déjà lues (modifié en place)
 * @param lows plus bas prix vus (modifié en place)
 */
export async function fetchPcKeys(refs = {}, lows = {}, now = Date.now()) {
  const keys = [];
  const errors = [];
  const add = async (name, job) => {
    try {
      keys.push(...(await job()));
    } catch (e) {
      errors.push(`${name} : ${e?.message || e}`);
      console.warn(`[FreeKeep] clés PC ${name} :`, e);
    }
  };
  await Promise.all([
    add('Eneba', async () => {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        if (page > 1) await pause(1000);
        out.push(...parseEnebaPc(await fetchText(`${ENDPOINTS.enebaPc}${page > 1 ? `?page=${page}` : ''}`, { timeout: 25000 })));
      }
      return out;
    }),
    add('Instant Gaming', async () => parseInstantGamingPc(await fetchText(ENDPOINTS.igPc, { timeout: 25000 }))),
  ]);
  if (!keys.length) throw new Error(errors.join(' ; ') || 'aucune clé trouvée');

  let left = MAX_LOOKUPS;
  for (const k of keys) {
    const id = refKey(k);
    if ((refs[id] && now - refs[id].at < REF_TTL) || left <= 0) continue;
    left -= 1;
    try {
      refs[id] = { ref: await steamReference(k.name), at: now };
    } catch {
      break; // Steam sature : on reprendra à la prochaine vérification
    }
    await pause(300);
  }
  for (const [id, r] of Object.entries(refs)) if (now - r.at > 10 * REF_TTL) delete refs[id];
  const built = buildPcKeyDeals(keys, refs, lows, now);
  for (const [appid, l] of Object.entries(lows)) if (now - (l.at ?? l.since) > 90 * DAY) delete lows[appid];
  return built;
}
