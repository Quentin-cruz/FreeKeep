// Bibliothèque GOG lue via la session gog.com déjà ouverte dans le navigateur.
// Aucun identifiant n'est demandé ni stocké : si tu n'es pas connecté à gog.com, ça s'arrête là.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';

const MAX_PAGES = 30; // 100 jeux par page → 3 000 jeux max

export function parseGogUser(data) {
  if (!data || typeof data !== 'object') throw new Error('réponse GOG inattendue');
  if (!data.isLoggedIn) throw new Error('pas connecté à gog.com dans ce navigateur');
  return { username: data.username || '' };
}

export function parseGogProducts(data) {
  if (!data || !Array.isArray(data.products)) throw new Error('réponse GOG inattendue');
  return {
    totalPages: Number(data.totalPages) || 1,
    games: data.products
      .filter((p) => p && p.title && p.id)
      .map((p) => ({ id: Number(p.id), title: String(p.title).trim() })),
  };
}

export async function fetchGogLibrary() {
  const opts = { credentials: 'include', timeout: 15000 };
  const { username } = parseGogUser(await fetchJson(ENDPOINTS.gogUser, opts));
  const games = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const res = parseGogProducts(await fetchJson(`${ENDPOINTS.gogOwned}?mediaType=1&sortBy=title&page=${page}`, opts));
    totalPages = res.totalPages;
    games.push(...res.games);
  }
  if (!games.length) throw new Error('aucun jeu trouvé sur ton compte GOG');
  return { username, games };
}
