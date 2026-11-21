// CheapShark (cheapshark.com) : promos sur 30+ stores PC officiels (Steam, GOG, Humble, Fanatical, GMG…).
// API gratuite, sans clé. Prix en dollars US (prix de référence). Les liens doivent passer par CheapShark.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';

export const CHEAPSHARK_STORES = {
  1: 'Steam', 2: 'GamersGate', 3: 'GreenManGaming', 7: 'GOG', 8: 'EA', 11: 'Humble Store', 13: 'Ubisoft Store',
  15: 'Fanatical', 21: 'WinGameStore', 23: 'GameBillet', 24: 'Voidu', 25: 'Epic Games Store', 27: 'Gamesplanet',
  28: 'Gamesload', 29: '2Game', 30: 'IndieGala', 31: 'Blizzard Shop', 33: 'DLGamer', 34: 'Noctre', 35: 'DreamGame',
};

const dealLink = (dealID) =>
  `${ENDPOINTS.cheapsharkRedirect}?dealID=${/%[0-9a-f]{2}/i.test(dealID) ? dealID : encodeURIComponent(dealID)}`;

export function steamHeaderImages(appid) {
  if (!appid) return [];
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
  ];
}

export async function fetchCheapShark(settings) {
  const base = { onSale: '1', pageSize: '60', sortBy: 'Deal Rating' };
  const aaa = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${new URLSearchParams({ ...base, AAA: '1', steamRating: '70' })}`);
  const gems = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${new URLSearchParams({ ...base, steamRating: String(settings.gemMinRating) })}`);
  if (!Array.isArray(aaa) && !Array.isArray(gems)) throw new Error('réponse CheapShark inattendue');
  const deals = parseCheapShark([...(Array.isArray(aaa) ? aaa : []), ...(Array.isArray(gems) ? gems : [])], settings);

  // Plus bas prix historique (1 requête pour 25 jeux max)
  if (deals.length) {
    try {
      const ids = deals.slice(0, 25).map((d) => d.gameID).join(',');
      applyHistoricLows(deals, await fetchJson(`${ENDPOINTS.cheapsharkGames}?ids=${ids}`));
    } catch (e) {
      console.warn('[FreeKeep] CheapShark historique :', e);
    }
  }
  return deals;
}

// Liste des jeux AAA les mieux notés (en promo ou non) : sert de liste de surveillance pour les sites de clés.
export async function fetchPopularAppIds() {
  const params = new URLSearchParams({ AAA: '1', sortBy: 'Reviews', pageSize: '60', steamRating: '80' });
  const list = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${params}`);
  return [...new Set((Array.isArray(list) ? list : []).map((d) => d.steamAppID).filter(Boolean))];
}

export function parseCheapShark(raw, settings) {
  const byGame = new Map();
  for (const d of raw) {
    if (!d?.dealID || !d.title) continue;
    const price = Number(d.salePrice);
    const normal = Number(d.normalPrice);
    const discount = Math.round(Number(d.savings) || 0);
    const meta = Number(d.metacriticScore) || 0;
    const steam = Number(d.steamRatingPercent) || 0;
    const count = Number(d.steamRatingCount) || 0;

    // « Gros jeu » : vendu 29 $+ et bien noté.
    const aaa = normal >= 29 && discount >= settings.pcMinDiscount && (meta >= 75 || (steam >= 80 && count >= 2000));
    // « Pépite » : petit/moyen jeu adoré par les joueurs.
    const gem = !aaa && normal >= 9.99 && steam >= settings.gemMinRating && count >= 3000 && discount >= settings.gemMinDiscount;
    if (!aaa && !gem) continue;

    const item = {
      id: `cs:${d.gameID}`,
      source: 'cheapshark',
      section: 'pc',
      channel: 'official',
      title: d.title,
      url: dealLink(d.dealID),
      images: [...steamHeaderImages(d.steamAppID), d.thumb].filter(Boolean),
      price,
      normalPrice: normal,
      currency: 'USD',
      discount,
      merchant: CHEAPSHARK_STORES[d.storeID] || 'Store PC',
      rating: { metacritic: meta || null, steam: steam || null, steamCount: count || null, steamText: d.steamRatingText || null },
      steamAppID: d.steamAppID || null,
      gameID: d.gameID,
      posted: d.lastChange ? Number(d.lastChange) * 1000 : null,
      end: null,
      flags: { aaa, gem, historicLow: false },
    };
    const prev = byGame.get(d.gameID);
    if (!prev || item.price < prev.price) byGame.set(d.gameID, item);
  }
  return [...byGame.values()];
}

export function applyHistoricLows(deals, games) {
  if (!games || typeof games !== 'object') return;
  for (const d of deals) {
    const low = Number(games[d.gameID]?.cheapestPriceEver?.price);
    if (Number.isFinite(low) && d.price <= low + 0.005) d.flags.historicLow = true;
  }
}
