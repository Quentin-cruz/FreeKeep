// Personnalisation : ce que l'utilisateur veut voir, et ce qu'il ne veut pas voir.
import { LEVELS, STORE_ORDER, PRIME_STORES } from './config.js';
import { genresOf } from './genres.js';
import { bannedKeyword } from './keywords.js';
import { extractGameName, gameKey } from './titles.js';

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
  if (pc && settings.bundles !== false) sections.push('bundle');
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
    bundles: pc && settings.bundles !== false,
    sections,
  };
}

export { bannedKeyword };

// ---------- Jeux possédés ----------

export { extractGameName, sameGameStrict } from './titles.js';

// Index des jeux possédés : Steam (appids + noms) et, en option, GOG (noms).
export function makeOwnedIndex(lib, gog = null) {
  const appids = new Set((lib?.appids || []).map(String));
  const index = (names) => {
    const keys = new Set((names || []).map(gameKey).filter(Boolean));
    return (title) => keys.has(gameKey(title)) || keys.has(gameKey(extractGameName(title)));
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

// ---------- Liste de souhaits Steam ----------

/**
 * Jeu de la liste de souhaits Steam : seule l'offre à activer sur Steam est gardée.
 * Sans offre Steam, le bon plan est masqué (hiddenBy = 'wishlist').
 */
export function steamOnly(d) {
  if (d.section !== 'pc' || d.channel === 'bundle') return d;
  const steam = d.offers?.steam;
  if (d.platform === 'steam' || !d.platform) return d.offers ? { ...d, offers: steam ? { steam } : {} } : d;
  if (!steam) return { ...d, offers: {}, hiddenBy: 'wishlist' };
  return { ...d, ...steam, platform: 'steam', offers: { steam } };
}
