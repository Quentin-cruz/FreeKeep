// LootScraper (flux publics) : jeux offerts par Amazon Prime, GOG, Ubisoft, Humble et itch.io.
// + cadeaux GOG (catalogue officiel, jeux passés à 0 €).
import { ENDPOINTS } from '../config.js';
import { fetchText, fetchJson, decodeEntities, parseUtc, stripHtml } from '../util.js';

const FEEDS = ['amazon', 'gog', 'ubisoft', 'humble', 'itch'];
const STORE = { GOG: 'gog', UBISOFT: 'ubisoft', ITCH: 'itch', STEAM: 'steam', EPIC: 'epic', HUMBLE: 'steam' };
const SOURCE_NAME = { HUMBLE: 'Humble Bundle', ITCH: 'itch.io' };

// Où s'active un jeu Prime, d'après l'adresse de réclamation (« …/claims/warbreeds-gog/… »).
export function primeStoreFromUrl(url) {
  const slug = /\/claims\/([^/?#]+)/.exec(String(url || ''))?.[1] || '';
  if (/-gog\b/.test(slug)) return 'gog';
  if (/-(?:epic|egs)\b/.test(slug)) return 'epic';
  if (/-(?:legacy|lg)\b/.test(slug)) return 'legacy';
  if (/-(?:ms|microsoft|xbox|msstore)\b/.test(slug)) return 'microsoft';
  return 'amazon';
}

export function parseLootScraper(xml, now = Date.now()) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const term = (name) => new RegExp(`<category[^>]*term="${name}:([^"]+)"`).exec(e)?.[1] || '';
    if (term('type') !== 'GAME' || !/^(PC|ALL)?$/.test(term('platform'))) continue;
    const source = term('source');
    const prime = source === 'AMAZON';
    const url = decodeEntities(/<link[^>]*href="([^"]+)"/.exec(e)?.[1] || '');
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/.exec(e)?.[1] || '').replace(/^[^(]*\([^)]*\)\s+-\s+/, '').trim();
    const store = prime ? primeStoreFromUrl(url) : STORE[source];
    if (!store || !title || !url) continue;
    const field = (label) => stripHtml(new RegExp(`<b>${label}:</b>([\\s\\S]*?)</li>`).exec(e)?.[1] || '');
    const end = parseUtc(field('Offer valid to'));
    if (end && end <= now) continue;
    const price = /(\d+(?:\.\d+)?)\s*EUR/.exec(field('Recommended price \\(Steam\\)'))?.[1];
    const img = decodeEntities(/<img[^>]*src="([^"]+)"/.exec(e)?.[1] || '');
    out.push({
      source: 'lootscraper',
      store,
      via: prime ? 'Amazon Prime' : SOURCE_NAME[source] || null,
      title,
      url,
      images: img ? [img] : [],
      start: parseUtc(field('Offer valid from')) || Date.parse(/<published>([^<]+)/.exec(e)?.[1] || '') || null,
      end,
      status: 'active',
      worth: price ? `${price.replace('.', ',')} €` : null,
      description: field('Description').slice(0, 280),
      prime,
    });
  }
  return out;
}

// Jeux GOG payants passés à 0 € (cadeau temporaire).
export function parseGogGifts(data) {
  return (data?.products || [])
    .filter((p) => p?.title && Number(p.price?.baseMoney?.amount) > 0 && Number(p.price?.finalMoney?.amount) === 0)
    .map((p) => ({
      source: 'gogstore', store: 'gog', title: p.title, url: p.storeLink, images: [p.coverHorizontal].filter(Boolean),
      start: null, end: null, status: 'active', worth: `${Number(p.price.baseMoney.amount).toFixed(2).replace('.', ',')} €`, description: '',
    }));
}

export async function fetchLootScraper(now = Date.now()) {
  const results = await Promise.allSettled([
    ...FEEDS.map(async (f) => parseLootScraper(await fetchText(`${ENDPOINTS.lootscraper}/lootscraper_${f}_game.xml`), now)),
    (async () => parseGogGifts(await fetchJson(`${ENDPOINTS.gogCatalog}?${new URLSearchParams({ limit: '20', price: 'between:0,0', discounted: 'eq:true', productType: 'in:game,pack', page: '1', countryCode: 'FR', locale: 'fr-FR', currencyCode: 'EUR' })}`)))(),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw new Error(String(results[0]?.reason?.message || 'LootScraper inaccessible'));
  return ok.flatMap((r) => r.value);
}
