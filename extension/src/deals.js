// Assemble les bons plans (PC + Switch) : dédoublonnage, chutes de prix, score, affaires exceptionnelles.
import { titlesMatch, titleContains } from './util.js';

const DAY = 24 * 3600 * 1000;
const sameGame = (a, b) => titlesMatch(a.title, b.title) || titleContains(a.title, b.title) || titleContains(b.title, a.title);

export function isExceptional(d) {
  const f = d.flags || {};
  const disc = d.discount ?? 0;
  return !!(
    f.priceError ||
    f.drop ||
    (f.historicLow && disc >= 75) ||
    (f.hot && (f.free || disc >= 60)) ||
    (d.section === 'switch' && f.nintendo && disc >= 40) ||
    (d.section === 'switch' && d.channel === 'eshop' && disc >= 60 && (d.normalPrice ?? 0) >= 39.99)
  );
}

export function scoreDeal(d) {
  const f = d.flags || {};
  let s = d.discount ?? 50;
  if (f.priceError) s += 80;
  if (f.drop) s += 35;
  if (f.historicLow) s += 15;
  if (f.hot) s += 20;
  if (f.aaa) s += 10;
  if (f.nintendo) s += 25;
  if (f.popular) s += 10;
  if ((d.rating?.metacritic ?? 0) >= 85) s += 10;
  if ((d.rating?.steam ?? 0) >= 95) s += 8;
  return s;
}

/**
 * @param lists   { cheapshark, ggdeals, eshop, dealabs } — items déjà filtrés par chaque source
 * @param history { [id]: { price, at } } — dernier prix vu (modifié en place)
 * @param gg      { [appid]: prix GG.deals } — pour afficher le prix « clé » à côté d'une promo officielle
 */
export function buildDeals(lists, history = {}, gg = {}, now = Date.now()) {
  const official = [...(lists.cheapshark || []), ...(lists.eshop || [])];
  const extra = [];

  // Dealabs : si le deal existe déjà via une source officielle, on fusionne (badge « hot » / erreur de prix).
  for (const d of lists.dealabs || []) {
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

  const all = [...official, ...keyDeals, ...extra];

  // Chute soudaine : prix au moins 30 % plus bas qu'à la vérification précédente (moins de 10 jours).
  for (const d of all) {
    if (d.price == null) continue;
    const prev = history[d.id];
    if (prev && prev.price > 0 && d.price <= prev.price * 0.7 && now - prev.at < 10 * DAY) {
      d.flags.drop = true;
      d.prevPrice = prev.price;
    } else if (prev?.dropUntil && prev.dropUntil > now && d.price <= prev.price) {
      d.flags.drop = true; // on garde le badge 24 h
      d.prevPrice = prev.prevPrice;
    }
    const keepDrop = d.flags.drop ? { dropUntil: prev?.dropUntil && prev.dropUntil > now ? prev.dropUntil : now + DAY, prevPrice: d.prevPrice } : {};
    history[d.id] = { price: d.price, at: now, ...keepDrop };
  }
  for (const [id, h] of Object.entries(history)) if (now - h.at > 30 * DAY) delete history[id];

  return all
    .filter((d) => d.source !== 'ggdeals' || d.candidate || d.flags.drop)
    .map((d) => ({ ...d, exceptional: isExceptional(d), score: scoreDeal(d) }))
    .sort((a, b) => b.score - a.score);
}
