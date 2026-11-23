// Sélection : ce qui mérite d'être montré d'abord, et dans quel ordre.
// Un jeu compte par l'envie qu'il donne (ventes du moment, votes), sa qualité, son âge, puis son prix.
// Rien n'est supprimé, à part les DLC : le reste attend derrière « Voir tout ».
import { LEVELS } from './config.js';

const YEAR = 365.25 * 24 * 3600 * 1000;
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Nombre de cartes montrées d'abord, par section. */
export const limitsFor = (settings) => (LEVELS[settings.level] || LEVELS.balanced).limits;
const barFor = (settings) => (LEVELS[settings.level] || LEVELS.balanced).bar;

export const ageOf = (released, now = Date.now()) => (released ? Math.max(0, (now - released) / YEAR) : null);

/** Remise mini selon l'âge : un jeu sorti cette année n'est jamais à -60 %. */
export function minDiscountFor(age, base) {
  if (age == null || age >= 4) return base;
  return Math.max(20, Math.round(base * (age < 1 ? 0.45 : age < 2 ? 0.55 : 0.8)));
}

// Extensions, kits, passes… vendus à côté d'un jeu.
const ADDON = /\b(dlc|season pass|pass (?:de )?saison|expansion(?: pass)?|extension|add-?on|disque additionnel|pack d['’]extension|kit d['’]objets|raccourcis|shortcut (?:kit|bundle)|soundtrack|bande originale|artbook)\b|\bsims\W*[34]\W+\p{L}/iu;
export const isAddon = (d, info) => d.section === 'pc' && d.channel !== 'bundle' && !d.flags?.wishlist
  && (info?.game === false || (d.source !== 'dealabs' && !info && ADDON.test(d.title)));

// Édition plus chère que le jeu seul : le prix Steam du jeu ne lui sert pas de référence.
const OTHER_EDITION = /\b(?:deluxe|ultimate|gold|complete|collection|trilog\w*|bundle|premium|[ée]dition)\b|\/|\bou\b|\+/i;

/** Annonce Dealabs sans prix de départ : celui de Steam. */
export function fillReference(d, info) {
  if (d.section !== 'pc' || d.channel === 'bundle' || d.discount != null || !(d.price > 0) || !(info?.normal > 0) || OTHER_EDITION.test(d.title)) return;
  if (d.price >= info.normal) return;
  d.normalPrice = info.normal;
  d.discount = Math.round((1 - d.price / info.normal) * 100);
}

const freshness = (age, max) => (age == null ? max * 0.35 : age < 1 ? max : age < 2 ? max * 0.9 : age < 4 ? max * 0.7 : age < 6 ? max * 0.45 : age < 8 ? max * 0.2 : 0);
const voted = (d, min) => (d.temperature != null ? d.temperature >= min : !!d.flags?.hot);

function judgePc(d, { info, rank, bar, settings, now }) {
  const f = d.flags || {};
  // Ressortie sur Steam d'un vieux jeu : la date la plus ancienne compte.
  const dates = [info?.released, d.released].filter(Boolean);
  const age = ageOf(dates.length ? Math.min(...dates) : null, now);
  const rating = info?.rating ?? d.rating?.steam ?? null;
  const reviews = info?.reviews || d.rating?.steamCount || 0;
  const gog = d.rating?.gog ?? null;
  const known = rating != null && reviews > 0;
  const liked = known
    ? reviews >= bar.reviews && (rating >= bar.rating || ((d.rating?.metacritic ?? 0) >= 82 && rating >= 72))
    : gog != null ? gog >= 4.3 && (d.rating.gogCount ?? 0) >= 300 : null;

  let why = null;
  if (age != null && age > settings.pcMaxAge) why = 'old';
  else if (liked === false) why = 'rating';
  else if (age == null && liked !== true && (d.normalPrice ?? 0) < 39.99) why = 'unknown';
  else if (d.discount != null && d.discount < minDiscountFor(age, settings.pcMinDiscount)) why = 'price';
  // Petit jeu à petite remise : quelques euros d'économie, pas une affaire
  else if ((d.normalPrice ?? 99) < 10 && (d.discount ?? 0) < 70) why = 'price';
  else if (d.channel === 'keyshop' && !voted(d, bar.votes)) why = 'votes';
  // Une annonce très plébiscitée passe malgré tout ; un souhait ou une erreur de prix toujours.
  const good = !why || !!f.wishlist || !!f.priceError || voted(d, d.source === 'dealabs' && !known ? bar.votes : bar.bigVotes);

  const demand = Math.max(
    rank ? 10 + 22 * clamp(1 - (rank - 1) / 250) : 0,
    d.temperature ? Math.min(30, d.temperature / 20) : f.hot ? 12 : 0,
    reviews ? clamp((Math.log10(reviews) - 2.5) * 5, 0, 12) : 0,
  );
  const quality = rating != null ? 25 * clamp((rating - 70) / 25) : gog != null ? 25 * clamp((gog - 3.8) / 1.1) : 9;
  // Le prix pèse autant que l'envie : on cherche des affaires, pas seulement des jeux connus.
  const price = 35 * clamp((d.discount ?? 0) / 85) + (f.historicLow ? 6 : 0);
  return { good, why: good ? null : why, age, score: demand + quality + freshness(age, 20) + price };
}

const KNOWN_RANK = 500;   // téléchargements eShop
const EVERGREEN_RANK = 60; // vieux, mais toujours très demandé

function judgeSwitch(d, { bar, settings, now }) {
  const f = d.flags || {};
  const age = ageOf(d.released, now);
  const rank = d.rank ?? null;
  let why = null;
  if (!(f.nintendo || f.priceError || f.local || voted(d, bar.votes))) {
    if (d.source === 'dealabs') why = 'votes';
    else if (rank == null || rank > KNOWN_RANK) why = 'unknown';
    else if (age != null && age > settings.pcMaxAge && rank > EVERGREEN_RANK) why = 'old';
  }
  const demand = Math.max(rank ? 40 * clamp(1 - (rank - 1) / 900) : 0, d.temperature ? Math.min(40, d.temperature / 15) : f.hot ? 16 : 0);
  return {
    good: !why, why, age,
    score: demand + (f.nintendo ? 18 : 0) + freshness(age, 15) + 22 * clamp((d.discount ?? 0) / 80) - (d.channel === 'keyshop' ? 6 : 0),
  };
}

function judgeBundle(d, { appInfo, owned, bar, settings, now }) {
  const f = d.flags || {};
  const ids = d.bundle?.appids || [];
  const infos = ids.filter((id) => !owned?.hasApp(id)).map((id) => appInfo[id]).filter((i) => i && !i.failed && i.game !== false);
  const liked = infos.filter((i) => (i.rating ?? 0) >= 80 && i.reviews >= 2000);
  const recent = liked.filter((i) => (ageOf(i.released, now) ?? 99) <= settings.pcMaxAge + 1).length;
  // Fiches pas encore lues : on se fie au nombre de jeux bien notés.
  const counted = ids.some((id) => appInfo[id]) ? recent : Math.floor((d.bundle?.good ?? 0) / 2);
  const good = !!f.wishlist || counted >= bar.bundle || (d.temperature != null && voted(d, bar.bigVotes));
  return {
    good, why: good ? null : ids.length ? 'bundle' : 'unknown', recent,
    score: 9 * Math.min(counted, 6) + 3 * Math.min(liked.length, 6) + 14 * clamp((d.discount ?? 60) / 100)
      + (d.temperature ? Math.min(24, d.temperature / 30) : 0) - (d.price == null ? 6 : 0),
  };
}

const infoOf = (d, appInfo) => {
  const info = d.steamAppID ? appInfo?.[d.steamAppID] : null;
  return info && !info.failed ? info : null;
};

/**
 * Juge une annonce. `good` : montrée d'abord ; `why` : pourquoi elle ne l'est pas ; `score` : ordre.
 * @param ctx { appInfo, ranks, owned, settings (réglages effectifs), now }
 */
export function judge(d, { appInfo = {}, ranks = {}, owned = null, settings, now = Date.now() }) {
  const rank = ranks[d.steamAppID] ?? null;
  const fn = d.section === 'bundle' ? judgeBundle : d.section === 'switch' ? judgeSwitch : judgePc;
  const res = fn(d, { info: infoOf(d, appInfo), appInfo, rank, owned, settings, now, bar: barFor(settings) });
  const f = d.flags || {};
  res.rank = rank;
  res.score += (f.wishlist ? 40 : 0) + (f.priceError ? 30 : 0) + (f.drop ? 8 : 0);
  return res;
}

/** Applique la sélection : DLC écartés, prix de départ, jugement, meilleurs d'abord. */
export function selectDeals(deals, ctx) {
  const out = [];
  for (const d of deals) {
    const info = infoOf(d, ctx.appInfo);
    if (isAddon(d, info)) continue;
    fillReference(d, info);
    if (info?.header && !d.images?.includes(info.header)) d.images = [info.header, ...(d.images || [])];
    const { good, why, age, rank, recent, score } = judge(d, ctx);
    Object.assign(d, { good, why, score: Math.round(score * 10) / 10 });
    if (age != null) d.age = Math.round(age * 10) / 10;
    if (rank) d.topRank = rank;
    if (recent != null && d.bundle) d.bundle = { ...d.bundle, recent };
    out.push(d);
  }
  return out.sort((a, b) => Number(b.good) - Number(a.good) || b.score - a.score);
}

/** Cartes montrées d'abord dans une section : les meilleures, plus tous les souhaits et erreurs de prix. */
export function firstOnes(list, section, settings) {
  const max = limitsFor(settings)[section] ?? Infinity;
  return list.filter((d) => d.good).filter((d, i) => i < max || d.flags?.wishlist || d.flags?.priceError);
}
