// Nouvelle version sur GitHub ? Lecture du manifest public, une fois par jour. Rien n'est installé ni envoyé.
import { RAW_MANIFEST } from './config.js';
import { fetchJson } from './util.js';

export const CHECK_EVERY = 24 * 3600 * 1000;

/** a > b ? (« 1.10.0 » est plus récent que « 1.9.2 ») */
export function isNewer(a, b) {
  const parts = (v) => String(v || '').split('.').map((n) => Number(n) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

export async function fetchLatestVersion() {
  const { version } = await fetchJson(RAW_MANIFEST, { credentials: 'omit', cache: 'no-store' });
  if (!/^\d+(\.\d+){1,3}$/.test(version || '')) throw new Error('version illisible');
  return version;
}
