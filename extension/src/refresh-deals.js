// Récupère toutes les sources de bons plans, avec un cache par source (pour ménager les API).
import { fetchCheapShark, fetchPopularAppIds } from './sources/cheapshark.js';
import { fetchEshop } from './sources/eshop.js';
import { fetchDealabs, mergeDealabsItems, classifyDealabs, dealabsFreebie } from './sources/dealabs.js';
import { fetchGgDeals, ggKeyshopDeals } from './sources/ggdeals.js';
import { fetchDealabsPages } from './sources/dealabspages.js';
import { fetchGog } from './sources/gog.js';
import { fetchEa } from './sources/ea.js';
import { fetchBundles } from './sources/bundles.js';
import { fetchSwitchKeys } from './sources/switchkeys.js';
import { fetchSteamItems, wishlistDeals } from './sources/steamstore.js';
import { fetchUsdToEur, DEFAULT_USD_EUR } from './sources/rates.js';
import { buildDeals, applyEuros } from './deals.js';
import { wants } from './prefs.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const GAPS = {
  cheapshark: 14 * MIN, // CheapShark bannit temporairement les clients trop pressés
  eshop: 14 * MIN,
  dealabs: 4 * MIN,     // les erreurs de prix partent en quelques minutes
  dealabsPages: 25 * MIN,
  gog: 28 * MIN,
  ea: 3 * 60 * MIN,
  bundles: 2 * 60 * MIN,
  switchkeys: 2 * 60 * MIN,
  wishlist: 28 * MIN,
  rate: 12 * 60 * MIN,
  watchlist: 7 * DAY,   // liste des gros jeux surveillés sur les sites de clés
  ggdeals: 50 * MIN,    // GG.deals : 1 000 prix/heure max
};

/**
 * @param cache   cache persistant par source (modifié en place)
 * @param history dernier prix vu par deal (modifié en place)
 * @param force   noms de sources à recharger même si le cache est récent
 */
export async function refreshDeals(rawSettings, cache, history, now = Date.now(), force = [], { wishlist = [] } = {}) {
  const w = wants(rawSettings);
  const settings = { ...rawSettings, pcDeals: w.pcDeals, switchDeals: w.switchDeals };
  const errors = {};
  const run = async (name, enabled, job) => {
    if (!enabled) {
      delete cache[name];
      return;
    }
    if (cache[name] && now - cache[name].at < GAPS[name] && !force.includes(name)) return;
    try {
      cache[name] = { ...(await job(cache[name])), at: now };
    } catch (e) {
      errors[name] = String(e?.message || e);
      console.warn(`[FreeKeep] source ${name} :`, e);
    }
  };

  const st = settings.stores || {};
  await Promise.all([
    run('rate', true, async () => ({ usdEur: await fetchUsdToEur() })),
    run('cheapshark', settings.pcDeals, async () => {
      const items = await fetchCheapShark(settings, settings.useWishlist ? wishlist : []);
      let steam = {};
      try {
        steam = await fetchSteamItems(items.map((d) => d.steamAppID), { reviews: false });
      } catch (e) {
        console.warn('[FreeKeep] prix Steam :', e); // les prix convertis suffisent
      }
      return { items, steam };
    }),
    run('gog', settings.pcDeals && !!st.gog, async () => ({ items: await fetchGog(settings) })),
    run('ea', settings.pcDeals && !!st.ea, async () => ({ items: await fetchEa(settings) })),
    run('bundles', settings.pcDeals && settings.bundles !== false && !!st.steam, async (prev) => {
      const humble = { ...(prev?.humble || {}) };
      return { items: await fetchBundles(settings, humble, now), humble };
    }),
    run('switchkeys', settings.switchDeals && settings.keyshops !== false, async (prev) => {
      const refs = { ...(prev?.refs || {}) };
      return { items: await fetchSwitchKeys(settings, refs, now), refs };
    }),
    run('wishlist', settings.pcDeals && !!st.steam && settings.useWishlist && wishlist.length > 0, async () => {
      const items = await fetchSteamItems(wishlist.slice(0, 500));
      return { items: wishlistDeals(wishlist, items), names: Object.values(items).map((i) => i.name) };
    }),
    run('dealabsPages', settings.dealabs && (settings.pcDeals || settings.switchDeals), async () => ({
      raw: await fetchDealabsPages([settings.switchDeals ? 'switch' : null, settings.pcDeals ? 'pc' : null].filter(Boolean)),
    })),
    run('eshop', settings.switchDeals, async () => ({ items: await fetchEshop(settings) })),
    // Dealabs sert aussi aux jeux offerts sans API (Prime, Microsoft Store, Battle.net).
    run('dealabs', settings.dealabs && (settings.pcDeals || settings.switchDeals || w.free), async (prev) => {
      // Les flux RSS ne montrent que les derniers deals : on les accumule sur 14 jours.
      const raw = mergeDealabsItems([...(prev?.raw || []), ...(await fetchDealabs())])
        .filter((it) => !it.pubDate || now - it.pubDate < 14 * DAY)
        .slice(-600);
      return { raw };
    }),
  ]);

  const withKey = settings.pcDeals && !!settings.ggdealsKey && settings.keyshops !== false && !!settings.stores?.steam;
  await run('watchlist', withKey, async () => ({ appids: await fetchPopularAppIds() }));
  await run('ggdeals', withKey, async () => {
    const ids = [...(cache.cheapshark?.items || []).map((d) => d.steamAppID), ...(cache.watchlist?.appids || [])];
    return { prices: await fetchGgDeals(ids, settings.ggdealsKey) };
  });

  const rate = cache.rate?.usdEur || DEFAULT_USD_EUR;
  const dealabsRaw = mergeDealabsItems([...(cache.dealabs?.raw || []), ...(settings.dealabs ? cache.dealabsPages?.raw || [] : [])]);
  const dealabs = dealabsRaw
    .map((it) => classifyDealabs(it, settings, now))
    .filter((d) => d && (d.section === 'pc' ? settings.pcDeals : settings.switchDeals));
  const gg = cache.ggdeals?.prices || {};
  const freebies = w.free
    ? dealabsRaw.map((it) => dealabsFreebie(it, { stores: w.stores, prime: w.prime, maxAgeDays: settings.dealMaxAgeDays || 7 }, now)).filter(Boolean)
    : [];

  const deals = buildDeals(
    {
      // copies : buildDeals ajoute des badges, le cache doit rester brut
      cheapshark: settings.pcDeals ? applyEuros(structuredClone(cache.cheapshark?.items || []), cache.cheapshark?.steam || {}, rate) : [],
      wishlist: structuredClone(cache.wishlist?.items || []),
      gog: structuredClone(cache.gog?.items || []),
      ea: structuredClone(cache.ea?.items || []),
      bundles: structuredClone(cache.bundles?.items || []),
      switchkeys: structuredClone(cache.switchkeys?.items || []),
      eshop: settings.switchDeals ? structuredClone(cache.eshop?.items || []) : [],
      dealabs,
      ggdeals: settings.pcDeals ? ggKeyshopDeals(gg) : [],
    },
    history,
    gg,
    now,
  );

  // État de chaque source pour la page de réglages
  const counts = {
    cheapshark: cache.cheapshark?.items?.length,
    eshop: cache.eshop?.items?.length,
    gog: cache.gog?.items?.length,
    ea: cache.ea?.items?.length,
    bundles: cache.bundles?.items?.length,
    switchkeys: cache.switchkeys?.items?.length,
    dealabsPages: cache.dealabsPages?.raw?.length,
    dealabs: dealabs.length + freebies.length,
    ggdeals: cache.ggdeals ? Object.keys(cache.ggdeals.prices || {}).length : undefined,
  };
  const enabled = {
    cheapshark: settings.pcDeals,
    eshop: settings.switchDeals,
    gog: settings.pcDeals && !!st.gog,
    ea: settings.pcDeals && !!st.ea,
    bundles: settings.pcDeals && settings.bundles !== false && !!st.steam,
    switchkeys: settings.switchDeals && settings.keyshops !== false,
    dealabsPages: settings.dealabs && (settings.pcDeals || settings.switchDeals),
    dealabs: settings.dealabs && (settings.pcDeals || settings.switchDeals || w.free),
    ggdeals: withKey,
  };
  const status = {};
  for (const name of Object.keys(enabled)) {
    if (!enabled[name]) continue;
    status[name] = errors[name]
      ? { ok: false, error: errors[name], at: cache[name]?.at || null }
      : { ok: true, count: counts[name] ?? 0, at: cache[name]?.at || null };
  }

  return { deals: deals.filter((d) => !d.end || d.end > now), freebies, errors, status, rate, wishNames: cache.wishlist?.names || [] };
}
