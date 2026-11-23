// Fiches officielles Steam (API publique, sans clé) : nom, prix en euros, fin de promo, avis.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';
import { steamHeaderImages } from './cheapshark.js';

const BATCH = 50;
const pause = () => new Promise((r) => setTimeout(r, 200));

export function parseSteamItems(data) {
  const list = data?.response?.store_items;
  if (!Array.isArray(list)) throw new Error('réponse Steam inattendue');
  const out = {};
  for (const it of list) {
    const appid = it?.appid ?? it?.id;
    if (!appid || it.success !== 1 || !it.name) continue;
    const p = it.best_purchase_option;
    const price = p?.final_price_in_cents != null ? Number(p.final_price_in_cents) / 100 : null;
    out[String(appid)] = {
      name: it.name,
      game: it.type === 0,
      price,
      normal: p?.original_price_in_cents != null ? Number(p.original_price_in_cents) / 100 : price,
      discount: Number(p?.discount_pct) || 0,
      end: Number(p?.active_discounts?.[0]?.discount_end_date) * 1000 || null,
      rating: it.reviews?.summary_filtered?.percent_positive ?? null,
      reviews: it.reviews?.summary_filtered?.review_count ?? 0,
      released: Number(it.release?.original_release_date || it.release?.steam_release_date) * 1000 || null,
      ...(it.assets?.header && it.assets.asset_url_format ? { header: `https://shared.akamai.steamstatic.com/store_item_assets/${it.assets.asset_url_format.replace('${FILENAME}', it.assets.header)}` } : {}),
      ...(it.tags ? { tags: it.tags.map((t) => t.tagid) } : {}),
      descriptors: (it.content_descriptorids || []).map(Number),
    };
  }
  return out;
}

/** { [appid]: fiche } — les appid introuvables sont simplement absents. */
export async function fetchSteamItems(appids, { reviews = true, tags = 0, release = false, assets = false } = {}) {
  const ids = [...new Set((appids || []).filter(Boolean).map(String))].filter((id) => /^\d+$/.test(id));
  const out = {};
  for (let i = 0; i < ids.length; i += BATCH) {
    if (i) await pause();
    const input = {
      ids: ids.slice(i, i + BATCH).map((id) => ({ appid: Number(id) })),
      context: { language: 'english', country_code: 'FR' },
      data_request: { include_reviews: reviews, ...(tags ? { include_tag_count: tags } : {}), ...(release ? { include_release: true } : {}), ...(assets ? { include_assets: true } : {}) },
    };
    Object.assign(out, parseSteamItems(await fetchJson(`${ENDPOINTS.steamItems}?input_json=${encodeURIComponent(JSON.stringify(input))}`)));
  }
  return out;
}

// Jeux de la liste de souhaits en promo sur Steam (dès -20 %).
export function wishlistDeals(wishlist, items) {
  const out = [];
  for (const id of wishlist) {
    const it = items[String(id)];
    if (!it || it.price == null || it.discount < 20) continue;
    out.push({
      id: `st:${id}`,
      source: 'steam',
      section: 'pc',
      channel: 'official',
      title: it.name,
      url: `https://store.steampowered.com/app/${id}/`,
      images: steamHeaderImages(id),
      price: it.price,
      normalPrice: it.normal,
      currency: 'EUR',
      discount: it.discount,
      merchant: 'Steam',
      rating: { steam: it.rating, steamCount: it.reviews, metacritic: null, steamText: null },
      steamAppID: String(id),
      platform: 'steam',
      posted: null,
      end: it.end,
      flags: { wishlist: true },
    });
  }
  return out;
}
