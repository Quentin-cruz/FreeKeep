// Catalogue officiel GOG : promos en euros, avec la note des joueurs.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';
import { GOG_PACK } from './storebundles.js';

const ORDERS = ['desc:trending', 'desc:bestselling'];
const PAGES = 2;
const pause = () => new Promise((r) => setTimeout(r, 250));

export async function fetchGog(settings) {
  const products = [];
  let failed = null;
  for (const order of ORDERS) {
    for (let page = 1; page <= PAGES; page++) {
      const params = new URLSearchParams({
        limit: '48', order, discounted: 'eq:true', productType: 'in:game,pack', page: String(page), countryCode: 'FR', locale: 'fr-FR', currencyCode: 'EUR',
      });
      try {
        const data = await fetchJson(`${ENDPOINTS.gogCatalog}?${params}`);
        if (!Array.isArray(data?.products)) throw new Error('réponse GOG inattendue');
        products.push(...data.products);
      } catch (e) {
        failed = e;
      }
      await pause();
    }
  }
  if (!products.length) throw failed || new Error('réponse GOG inattendue');
  return parseGog(products, settings);
}

export function parseGog(products, settings) {
  const min = Math.max(40, settings.pcMinDiscount - 10);
  const byId = new Map();
  for (const p of products) {
    const price = Number(p?.price?.finalMoney?.amount);
    const normal = Number(p?.price?.baseMoney?.amount);
    if (!p?.id || !p.title || !(normal > 0) || Number.isNaN(price) || p.price.finalMoney.currency !== 'EUR') continue;
    if (p.productType === 'pack' && GOG_PACK.test(p.title)) continue; // dans la section Bundles
    const discount = Math.round((1 - price / normal) * 100);
    const rating = (Number(p.reviewsRating) || 0) / 10; // note sur 5
    // Bons jeux seulement : un vrai prix de départ et une note solide
    if (normal < 9.99 || discount < min || rating < 4 || (Number(p.reviewsCount) || 0) < 100) continue;
    byId.set(String(p.id), {
      id: `gog:${p.id}`,
      source: 'gog',
      section: 'pc',
      channel: 'official',
      title: p.title,
      url: p.storeLink || `https://www.gog.com/fr/game/${p.slug}`,
      images: [p.coverHorizontal].filter(Boolean),
      price,
      normalPrice: normal,
      currency: 'EUR',
      discount,
      merchant: 'GOG',
      released: Date.parse(String(p.releaseDate || '').replace(/\./g, '-')) || null,
      rating: { gog: rating, gogCount: Number(p.reviewsCount) || 0 },
      platform: 'gog',
      categories: (p.genres || []).map((g) => g.slug).filter(Boolean),
      posted: null,
      end: null,
      flags: { aaa: normal >= 29, gem: rating >= 4.6 },
    });
  }
  return [...byId.values()];
}
