// Agrégateur GamerPower (gamerpower.com) : tous les giveaways de jeux PC à garder,
// y compris les drops ponctuels (Alienware Arena, Fanatical, Humble, IndieGala, Amazon Prime…).
import { ENDPOINTS, GIVEAWAY_SITES } from '../config.js';
import { fetchJson, cleanGamerPowerTitle, parseUtc } from '../util.js';

export async function fetchGamerPower(stores, now = Date.now(), { prime = false } = {}) {
  if (!stores.length) return [];
  const data = await fetchJson(`${ENDPOINTS.gamerpower}?platform=pc&type=game`);
  return parseGamerPower(data, stores, now, { prime });
}

const textOf = (g) => `${g.title || ''}\n${g.instructions || ''}\n${g.description || ''}`;

// Offert aux abonnés Amazon Prime (ex-Prime Gaming, désormais dans Amazon Luna).
const PRIME_RE = /prime gaming|amazon prime|amazon luna|luna\.amazon|\bluna\b|prime members?|membres? prime/i;
export const isPrimeGiveaway = (g) => PRIME_RE.test(textOf(g));

// Plateforme d'activation d'un avantage Prime : Epic / GOG / Microsoft Store / Legacy Games / Amazon Games.
function primeStore(text, parts = []) {
  if (parts.some((p) => p.includes('epic')) || /epic games/i.test(text)) return 'epic';
  if (parts.some((p) => p.includes('gog')) || /\bgog\b/i.test(text)) return 'gog';
  if (/legacy games/i.test(text)) return 'legacy';
  if (/microsoft store|xbox app|windows store|xbox pc/i.test(text)) return 'microsoft';
  return 'amazon'; // application Amazon Games (par défaut pour Prime)
}

// Plateforme où le jeu s'active ; « other » pour le DRM-free inconnu ; null si ce n'est pas un jeu PC.
export function detectStore(platforms, g = {}) {
  const parts = String(platforms || '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const text = textOf(g);
  if (isPrimeGiveaway(g) && parts.some((p) => /^(pc|drm-free)$|epic|gog/.test(p))) return primeStore(text, parts);
  for (const p of parts) {
    if (p.includes('epic')) return 'epic';
    if (p.includes('steam')) return 'steam';
    if (p.includes('gog')) return 'gog';
    if (p.includes('ubisoft') || p.includes('uplay')) return 'ubisoft';
    if (p.includes('origin') || /\bea\b/.test(p)) return 'ea';
    if (p.includes('itch')) return 'itch';
    if (/battle\.?net/.test(p)) return 'battlenet';
    if (/microsoft|windows store|xbox app/.test(p)) return 'microsoft';
  }
  if (!parts.some((p) => /^(pc|drm-free)$/.test(p))) return null;
  if (/battle\.?net/i.test(text)) return 'battlenet';
  if (/microsoft store|xbox app|windows store/i.test(text)) return 'microsoft';
  // DRM-free distribué par IndieGala (via son client / sa page) -> IndieGala
  if (/indie\s?gala/i.test(text)) return 'indiegala';
  return 'other';
}

// Site qui organise le giveaway (si ce n'est pas le store lui-même).
export function detectSite(g) {
  const text = textOf(g);
  return GIVEAWAY_SITES.find((s) => s.re.test(text))?.name || null;
}

// `prime` : l'utilisateur a Amazon Prime (sinon les avantages Prime sont ignorés).
export function parseGamerPower(data, stores, now = Date.now(), { prime = false } = {}) {
  // Quand il n'y a rien, l'API renvoie { status: 0, status_message: "..." }
  if (!Array.isArray(data)) {
    if (data && data.status === 0) return [];
    throw new Error('réponse GamerPower inattendue');
  }
  const out = [];
  for (const g of data) {
    if (!g?.title) continue;
    if (g.status && g.status !== 'Active') continue;
    if (g.type && !/^game$/i.test(g.type.trim())) continue;
    const store = detectStore(g.platforms, g);
    if (!store || !stores.includes(store)) continue;
    const isPrime = isPrimeGiveaway(g);
    if (isPrime && !prime) continue;
    const end = parseUtc(g.end_date);
    if (end && end <= now) continue;
    out.push({
      source: 'gamerpower',
      store,
      via: detectSite(g),
      title: cleanGamerPowerTitle(g.title),
      url: g.open_giveaway_url || g.open_giveaway || g.gamerpower_url,
      images: [g.image, g.thumbnail].filter(Boolean),
      start: parseUtc(g.published_date),
      end,
      status: 'active',
      worth: g.worth && g.worth !== 'N/A' ? g.worth : null,
      description: String(g.description || '').slice(0, 280),
      prime: isPrime,
      gpId: g.id,
    });
  }
  return out;
}
