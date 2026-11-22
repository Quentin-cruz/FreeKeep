// Recommandations du tutoriel : goûts d'après la bibliothèque Steam, et effet réel des filtres sur les annonces du moment.
import { LEVELS, KEYWORD_SUGGESTIONS } from './config.js';
import { GENRES, genresOf } from './genres.js';
import { bannedKeyword } from './keywords.js';

// Tags Steam (identifiants officiels) par genre de FreeKeep.
const TAGS = {
  horror: [1667, 3978, 1721], sport: [701], racing: [699], simulation: [599], strategy: [9], rpg: [122], shooter: [1663, 1774], fighting: [1743],
  puzzle: [1664], platformer: [1625, 5379], casual: [597], visualnovel: [3799], mmo: [128, 1754, 113], earlyaccess: [493], kids: [5350, 1036],
};
const MIN_GAMES = 15; // en dessous, la bibliothèque ne dit rien de fiable
const RARE = 0.03; // genre présent dans moins de 3 % des jeux

/** @param items fiches Steam des jeux possédés : [{ name, tags: [id] }] */
export function tasteFrom(items) {
  const games = items.filter((i) => i?.name && i.tags?.length);
  const genres = {};
  for (const [id, tags] of Object.entries(TAGS)) genres[id] = games.filter((g) => g.tags.some((t) => tags.includes(t))).length;
  const franchises = {};
  for (const kw of KEYWORD_SUGGESTIONS) franchises[kw] = games.filter((g) => bannedKeyword(g.name, [kw])).length;
  return { total: games.length, genres, franchises };
}

/** Genres à proposer de masquer : absents de la bibliothèque, et présents dans les annonces. */
export function genresToHide(taste, hits = {}, already = []) {
  if (!taste || taste.total < MIN_GAMES) return [];
  return Object.keys(TAGS)
    .filter((id) => !already.includes(id) && taste.genres[id] / taste.total < RARE)
    .sort((a, b) => (hits[b] || 0) - (hits[a] || 0))
    .slice(0, 5);
}

/** Licences triées : celles qui masqueraient le plus d'annonces d'abord, celles que l'utilisateur possède à la fin. */
export function rankFranchises(taste, hits = {}) {
  const owned = (kw) => taste?.franchises?.[kw] || 0;
  return [...KEYWORD_SUGGESTIONS]
    .map((kw, i) => ({ keyword: kw, owned: owned(kw), hits: hits[kw] || 0, i, star: !!taste && taste.total >= MIN_GAMES && owned(kw) === 0 && (hits[kw] || 0) > 0 }))
    .sort((a, b) => Number(a.owned > 0) - Number(b.owned > 0) || b.hits - a.hits || a.i - b.i);
}

/** Combien d'annonces chaque licence et chaque genre masquerait. */
export function filterHits(deals, games, appInfo = {}) {
  const all = [...deals, ...games.map((g) => ({ title: g.title, steamAppID: g.appid }))];
  const keywords = {};
  for (const kw of KEYWORD_SUGGESTIONS) keywords[kw] = all.filter((d) => bannedKeyword(d.title, [kw])).length;
  const genres = Object.fromEntries(GENRES.map((g) => [g.id, 0]));
  for (const d of all) for (const id of genresOf(d, appInfo)) genres[id] += 1;
  return { keywords, genres };
}

export const COMFORT = 250; // au-delà, la liste devient longue à parcourir

/** Niveau conseillé : le plus large qui reste lisible. */
export function recommendedLevel(counts) {
  const known = Object.keys(LEVELS).filter((l) => counts[l] != null);
  if (!known.length) return 'balanced';
  const fits = ['wide', 'balanced', 'strict'].find((l) => counts[l] != null && counts[l] <= COMFORT);
  return fits === 'wide' ? 'balanced' : fits || 'strict';
}
