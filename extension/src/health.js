// Santé des sources : pannes espacées, résultats suspects refusés, vieux prix écartés.
// `cache.health` = { [source]: { n: échecs de suite, at, error } }

const MIN = 60 * 1000;
export const MAX_AGE = 24 * 60 * MIN; // au-delà, un prix n'est plus fiable : il n'est plus montré

// 10 min, 20, 40, 80… puis toutes les 6 h : insister sur un site en panne ne sert qu'à se faire bannir.
export const retryDelay = (n) => Math.min(6 * 60, 10 * 2 ** (n - 1)) * MIN;

/** Dernière erreur si la source est en pause après un échec, sinon null. */
export function pausedError(cache, name, now) {
  const h = cache.health?.[name];
  return h && now - h.at < retryDelay(h.n) ? h.error : null;
}

export function noteFailure(cache, name, error, now) {
  // Hors connexion, ce n'est pas la faute du site : on réessaie dès la prochaine vérification.
  if (globalThis.navigator?.onLine === false) return;
  cache.health = { ...cache.health, [name]: { n: (cache.health?.[name]?.n || 0) + 1, at: now, error } };
}

export function noteSuccess(cache, name) {
  if (cache.health) delete cache.health[name];
}

const size = (entry) => entry?.items?.length ?? entry?.raw?.length ?? (entry?.prices ? Object.keys(entry.prices).length : null);

/**
 * Une source fournie qui tombe d'un coup à zéro a sans doute changé de page : mieux vaut garder l'ancien résultat
 * et le signaler. Si ça dure plus d'une journée, le zéro est accepté.
 */
export function checkDrop(before, after, now, min = 5) {
  if (size(before) >= min && size(after) === 0 && now - before.at < MAX_AGE) throw new Error('plus aucun résultat, le site a peut-être changé');
}

export const isStale = (entry, now) => !!entry && now - entry.at > MAX_AGE;
