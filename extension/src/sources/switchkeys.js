// Clés Nintendo Switch / Switch 2 (marché gris) : Eneba, Kinguin, Instant Gaming.
// Chaque prix est comparé au prix officiel de l'eShop : une clé plus chère que l'eShop n'est pas une affaire.
import { ENDPOINTS } from '../config.js';
import { fetchJson, fetchText, decodeEntities, normTitle } from '../util.js';
import { sameGameStrict } from '../prefs.js';

const MAX_LOOKUPS = 25;
const MAX_ITEMS = 40;
const REF_TTL = 3 * 24 * 3600 * 1000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Cartes prépayées, abonnements, DLC, comptes partagés (« Access »)… : pas des jeux.
const NOT_KEY_GAME = /\b(dlc|v-?bucks|prepaid|pr[ée]pay[ée]e?|gift card|carte cadeau|eshop card|membership|switch online|abonnement|access|account|compte|season pass|expansion|upgrade|points?|coins?|booster|add-?on|happy home|m[ée]ga dimension|pass)\b/i;

// « X (Nintendo Switch 2) eShop Key EUROPE », « X EU Nintendo Switch CD Key », « X - Switch 2 »
export function parseKeyName(raw) {
  const s = decodeEntities(String(raw || ''));
  const m = /^(.*?)\s*(?:\(\s*Nintendo Switch( 2)?\s*\)|\bEU Nintendo Switch( 2)?\b(?=.*\bKey\b)|\s-\s(?:Nintendo )?Switch( 2)?\s*$)/i.exec(s);
  if (!m || NOT_KEY_GAME.test(s)) return null;
  if (/\b(united states|usa|us|latam|japan|australia|asia|brazil|uk)\b\s*$/i.test(s)) return null; // autre région que l'Europe
  const name = m[1].replace(/[\s:–-]+$/, '').replace(/\s*[–-]\s*nintendo switch( 2)? edition$/i, '').trim();
  return name.length > 1 ? { name, platform: m[2] || m[3] || m[4] ? 'switch2' : 'switch1' } : null;
}

export function parseEneba(html) {
  const raw = /<script id="__APOLLO_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''))?.[1];
  if (!raw) throw new Error('page Eneba inattendue');
  const state = JSON.parse(raw);
  const deref = (v) => (v?.__ref ? state[v.__ref] : v);
  const field = (o, name) => o?.[Object.keys(o || {}).find((k) => k === name || k.startsWith(`${name}(`))];
  const out = [];
  for (const p of Object.values(state)) {
    if (p?.__typename !== 'Product' || p.type?.value !== 'GAME') continue;
    const key = parseKeyName(p.name);
    const auction = deref(field(p, 'cheapestAuction'));
    if (!key || !auction || auction.isInStock === false) continue;
    const price = Number(field(auction, 'price')?.amount) / 100;
    if (!(price > 0)) continue;
    const cover = field(p, 'cover');
    out.push({ ...key, price, msrp: Number(field(auction, 'msrp')?.amount) / 100 || null, merchant: 'Eneba', url: `https://www.eneba.com/fr/${p.slug}`, image: cover?.src || (typeof cover === 'string' ? cover : null), ref: `eneba-${p.slug}` });
  }
  return out;
}

export function parseKinguin(data) {
  const list = data?._embedded?.products;
  if (!Array.isArray(list)) throw new Error('réponse Kinguin inattendue');
  const out = [];
  for (const p of list) {
    const key = parseKeyName(p?.name);
    const cents = Number(p?.price?.lowestOffer);
    if (!key || !(cents > 0) || cents >= 100000) continue; // 10 000 € = rupture de stock
    out.push({ ...key, price: cents / 100, msrp: null, merchant: 'Kinguin', url: `https://www.kinguin.net/category/${p.externalId}/${p.attributes?.urlKey || ''}`, image: p.imageUrl || null, ref: `kinguin-${p.externalId}` });
  }
  return out;
}

export function parseInstantGaming(html) {
  const s = String(html || '');
  const prices = new Map([...s.matchAll(/"item_id":(\d+),"price":"[\d.]+","price_eur":"([\d.]+)"/g)].map((m) => [m[1], Number(m[2])]));
  const out = new Map();
  for (const m of s.matchAll(/<a\b[^>]*>/gi)) {
    const href = /href="(https:\/\/www\.instant-gaming\.com\/fr\/(\d+)-[^"]+)"/i.exec(m[0]);
    const title = /title="([^"]+)"/i.exec(m[0])?.[1];
    if (!href || !title || !prices.has(href[2])) continue;
    const key = parseKeyName(decodeEntities(title).replace(/^acheter\s+/i, ''));
    if (key) out.set(href[2], { ...key, price: prices.get(href[2]), msrp: null, merchant: 'Instant Gaming', url: href[1], image: null, ref: `ig-${href[2]}` });
  }
  return [...out.values()];
}

// Prix officiel eShop d'un jeu (normal et du moment).
async function eshopReference(key) {
  const params = new URLSearchParams({
    q: key.name.replace(/[^\p{L}\p{N} ]+/gu, ' '), rows: '8', start: '0', wt: 'json',
    fq: `type:GAME AND playable_on_txt:${key.platform === 'switch2' ? 'BEE' : 'HAC'}`,
    fl: 'title,price_regular_f,price_lowest_f,publisher,image_url_h2x1_s,image_url',
  });
  const docs = (await fetchJson(`${ENDPOINTS.eshopSearch}?${params}`))?.response?.docs || [];
  const doc = docs.find((d) => Number(d.price_regular_f) > 0 && sameGameStrict(d.title.replace(/\s*[–-]\s*nintendo switch.*edition$/i, ''), key.name));
  return doc ? { regular: Number(doc.price_regular_f), now: Number(doc.price_lowest_f) || Number(doc.price_regular_f), nintendo: /^nintendo$/i.test(String(doc.publisher || '').trim()), image: doc.image_url_h2x1_s || doc.image_url || null } : null;
}

const refKey = (k) => `${k.platform}:${normTitle(k.name)}`;

export function buildKeyDeals(keys, refs, settings) {
  const best = new Map();
  for (const k of keys) {
    if (k.platform === 'switch2' && !settings.switch2) continue;
    const ref = refs[refKey(k)]?.ref;
    const normal = ref?.regular || k.msrp;
    if (!normal || normal < 14.99) continue;
    const discount = Math.round((1 - k.price / normal) * 100);
    if (discount < (ref?.nintendo ? 20 : settings.switchMinDiscount)) continue;
    if (ref && k.price > ref.now * 0.9) continue; // à peine moins cher que l'eShop : le prix officiel est plus sûr
    const id = refKey(k);
    if (best.has(id) && best.get(id).price <= k.price) continue;
    best.set(id, {
      id: `key:${k.ref}`,
      source: 'switchkeys',
      section: 'switch',
      channel: 'keyshop',
      title: k.name,
      url: k.url,
      images: [ref?.image, k.image].filter(Boolean),
      price: k.price,
      normalPrice: normal,
      currency: 'EUR',
      discount,
      merchant: k.merchant,
      platform: k.platform,
      posted: null,
      end: null,
      flags: { nintendo: !!ref?.nintendo },
    });
  }
  return [...best.values()].sort((a, b) => b.discount - a.discount).slice(0, MAX_ITEMS);
}

/** @param refs prix eShop déjà lus, modifié en place */
export async function fetchSwitchKeys(settings, refs = {}, now = Date.now()) {
  const keys = [];
  const errors = [];
  const add = async (name, job) => {
    try {
      keys.push(...(await job()));
    } catch (e) {
      errors.push(`${name} : ${e?.message || e}`);
      console.warn(`[FreeKeep] clés ${name} :`, e);
    }
  };
  const kinguin = (extra) => fetchJson(`${ENDPOINTS.kinguin}?${new URLSearchParams({ platforms: '17', countries: 'FR', active: '1', size: '60', ...extra })}`);
  await Promise.all([
    add('Eneba', async () => {
      const first = parseEneba(await fetchText(ENDPOINTS.enebaSwitch, { timeout: 25000 }));
      await pause(1000);
      return [...first, ...parseEneba(await fetchText(`${ENDPOINTS.enebaSwitch}?page=2`, { timeout: 25000 }))];
    }),
    add('Kinguin', async () => {
      const first = parseKinguin(await kinguin({ sort: 'bestseller.total,DESC' }));
      await pause(2000); // délai demandé par le site
      return [...first, ...parseKinguin(await kinguin({ sort: 'bestseller.total,DESC', page: '1' }))];
    }),
    add('Instant Gaming', async () => parseInstantGaming(await fetchText(ENDPOINTS.igSwitch, { timeout: 25000 }))),
  ]);
  if (!keys.length) throw new Error(errors.join(' ; ') || 'aucune clé trouvée');

  let left = MAX_LOOKUPS;
  for (const k of keys) {
    const id = refKey(k);
    if ((refs[id] && now - refs[id].at < REF_TTL) || left <= 0 || (k.platform === 'switch2' && !settings.switch2)) continue;
    left -= 1;
    try {
      refs[id] = { ref: await eshopReference(k), at: now };
    } catch {
      break;
    }
    await pause(150);
  }
  for (const [id, r] of Object.entries(refs)) if (now - r.at > 10 * REF_TTL) delete refs[id];
  return buildKeyDeals(keys, refs, settings);
}
