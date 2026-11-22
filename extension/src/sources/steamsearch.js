// Retrouve l'identifiant Steam d'un jeu à partir de son nom (annonces Dealabs, qui ne le donnent pas).
// Sert à reconnaître les jeux possédés, la liste de souhaits et les genres sur ces annonces.
import { ENDPOINTS } from '../config.js';
import { fetchJson, normTitle } from '../util.js';
import { extractGameName, sameGameStrict } from '../prefs.js';

const MAX_PER_RUN = 10;
const MAX_CACHE = 800;
const RETRY_AFTER = 14 * 24 * 3600 * 1000; // jeu introuvable : on réessaie plus tard
const pause = () => new Promise((r) => setTimeout(r, 250));

export function pickSteamApp(data, name) {
  const item = (data?.items || []).find((i) => i?.type === 'app' && sameGameStrict(i.name, name));
  return item ? String(item.id) : null;
}

/** Ajoute `steamAppID` aux bons plans PC qui n'en ont pas. `cache` : { [nom]: { id, at } }, modifié en place. */
export async function resolveSteamIds(deals, cache, now = Date.now()) {
  let left = MAX_PER_RUN;
  for (const d of deals) {
    if (d.section !== 'pc' || d.steamAppID) continue;
    const name = extractGameName(d.title);
    const key = normTitle(name);
    if (key.length < 3) continue;
    let hit = cache[key];
    if (!hit || (!hit.id && now - hit.at > RETRY_AFTER)) {
      if (left <= 0) continue;
      left -= 1;
      try {
        hit = { id: pickSteamApp(await fetchJson(`${ENDPOINTS.steamStoreSearch}?${new URLSearchParams({ term: name, cc: 'fr', l: 'french' })}`), name), at: now };
        cache[key] = hit;
      } catch (e) {
        console.warn('[FreeKeep] recherche Steam :', e);
        return; // Steam limite les requêtes : on reprendra à la prochaine vérification
      }
      await pause();
    }
    if (hit.id) d.steamAppID = hit.id;
  }
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE) keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - MAX_CACHE).forEach((k) => delete cache[k]);
}
