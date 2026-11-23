// Fiches des jeux Steam, lues par lots et mises en cache : tags et avertissements (genres masqués), note, âge, prix normal (sélection).
import { fetchSteamItems } from './steamstore.js';

const MAX_CACHE = 3000;
const DAY = 24 * 3600 * 1000;
const RETRY_FAILED_AFTER = 3 * DAY;
const REFRESH_AFTER = 30 * DAY;
export const TAG_COUNT = 12;

// Ancien format (sans note ni date de sortie) : à relire.
const usable = (e, now) => !!e && e.v === 3 && now - e.at < (e.failed ? RETRY_FAILED_AFTER : REFRESH_AFTER);

/** Complète le cache `appInfo` (modifié en place) pour les appids manquants. */
export async function enrichAppInfo(appids, appInfo, { now = Date.now() } = {}) {
  const todo = [...new Set(appids.filter(Boolean).map(String))].filter((id) => /^\d+$/.test(id) && !usable(appInfo[id], now));
  if (todo.length) {
    const items = await fetchSteamItems(todo, { tags: TAG_COUNT, release: true, assets: true });
    for (const id of todo) {
      const it = items[id];
      appInfo[id] = it ? { v: 3, at: now, tags: it.tags || [], descriptors: it.descriptors || [], game: it.game, rating: it.rating, reviews: it.reviews, released: it.released, normal: it.normal, header: it.header || null } : { v: 3, at: now, failed: true };
    }
  }
  const ids = Object.keys(appInfo);
  if (ids.length > MAX_CACHE) {
    ids.sort((a, b) => (appInfo[a].at || 0) - (appInfo[b].at || 0)).slice(0, ids.length - MAX_CACHE).forEach((id) => delete appInfo[id]);
  }
  return todo.length;
}
