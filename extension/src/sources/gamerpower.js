// Agrégateur GamerPower (gamerpower.com) : tous les giveaways de jeux PC à garder,
// y compris les drops ponctuels (Alienware Arena, Fanatical, Humble, IndieGala, Prime Gaming…).
import { ENDPOINTS, GIVEAWAY_SITES } from '../config.js';
import { fetchJson, cleanGamerPowerTitle, parseUtc } from '../util.js';

export async function fetchGamerPower(stores, now = Date.now()) {
  if (!stores.length) return [];
  const data = await fetchJson(`${ENDPOINTS.gamerpower}?platform=pc&type=game`);
  return parseGamerPower(data, stores, now);
}

// Plateforme où le jeu atterrit (Steam, Epic…). « other » = PC sans store connu (itch.io, DRM-free…).
export function detectStore(platforms) {
  const parts = String(platforms || '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  for (const p of parts) {
    if (p.includes('epic')) return 'epic';
    if (p.includes('steam')) return 'steam';
    if (p.includes('gog')) return 'gog';
    if (p.includes('ubisoft') || p.includes('uplay')) return 'ubisoft';
  }
  if (parts.some((p) => /^(pc|drm-free|itch\.io|itchio|battle\.?net|origin|ea app)$/.test(p))) return 'other';
  return null;
}

// Site qui organise le giveaway (si ce n'est pas le store lui-même).
export function detectSite(g) {
  const text = `${g.title || ''}\n${g.instructions || ''}\n${g.description || ''}`;
  return GIVEAWAY_SITES.find((s) => s.re.test(text))?.name || null;
}

export function parseGamerPower(data, stores, now = Date.now()) {
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
    const store = detectStore(g.platforms);
    if (!store || !stores.includes(store)) continue;
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
      gpId: g.id,
    });
  }
  return out;
}
