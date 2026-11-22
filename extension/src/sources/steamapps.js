// Genres / tags des jeux Steam, mis en cache (sert aux exclusions de genres).
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_PER_RUN = 20;
const MAX_CACHE = 3000;
const RETRY_FAILED_AFTER = 3 * 24 * 3600 * 1000;

export function parseAppDetails(appid, data) {
  const d = data?.[appid];
  if (!d?.success || !d.data) return { failed: true };
  return {
    type: d.data.type || null,
    genres: (d.data.genres || []).map((g) => g.description),
    descriptors: (d.data.content_descriptors?.ids || []).map(Number),
  };
}

export function parseSteamSpy(data) {
  const tags = data?.tags;
  if (!tags || Array.isArray(tags)) return [];
  // Les tags les plus votés seulement (évite les tags anecdotiques)
  return Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
}

/** Complète le cache `appInfo` (modifié en place) pour les appids manquants. */
export async function enrichAppInfo(appids, appInfo, { withTags = false, adult = false, now = Date.now() } = {}) {
  // Filtre adulte : les tags joueurs ne servent qu'aux jeux signalés « nudité ou sexe » (avertissement 1).
  const wantsTags = (e) => withTags || (adult && !!e.descriptors?.includes(1));
  const todo = [...new Set(appids.filter(Boolean).map(String))].filter((id) => {
    const c = appInfo[id];
    if (!c) return true;
    if (c.failed && now - c.at > RETRY_FAILED_AFTER) return true;
    return !c.failed && !c.tagsAt && wantsTags(c);
  }).slice(0, MAX_PER_RUN);

  for (const id of todo) {
    const entry = appInfo[id] && !appInfo[id].failed ? appInfo[id] : {};
    if (!entry.at) {
      try {
        Object.assign(entry, parseAppDetails(id, await fetchJson(`${ENDPOINTS.steamAppDetails}?appids=${id}&l=english`)));
      } catch {
        entry.failed = true;
      }
      entry.at = now;
      await sleep(250);
    }
    if (!entry.failed && !entry.tagsAt && wantsTags(entry)) {
      try {
        entry.tags = parseSteamSpy(await fetchJson(`${ENDPOINTS.steamSpy}?request=appdetails&appid=${id}`));
      } catch {
        entry.tags = entry.tags || [];
      }
      entry.tagsAt = now;
      await sleep(1100); // SteamSpy : 1 requête/seconde
    }
    appInfo[id] = entry;
  }

  const ids = Object.keys(appInfo);
  if (ids.length > MAX_CACHE) {
    ids.sort((a, b) => (appInfo[a].at || 0) - (appInfo[b].at || 0)).slice(0, ids.length - MAX_CACHE).forEach((id) => delete appInfo[id]);
  }
  return todo.length;
}
