// Assemble les bons plans (PC + Switch) : dédoublonnage, chutes de prix, score, affaires exceptionnelles.
import { titlesMatch, titleContains } from './util.js';
import { eshopRankBonus } from './sources/eshop.js';
import { toEur } from './sources/rates.js';
import { extractGameName, gameKey } from './titles.js';

const DAY = 24 * 3600 * 1000;

// Annonces qui couvrent plusieurs jeux : elles ne désignent pas un jeu précis.
const MANY_GAMES = /s[ée]lection|franchise|promotion|rembours|r[ée]duction|\bjeux\b|m[ée]ga ?thread|\d+\s?% de/i;
// Clé du jeu d'une annonce (null si elle en couvre plusieurs).
export function dealKey(d) {
  // L'abonnement mensuel Humble s'écrit de plusieurs façons : « Humble Choice (#84) », « Humble Bundle Choice - Novembre »
  if (d.section === 'bundle' && /humble/i.test(`${d.title} ${d.merchant}`) && /\bchoice\b/i.test(d.title)) return 'humblechoice';
  if (d.source === 'dealabs' && MANY_GAMES.test(d.title)) return null;
  const title = d.section === 'bundle'
    ? String(d.title).replace(/\s*[([].*$/, '').replace(/\s+sur\s+PC\b.*$/i, '').replace(/\b(?:bundle|humble|fanatical|build your own)\b/gi, ' ')
    : d.source === 'dealabs' ? extractGameName(d.title) : d.title;
  const key = gameKey(title);
  return key.length >= 2 ? key : null;
}

/** Une seule carte par jeu, console et type d'offre : la moins chère, les autres en « Aussi ». */
export function groupDeals(deals) {
  const groups = new Map();
  const out = [];
  for (const d of deals) {
    const key = dealKey(d);
    if (!key) {
      out.push(d);
      continue;
    }
    const id = [d.section, d.section === 'bundle' ? String(d.merchant).toLowerCase() : d.channel, d.section === 'switch' ? d.platform : '', key].join('|');
    if (!groups.has(id)) {
      groups.set(id, []);
      out.push(groups.get(id));
    }
    groups.get(id).push(d);
  }
  return out.map((g) => {
    if (!Array.isArray(g)) return g;
    if (g.length === 1) return g[0];
    const sorted = [...g].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    // À prix inconnu, l'annonce la plus complète (contenu du bundle) reste devant.
    const best = { ...sorted[0], ...(sorted[0].bundle ? {} : { bundle: sorted.find((d) => d.bundle)?.bundle }) };
    if (!best.bundle) delete best.bundle;
    const flags = { ...best.flags };
    for (const d of sorted) for (const f of ['hot', 'wishlist', 'nintendo']) flags[f] ||= !!d.flags?.[f];
    return {
      ...best,
      flags,
      ids: sorted.map((d) => d.id),
      steamAppID: best.steamAppID || sorted.find((d) => d.steamAppID)?.steamAppID || null,
      temperature: sorted.some((d) => d.temperature != null) ? Math.max(...sorted.map((d) => d.temperature ?? 0)) : best.temperature ?? null,
      normalPrice: best.normalPrice ?? sorted.find((d) => d.normalPrice)?.normalPrice ?? null,
      discount: best.discount ?? (best.price != null && sorted.find((d) => d.normalPrice > best.price) ? Math.round((1 - best.price / sorted.find((d) => d.normalPrice > best.price).normalPrice) * 100) : null),
      images: [...new Set(sorted.flatMap((d) => d.images || []))].slice(0, 4),
      others: sorted.slice(1, 5).map((d) => ({ merchant: d.merchant, edition: d.source !== 'dealabs' && d.title !== best.title ? d.title : null, price: d.price, currency: d.currency, approx: !!d.approx, url: d.url })),
    };
  });
}
const sameGame = (a, b) => titlesMatch(a.title, b.title) || titleContains(a.title, b.title) || titleContains(b.title, a.title);

export function isExceptional(d) {
  const f = d.flags || {};
  const disc = d.discount ?? 0;
  return !!(
    f.priceError ||
    f.drop ||
    (f.wishlist && disc >= 50) ||
    (f.historicLow && disc >= 75) ||
    (f.hot && (f.free || disc >= 60)) ||
    (f.hot && d.channel === 'physical' && disc >= 40) ||
    (d.channel === 'bundle' && f.wishlist) ||
    (d.section === 'switch' && f.nintendo && disc >= 40) ||
    (d.section === 'switch' && d.channel === 'eshop' && f.popular && disc >= 60 && (d.normalPrice ?? 0) >= 39.99)
  );
}

export function scoreDeal(d) {
  const f = d.flags || {};
  // Un jeu en boîte n'a presque jamais de remise affichée : sans ça, il finirait toujours en bas de liste.
  // Avec la température (pages Dealabs), elle fait le tri : une vraie remise connue passe devant.
  const physical = d.channel === 'physical';
  let s = d.discount != null ? d.discount + (physical ? 15 : 0) : physical ? (d.temperature ? 60 : 80) : 50;
  if (f.priceError) s += 80;
  if (f.drop) s += 35;
  if (f.historicLow) s += 15;
  if (f.hot) s += 20;
  if (f.wishlist) s += 30;
  if (f.aaa) s += 10;
  if (f.nintendo) s += 25;
  if (d.source === 'eshop') s += eshopRankBonus(d.rank);
  if (d.temperature) s += Math.min(30, d.temperature / 25);
  if (d.bundle) s += 10 + 3 * d.bundle.good;
  if ((d.rating?.gog ?? 0) >= 4.6) s += 8;
  if ((d.rating?.metacritic ?? 0) >= 85) s += 10;
  if ((d.rating?.steam ?? 0) >= 95) s += 8;
  return s;
}

const asOffer = (d) => ({ price: d.price, normalPrice: d.normalPrice, discount: d.discount, merchant: d.merchant, url: d.url, currency: d.currency, approx: !!d.approx, end: d.end ?? null });

// L'offre la moins chère devient l'offre principale.
function pickBest(d) {
  const best = Object.entries(d.offers || {}).sort(([, a], [, b]) => a.price - b.price)[0];
  return best ? Object.assign(d, best[1], { platform: best[0] }) : d;
}

/** Prix en euros : exacts pour Steam (fiches officielles), convertis au taux BCE pour les autres (« ≈ »). */
export function applyEuros(items, steam, rate) {
  for (const d of items) {
    const st = steam[d.steamAppID];
    const known = st?.game && st.normal > 0 ? st : null;
    for (const [platform, o] of Object.entries(d.offers || {})) {
      if (o.currency !== 'USD') continue;
      o.price = toEur(o.price, rate);
      o.normalPrice = platform === 'steam' && known ? known.normal : toEur(o.normalPrice, rate);
      o.discount = o.normalPrice > o.price ? Math.round((1 - o.price / o.normalPrice) * 100) : o.discount;
      o.currency = 'EUR';
      o.approx = true;
    }
    if (d.offers?.steam && known && known.price != null && known.discount >= 20 && known.price <= d.offers.steam.price) {
      d.offers.steam = { price: known.price, normalPrice: known.normal, discount: known.discount, merchant: 'Steam', url: `https://store.steampowered.com/app/${d.steamAppID}/`, currency: 'EUR', approx: false, end: known.end };
    }
    if (d.offers && Object.keys(d.offers).length) pickBest(d);
    else if (d.currency === 'USD') Object.assign(d, { price: toEur(d.price, rate), normalPrice: toEur(d.normalPrice, rate), currency: 'EUR', approx: true });
  }
  return items;
}

// Réunit les offres d'un même jeu PC : une carte, un prix par launcher.
export function mergeLaunchers(main, extras) {
  const out = [...main];
  for (const d of extras) {
    const key = dealKey(d);
    const twin = out.find((o) => o.section === 'pc' && ((d.steamAppID && o.steamAppID && String(o.steamAppID) === String(d.steamAppID)) || (key && dealKey(o) === key)));
    if (!twin) {
      out.push({ ...d, offers: { [d.platform]: asOffer(d) } });
      continue;
    }
    twin.ids = [...(twin.ids || [twin.id]), d.id];
    for (const f of ['hot', 'priceError']) if (d.flags?.[f]) twin.flags[f] = true;
    if (d.temperature != null) twin.temperature = Math.max(twin.temperature ?? 0, d.temperature);
    if (d.source === 'dealabs') twin.dealabsUrl = d.url;
    twin.offers ||= { [twin.platform]: asOffer(twin) };
    const prev = twin.offers[d.platform];
    if (!prev || d.price <= prev.price) twin.offers[d.platform] = asOffer(d);
    if (d.flags?.wishlist) twin.flags.wishlist = true;
    pickBest(twin);
  }
  return out;
}

/**
 * @param lists   { cheapshark, ggdeals, eshop, dealabs } — items déjà filtrés par chaque source
 * @param history { [id]: { price, at } } — dernier prix vu (modifié en place)
 * @param gg      { [appid]: prix GG.deals } — pour afficher le prix « clé » à côté d'une promo officielle
 */
export function buildDeals(lists, history = {}, gg = {}, now = Date.now()) {
  const official = [
    ...mergeLaunchers(lists.cheapshark || [], [
      ...(lists.wishlist || []), ...(lists.gog || []), ...(lists.ea || []),
      ...(lists.dealabs || []).filter((d) => d.section === 'pc' && d.channel === 'official' && d.platform && d.price > 0 && dealKey(d)),
    ]),
    ...(lists.eshop || []),
  ];
  const extra = [];

  // Dealabs : si le deal existe déjà via une source officielle, on fusionne (badge « hot » / erreur de prix).
  for (const d of lists.dealabs || []) {
    if (official.some((o) => o.id === d.id || o.ids?.includes(d.id))) continue; // déjà réuni avec un launcher
    const twin = official.find((o) => o.section === d.section && (o.channel === d.channel || (o.channel === 'official' && d.channel === 'official')) && sameGame(o, d));
    if (twin) {
      twin.flags.hot ||= d.flags.hot;
      twin.flags.priceError ||= d.flags.priceError;
      twin.dealabsUrl = d.url;
    } else {
      extra.push(d);
    }
  }

  // GG.deals : prix « clé » affiché sur les promos officielles + bons plans clés exceptionnels.
  for (const d of official) {
    const p = d.steamAppID && gg[d.steamAppID];
    if (p?.keyshop != null) d.keyshop = { price: p.keyshop, currency: p.currency, url: p.url };
  }
  const keyDeals = [];
  for (const k of lists.ggdeals || []) {
    if (official.some((o) => o.steamAppID && o.steamAppID === k.steamAppID)) continue;
    keyDeals.push(k);
  }

  const all = [...official, ...keyDeals, ...(lists.bundles || []), ...(lists.switchkeys || []), ...extra];

  // Chute soudaine : prix au moins 30 % plus bas qu'à la vérification précédente (moins de 10 jours).
  for (const d of all) {
    if (d.price == null) continue;
    // Un prix passé du dollar à l'euro n'est pas une chute de prix.
    const prev = history[d.id]?.currency === d.currency || !history[d.id]?.currency ? history[d.id] : null;
    if (prev && prev.price > 0 && d.price <= prev.price * 0.7 && now - prev.at < 10 * DAY) {
      d.flags.drop = true;
      d.prevPrice = prev.price;
    } else if (prev?.dropUntil && prev.dropUntil > now && d.price <= prev.price) {
      d.flags.drop = true; // on garde le badge 24 h
      d.prevPrice = prev.prevPrice;
    }
    const keepDrop = d.flags.drop ? { dropUntil: prev?.dropUntil && prev.dropUntil > now ? prev.dropUntil : now + DAY, prevPrice: d.prevPrice } : {};
    history[d.id] = { price: d.price, currency: d.currency, at: now, ...keepDrop };
  }
  for (const [id, h] of Object.entries(history)) if (now - h.at > 30 * DAY) delete history[id];

  return groupDeals(all.filter((d) => d.source !== 'ggdeals' || d.candidate || d.flags.drop))
    .map((d) => ({ ...d, exceptional: isExceptional(d), score: scoreDeal(d) }))
    .sort((a, b) => b.score - a.score);
}
