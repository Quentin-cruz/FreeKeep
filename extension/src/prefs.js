// Personnalisation : ce que l'utilisateur veut voir, et ce qu'il ne veut pas voir.
import { LEVELS, STORE_ORDER, PRIME_STORES } from './config.js';
import { genresOf } from './genres.js';
import { normTitle } from './util.js';

// Seuils effectifs selon le niveau d'exigence choisi.
export function effective(settings) {
  const preset = LEVELS[settings.level];
  return preset
    ? { ...settings, pcMinDiscount: preset.pcMinDiscount, gemMinDiscount: preset.gemMinDiscount, gemMinRating: preset.gemMinRating, switchMinDiscount: preset.switchMinDiscount }
    : settings;
}

// Ce qui est réellement actif (les menus du popup s'adaptent à ça).
// Jeu gratuit visible avec ces choix (plateforme cochée ; Prime seulement si abonné).
export const showsGame = (g, w) => w.stores.includes(g.store) && (!g.prime || w.prime);

export function wants(settings) {
  // Les plateformes Prime ne comptent que si l'utilisateur a Amazon Prime.
  const stores = STORE_ORDER.filter((s) => settings.stores?.[s] && (!PRIME_STORES.includes(s) || settings.prime));
  const pc = !!settings.pc && stores.length > 0;
  const free = pc && settings.freeGames !== false;
  const sections = [];
  if (free) sections.push('free');
  if (pc && settings.pcDeals) sections.push('pc');
  if (settings.switch && settings.switchDeals) sections.push('switch');
  return {
    stores,
    prime: !!settings.prime,
    free,
    pcDeals: pc && !!settings.pcDeals,
    switchDeals: !!settings.switch && !!settings.switchDeals,
    switch2: !!settings.switch && !!settings.switch2,
    upcoming: free && !!settings.stores?.epic && settings.showUpcoming !== false,
    keyshops: settings.keyshops !== false,
    physical: settings.physical !== false,
    bundles: settings.bundles !== false,
    sections,
  };
}

// ---------- Mots-clés bannis ----------

export function bannedKeyword(title, keywords = []) {
  const t = ` ${normTitle(title)} `;
  for (const kw of keywords) {
    const k = normTitle(kw);
    if (k && t.includes(` ${k} `)) return kw;
  }
  return null;
}

// ---------- Jeux possédés ----------

// « DOOM Eternal sur PC (Dématérialisé - Steam) » -> « DOOM Eternal »
export function extractGameName(title) {
  return String(title || '')
    .split(/\s+(?:sur|pour|on)\s+(?:pc|steam|nintendo|switch|ps\d|xbox)\b/i)[0]
    .replace(/\s*[([].*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .trim();
}

const EDITION_WORDS = new Set(['definitive', 'edition', 'goty', 'game', 'of', 'the', 'year', 'complete', 'deluxe', 'ultimate', 'gold', 'standard', 'enhanced', 'directors', 'director', 's', 'cut', 'collection']);

// Même jeu au sens strict : titres identiques, ou ne différant que par des mots d'édition.
// (« Hollow Knight » ≠ « Hollow Knight Silksong », « DOOM » ≠ « DOOM Eternal »)
export function sameGameStrict(a, b) {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (!long.startsWith(`${short} `)) return false;
  return long.slice(short.length + 1).split(' ').every((w) => EDITION_WORDS.has(w));
}

// Index des jeux possédés : Steam (appids + noms) et, en option, GOG (noms).
export function makeOwnedIndex(lib, gog = null) {
  const appids = new Set((lib?.appids || []).map(String));
  const index = (names) => {
    const byFirst = new Map();
    for (const name of names || []) {
      const first = normTitle(name).split(' ')[0];
      if (!first) continue;
      if (!byFirst.has(first)) byFirst.set(first, []);
      byFirst.get(first).push(name);
    }
    return (title) => {
      const name = extractGameName(title);
      const first = normTitle(name).split(' ')[0];
      return (byFirst.get(first) || []).some((n) => sameGameStrict(n, name));
    };
  };
  const steamName = index(lib?.names);
  const gogName = index(gog?.names);
  return {
    size: appids.size + (gog?.names?.length || 0),
    hasApp: (id) => !!id && appids.has(String(id)),
    hasName: steamName,
    hasGogName: gogName,
  };
}

// ---------- Exclusions ----------

/**
 * Raison pour laquelle un élément est masqué, ou null.
 * @returns 'owned' | 'genre:<id>' | 'keyword:<mot>' | null
 */
export function hiddenReason(item, settings, { appInfo = {}, owned = null, isGame = false } = {}) {
  const kw = bannedKeyword(item.title, settings.bannedKeywords);
  if (kw) return `keyword:${kw}`;
  // Liste de souhaits : on respecte le choix de l'utilisateur, pas de filtre de genre.
  if (!item.flags?.wishlist) {
    const excluded = settings.excludedGenres || [];
    if (excluded.length) {
      const genres = genresOf(item, appInfo);
      const hit = excluded.find((g) => genres.has(g));
      if (hit) return `genre:${hit}`;
    }
  }
  if (!isGame && owned && settings.hideOwned && item.section === 'pc') {
    if (owned.hasApp(item.steamAppID) || (!item.steamAppID && owned.hasName(item.title)) || owned.hasGogName?.(item.title)) return 'owned';
  }
  return null;
}
