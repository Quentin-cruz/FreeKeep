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
import { WIDEST, keepAtLevel } from './levels.js';
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
export async function refreshDeals(rawSettings, cache, history, now = Date.now(), force = [], opts = {}) {
  const errors = await fetchDealSources(rawSettings, cache, now, force, opts);
  return assembleDeals(rawSettings, cache, history, now, errors);
}

const enabledSources = (settings, w) => {
  const st = settings.stores || {};
  return {
    cheapshark: w.pcDeals,
    eshop: w.switchDeals,
    gog: w.pcDeals && !!st.gog,
    ea: w.pcDeals && !!st.ea,
    bundles: w.bundles,
    switchkeys: w.switchDeals && settings.keyshops !== false,
    dealabsPages: !!settings.dealabs && (w.pcDeals || w.switchDeals || w.free),
    dealabs: !!settings.dealabs && (w.pcDeals || w.switchDeals || w.free || w.bundles),
  };
};

/** Lit les sources (au plus large) et remplit `cache`. Renvoie les erreurs par source. */
export async function fetchDealSources(rawSettings, cache, now = Date.now(), force = [], { wishlist = [] } = {}) {
  const w = wants(rawSettings);
  const on = enabledSources(rawSettings, w);
  const settings = { ...rawSettings, pcDeals: w.pcDeals, switchDeals: w.switchDeals };
  const wide = { ...settings, ...WIDEST, switch2: true };
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
    run('cheapshark', on.cheapshark, async () => {
      const items = await fetchCheapShark(wide, settings.useWishlist ? wishlist : []);
      let steam = {};
      try {
        steam = await fetchSteamItems(items.map((d) => d.steamAppID), { reviews: false });
      } catch (e) {
        console.warn('[FreeKeep] prix Steam :', e); // les prix convertis suffisent
      }
      return { items, steam };
    }),
    run('gog', on.gog, async () => ({ items: await fetchGog(wide) })),
    run('ea', on.ea, async () => ({ items: await fetchEa(wide) })),
    run('bundles', on.bundles, async (prev) => {
      const pages = { ...(prev?.pages || {}) };
      return { items: await fetchBundles(wide, pages, now, cache.rate?.usdEur), pages };
    }),
    run('switchkeys', on.switchkeys, async (prev) => {
      const refs = { ...(prev?.refs || {}) };
      return { items: await fetchSwitchKeys(wide, refs, now), refs };
    }),
    run('wishlist', settings.pcDeals && !!st.steam && settings.useWishlist && wishlist.length > 0, async () => {
      const items = await fetchSteamItems(wishlist.slice(0, 500));
      return { items: wishlistDeals(wishlist, items), names: Object.values(items).map((i) => i.name) };
    }),
    run('dealabsPages', on.dealabsPages, async () => ({
      raw: await fetchDealabsPages([settings.switchDeals ? 'switch' : null, settings.pcDeals ? 'pc' : null, w.free ? 'free' : null].filter(Boolean)),
    })),
    run('eshop', on.eshop, async () => ({ items: await fetchEshop(wide) })),
    // Dealabs sert aussi aux jeux offerts sans API (Prime, Microsoft Store, Battle.net).
    run('dealabs', on.dealabs, async (prev) => {
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
  return errors;
}

/** Construit la liste à partir du cache, sans réseau. */
export function assembleDeals(rawSettings, cache, history, now = Date.now(), errors = {}) {
  const w = wants(rawSettings);
  const settings = { ...rawSettings, pcDeals: w.pcDeals, switchDeals: w.switchDeals };
  const on = enabledSources(rawSettings, w);
  const items = (name) => (on[name] ? keepAtLevel(structuredClone(cache[name]?.items || []), settings) : []);
  const withKey = settings.pcDeals && !!settings.ggdealsKey && settings.keyshops !== false && !!settings.stores?.steam;

  const rate = cache.rate?.usdEur || DEFAULT_USD_EUR;
  const dealabsRaw = mergeDealabsItems([...(cache.dealabs?.raw || []), ...(settings.dealabs ? cache.dealabsPages?.raw || [] : [])]);
  const dealabs = dealabsRaw
    .map((it) => classifyDealabs(it, settings, now))
    .filter((d) => d && (d.section === 'bundle' ? w.bundles : d.section === 'pc' ? settings.pcDeals : settings.switchDeals));
  const gg = cache.ggdeals?.prices || {};
  const freebies = w.free
    ? dealabsRaw.map((it) => dealabsFreebie(it, { stores: w.stores, prime: w.prime, maxAgeDays: settings.dealMaxAgeDays || 7 }, now)).filter(Boolean)
    : [];

  const deals = buildDeals(
    {
      // copies : buildDeals ajoute des badges, le cache doit rester brut
      cheapshark: applyEuros(items('cheapshark'), cache.cheapshark?.steam || {}, rate),
      wishlist: settings.pcDeals ? structuredClone(cache.wishlist?.items || []) : [],
      gog: items('gog'),
      ea: items('ea'),
      bundles: items('bundles').filter((d) => settings.bundleStores?.[d.store] !== false),
      switchkeys: items('switchkeys').filter((d) => settings.switch2 || d.platform !== 'switch2'),
      eshop: items('eshop').filter((d) => settings.switch2 || d.platform !== 'switch2'),
      dealabs: dealabs.filter((d) => d.section !== 'bundle' || settings.bundleStores?.[d.store] !== false),
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
  const enabled = { ...on, ggdeals: withKey };
  const status = {};
  for (const name of Object.keys(enabled)) {
    if (!enabled[name]) continue;
    status[name] = errors[name]
      ? { ok: false, error: errors[name], at: cache[name]?.at || null }
      : { ok: true, count: counts[name] ?? 0, at: cache[name]?.at || null };
  }

  return { deals: deals.filter((d) => !d.end || d.end > now), freebies, errors, status, rate, wishNames: cache.wishlist?.names || [] };
}
