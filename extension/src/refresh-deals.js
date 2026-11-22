// Récupère toutes les sources de bons plans, avec un cache par source (pour ménager les API).
import { fetchCheapShark, fetchPopularAppIds } from './sources/cheapshark.js';
import { fetchEshop } from './sources/eshop.js';
import { fetchDealabs, mergeDealabsItems, classifyDealabs, dealabsFreebie } from './sources/dealabs.js';
import { fetchGgDeals, ggKeyshopDeals } from './sources/ggdeals.js';
import { buildDeals } from './deals.js';
import { wants } from './prefs.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const GAPS = {
  cheapshark: 15 * MIN, // CheapShark bannit temporairement les clients trop pressés
  eshop: 15 * MIN,
  dealabs: 10 * MIN,
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

  await Promise.all([
    run('cheapshark', settings.pcDeals, async () => ({ items: await fetchCheapShark(settings, settings.useWishlist ? wishlist : []) })),
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

  const dealabs = (cache.dealabs?.raw || [])
    .map((it) => classifyDealabs(it, settings, now))
    .filter((d) => d && (d.section === 'pc' ? settings.pcDeals : settings.switchDeals));
  const gg = cache.ggdeals?.prices || {};
  const freebies = w.free
    ? (cache.dealabs?.raw || []).map((it) => dealabsFreebie(it, { stores: w.stores, prime: w.prime, maxAgeDays: settings.dealMaxAgeDays || 7 }, now)).filter(Boolean)
    : [];

  const deals = buildDeals(
    {
      // copies : buildDeals ajoute des badges, le cache doit rester brut
      cheapshark: settings.pcDeals ? structuredClone(cache.cheapshark?.items || []) : [],
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
    dealabs: dealabs.length + freebies.length,
    ggdeals: cache.ggdeals ? Object.keys(cache.ggdeals.prices || {}).length : undefined,
  };
  const enabled = {
    cheapshark: settings.pcDeals,
    eshop: settings.switchDeals,
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

  return { deals: deals.filter((d) => !d.end || d.end > now), freebies, errors, status };
}
