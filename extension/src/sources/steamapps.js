// Tags et avertissements des jeux Steam, lus par lots et mis en cache (sert aux genres masqués).
import { fetchSteamItems } from './steamstore.js';

const MAX_CACHE = 3000;
const DAY = 24 * 3600 * 1000;
const RETRY_FAILED_AFTER = 3 * DAY;
const REFRESH_AFTER = 30 * DAY;
export const TAG_COUNT = 12;

// Ancien format (noms de tags) : à relire.
const usable = (e, now) => !!e && e.v === 2 && now - e.at < (e.failed ? RETRY_FAILED_AFTER : REFRESH_AFTER);

/** Complète le cache `appInfo` (modifié en place) pour les appids manquants. */
export async function enrichAppInfo(appids, appInfo, { now = Date.now() } = {}) {
  const todo = [...new Set(appids.filter(Boolean).map(String))].filter((id) => /^\d+$/.test(id) && !usable(appInfo[id], now));
  if (todo.length) {
    const items = await fetchSteamItems(todo, { reviews: false, tags: TAG_COUNT });
    for (const id of todo) {
      const it = items[id];
      appInfo[id] = it ? { v: 2, at: now, tags: it.tags || [], descriptors: it.descriptors || [] } : { v: 2, at: now, failed: true };
    }
  }
  const ids = Object.keys(appInfo);
  if (ids.length > MAX_CACHE) {
    ids.sort((a, b) => (appInfo[a].at || 0) - (appInfo[b].at || 0)).slice(0, ids.length - MAX_CACHE).forEach((id) => delete appInfo[id]);
  }
  return todo.length;
}
