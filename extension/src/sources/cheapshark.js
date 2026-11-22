// CheapShark (cheapshark.com) : promos sur 30+ stores PC officiels (Steam, GOG, Humble, Fanatical, GMG…).
// API gratuite, sans clé. Prix en dollars US (prix de référence). Les liens doivent passer par CheapShark.
import { ENDPOINTS } from '../config.js';
import { fetchJson } from '../util.js';
import { cheapSharkTier } from '../levels.js';

export const CHEAPSHARK_STORES = {
  1: 'Steam', 2: 'GamersGate', 3: 'GreenManGaming', 7: 'GOG', 8: 'EA', 11: 'Humble Store', 13: 'Ubisoft Store',
  15: 'Fanatical', 21: 'WinGameStore', 23: 'GameBillet', 24: 'Voidu', 25: 'Epic Games Store', 27: 'Gamesplanet',
  28: 'Gamesload', 29: '2Game', 30: 'IndieGala', 31: 'Blizzard Shop', 33: 'DLGamer', 34: 'Noctre', 35: 'DreamGame',
};

// Plateforme où le jeu s'active selon le store vendeur (clés Steam par défaut chez Humble, Fanatical, GMG…).
// 31 = Blizzard Shop (Battle.net)
const STORE_PLATFORM = { 7: 'gog', 25: 'epic', 13: 'ubisoft', 8: 'ea', 31: 'battlenet' };
export const platformOf = (d) => STORE_PLATFORM[d.storeID] || (d.steamAppID ? 'steam' : d.storeID === '30' || d.storeID === 30 ? 'indiegala' : 'other');

// Stores à interroger un par un : le classement général est presque entièrement composé de clés Steam.
// (GOG et EA ont leur propre source, en euros.)
const LAUNCHER_STORES = { epic: 25, ubisoft: 13 };
const LAUNCHER_PAGES = 2;
const pause = () => new Promise((r) => setTimeout(r, 250)); // ménage l'API

const dealLink = (dealID) =>
  `${ENDPOINTS.cheapsharkRedirect}?dealID=${/%[0-9a-f]{2}/i.test(dealID) ? dealID : encodeURIComponent(dealID)}`;

export function steamHeaderImages(appid) {
  if (!appid) return [];
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
  ];
}

export async function fetchCheapShark(settings, wishlist = []) {
  const base = { onSale: '1', pageSize: '60', sortBy: 'Deal Rating' };
  const aaa = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${new URLSearchParams({ ...base, AAA: '1', steamRating: '70' })}`);
  const gems = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${new URLSearchParams({ ...base, steamRating: String(settings.gemMinRating) })}`);
  if (!Array.isArray(aaa) && !Array.isArray(gems)) throw new Error('réponse CheapShark inattendue');
  const perStore = [];
  for (const [platform, storeID] of Object.entries(LAUNCHER_STORES)) {
    if (!settings.stores?.[platform]) continue;
    try {
      for (let pageNumber = 0; pageNumber < LAUNCHER_PAGES; pageNumber++) {
        await pause();
        const res = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${new URLSearchParams({ ...base, storeID: String(storeID), pageNumber: String(pageNumber) })}`);
        if (Array.isArray(res)) perStore.push(...res);
      }
    } catch (e) {
      console.warn(`[FreeKeep] CheapShark ${platform} :`, e);
    }
  }
  // Jeux de la liste de souhaits Steam en promo (quelle que soit leur note)
  let wished = [];
  if (wishlist.length) {
    try {
      const ids = wishlist.slice(0, 50).join(',');
      const res = await fetchJson(`${ENDPOINTS.cheapsharkDeals}?${new URLSearchParams({ onSale: '1', pageSize: '60', steamAppID: ids })}`);
      if (Array.isArray(res)) wished = res;
    } catch (e) {
      console.warn('[FreeKeep] CheapShark liste de souhaits :', e);
    }
  }
  const deals = parseCheapShark(
    [...(Array.isArray(aaa) ? aaa : []), ...(Array.isArray(gems) ? gems : []), ...perStore],
    settings,
    { wished, wishlist },
  );

  // Plus bas prix historique (25 jeux max par requête)
  for (let i = 0; i < Math.min(deals.length, 75); i += 25) {
    try {
      if (i) await pause();
      const ids = deals.slice(i, i + 25).map((d) => d.gameID).join(',');
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

export function parseCheapShark(raw, settings, { wished = [], wishlist = [] } = {}) {
  const byGame = new Map();
  const wishSet = new Set(wishlist.map(String));
  const allowed = (d) => !settings.stores || !!settings.stores[platformOf(d)];
  for (const d of [...raw, ...wished]) {
    if (!d?.dealID || !d.title || !allowed(d)) continue;
    const price = Number(d.salePrice);
    const normal = Number(d.normalPrice);
    if (!(price > 0)) continue; // jeu offert : il est dans « Gratuits »
    const discount = Math.round(Number(d.savings) || 0);
    const meta = Number(d.metacriticScore) || 0;
    const steam = Number(d.steamRatingPercent) || 0;
    const count = Number(d.steamRatingCount) || 0;

    // « Gros jeu » vendu 29 $+ et bien noté, « pépite » adorée des joueurs, ou bon jeu d'un launcher moins fourni.
    const crit = { normal, meta, steam, count };
    const tier = cheapSharkTier(crit, discount, platformOf(d), settings);
    // Liste de souhaits : toute vraie promo (-20 % et plus)
    const wish = !!d.steamAppID && wishSet.has(String(d.steamAppID)) && discount >= 20;
    if (!tier && !wish) continue;
    const { aaa, gem } = tier || { aaa: false, gem: false };

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
      platform: platformOf(d),
      gameID: d.gameID,
      crit,
      posted: d.lastChange ? Number(d.lastChange) * 1000 : null,
      end: null,
      flags: { aaa, gem, wishlist: wish, historicLow: false },
    };
    // Meilleure offre par launcher : le filtre « GOG » montre le prix GOG même si Steam est moins cher.
    const prev = byGame.get(d.gameID);
    const offers = prev?.offers || {};
    if (!offers[item.platform] || item.price < offers[item.platform].price) {
      offers[item.platform] = { price: item.price, normalPrice: item.normalPrice, discount: item.discount, merchant: item.merchant, url: item.url, currency: 'USD' };
    }
    byGame.set(d.gameID, { ...(!prev || item.price < prev.price ? item : prev), offers });
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
