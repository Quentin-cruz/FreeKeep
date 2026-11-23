// Récupère toutes les sources de bons plans, avec un cache par source (pour ménager les API).
import { fetchCheapShark, fetchPopularAppIds } from './sources/cheapshark.js';
import { fetchWanted } from './sources/wanted.js';
import { fetchEshop } from './sources/eshop.js';
import { fetchDealabs, mergeDealabsItems, classifyDealabs, dealabsFreebie } from './sources/dealabs.js';
import { fetchPcKeys, mergeKeyPrices } from './sources/pckeys.js';
import { lookupNexarda } from './sources/nexarda.js';
import { fetchDealabsPages } from './sources/dealabspages.js';
import { fetchGog } from './sources/gog.js';
import { fetchEa } from './sources/ea.js';
import { fetchBundles } from './sources/bundles.js';
import { fetchSteamBundles, fetchGogPacks, fetchItchBundles } from './sources/storebundles.js';
import { fetchSwitchKeys } from './sources/switchkeys.js';
import { fetchSteamItems, wishlistDeals } from './sources/steamstore.js';
import { fetchUsdToEur, DEFAULT_USD_EUR } from './sources/rates.js';
import { buildDeals, applyEuros } from './deals.js';
import { WIDEST, keepAtLevel } from './levels.js';
import { wants } from './prefs.js';
import { DENIED } from './access.js';
import { pausedError, noteFailure, noteSuccess, checkDrop, isStale } from './health.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const GAPS = {
  cheapshark: 14 * MIN, // CheapShark bannit temporairement les clients trop pressés
  wanted: 55 * MIN,     // meilleures ventes Steam : change peu dans l'heure
  eshop: 14 * MIN,
  dealabs: 4 * MIN,     // les erreurs de prix partent en quelques minutes
  dealabsPages: 25 * MIN,
  gog: 28 * MIN,
  ea: 3 * 60 * MIN,
  bundles: 2 * 60 * MIN,
  storebundles: 4 * 60 * MIN,
  itchbundles: 3 * 60 * MIN,
  switchkeys: 2 * 60 * MIN,
  wishlist: 28 * MIN,
  rate: 12 * 60 * MIN,
  pckeys: 14 * MIN,     // recherche ciblée NEXARDA : 16 appels par passage
};
const LIST_GAP = 55 * MIN; // meilleures ventes Eneba / Instant Gaming + recherche Steam

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
    wanted: w.pcDeals,
    eshop: w.switchDeals,
    gog: w.pcDeals && !!st.gog,
    ea: w.pcDeals && !!st.ea,
    bundles: w.bundles && ['humble', 'keys', 'indie'].some((b) => settings.bundleStores?.[b] !== false),
    storebundles: w.bundles && settings.bundleStores?.stores !== false && !!(st.steam || st.gog),
    itchbundles: w.bundles && settings.bundleStores?.indie !== false,
    switchkeys: w.switchDeals && settings.keyshops !== false,
    pckeys: w.pcDeals && settings.keyshops !== false && !!st.steam,
    dealabsPages: !!settings.dealabs && (w.pcDeals || w.switchDeals || w.free),
    dealabs: !!settings.dealabs && (w.pcDeals || w.switchDeals || w.free || w.bundles),
  };
};

/** Lit les sources (au plus large) et remplit `cache`. Renvoie les erreurs par source. */
export async function fetchDealSources(rawSettings, cache, now = Date.now(), force = [], { wishlist = [], denied = new Set() } = {}) {
  const w = wants(rawSettings);
  const on = enabledSources(rawSettings, w);
  const settings = { ...rawSettings, pcDeals: w.pcDeals, switchDeals: w.switchDeals };
  const wide = { ...settings, ...WIDEST, switch2: true };
  const errors = {};
  // Anciennes sources (GG.deals demandait un compte) : remplacées par `pckeys`.
  delete cache.ggdeals;
  delete cache.watchlist;
  const run = async (name, enabled, job) => {
    if (!enabled) {
      delete cache[name];
      noteSuccess(cache, name);
      return;
    }
    if (denied.has(name)) {
      errors[name] = DENIED;
      return;
    }
    if (!force.includes(name)) {
      const paused = pausedError(cache, name, now);
      if (paused) {
        errors[name] = paused;
        return;
      }
      if (cache[name] && now - cache[name].at < GAPS[name]) return;
    }
    try {
      const got = { ...(await job(cache[name])), at: now };
      if (name !== 'wishlist') checkDrop(cache[name], got, now); // la liste de souhaits peut vraiment se vider
      cache[name] = got;
      noteSuccess(cache, name);
    } catch (e) {
      errors[name] = String(e?.message || e);
      noteFailure(cache, name, errors[name], now);
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
      const fresh = await fetchDealabs();
      if (prev?.raw?.length && !fresh.length) throw new Error('plus aucun résultat, le site a peut-être changé');
      const raw = mergeDealabsItems([...(prev?.raw || []), ...fresh])
        .filter((it) => !it.pubDate || now - it.pubDate < 14 * DAY)
        .slice(-600);
      return { raw };
    }),
  ]);

  // Après CheapShark, pour ne pas l'interroger deux fois en même temps
  await run('wanted', on.wanted, async () => fetchWanted(settings, { cheapshark: !denied.has('cheapshark') && !pausedError(cache, 'cheapshark', now) }));
  await run('itchbundles', on.itchbundles, async () => ({ items: await fetchItchBundles(cache.rate?.usdEur, now) }));
  await run('storebundles', on.storebundles, async () => {
    const results = await Promise.allSettled([
      st.steam ? fetchPopularAppIds().catch(() => []).then((ids) => fetchSteamBundles([...ids, ...(cache.cheapshark?.items || []).map((d) => d.steamAppID), ...wishlist])) : [],
      st.gog ? fetchGogPacks() : [],
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw results[0].reason;
    return { items: ok.flatMap((r) => r.value) };
  });

  // Après les autres sources Steam, pour ne pas saturer la recherche du store
  // Deux volets : meilleures ventes d'Eneba / Instant Gaming, et recherche ciblée (NEXARDA)
  // des promos officielles affichées, quelques jeux par vérification.
  await run('pckeys', on.pckeys, async (prev) => {
    const refs = { ...(prev?.refs || {}) };
    const lows = { ...(prev?.lows || {}) };
    const nx = structuredClone(prev?.nx || {});
    // Les promos affichées, les plus vendues d'abord
    const targets = [...(cache.wanted?.items || []), ...(cache.wishlist?.items || []), ...(cache.cheapshark?.items || [])].map((d) => d.steamAppID);
    const listFresh = prev?.base && now - (prev.listAt || 0) < LIST_GAP;
    const [listing, found] = await Promise.allSettled([
      listFresh ? prev.base : fetchPcKeys(refs, lows, now),
      lookupNexarda(targets, nx, now),
    ]);
    if (listing.status === 'rejected' && found.status === 'rejected') throw listing.reason;
    const base = listing.status === 'fulfilled' ? listing.value : prev?.base || { items: [], prices: {} };
    const listAt = listing.status === 'fulfilled' && !listFresh ? now : prev?.listAt || 0;
    const { items, prices } = mergeKeyPrices(base, found.status === 'fulfilled' ? found.value : {}, lows, now);
    return { items, prices, base, listAt, refs, lows, nx };
  });
  return errors;
}

// Plateformes décochées depuis la lecture : leurs offres disparaissent tout de suite.
function onlyStores(d, stores) {
  const offers = Object.entries(d.offers).filter(([p]) => !stores || stores[p]).sort(([, a], [, b]) => a.price - b.price);
  return offers.length ? { ...d, ...offers[0][1], platform: offers[0][0], offers: Object.fromEntries(offers) } : null;
}

/** Construit la liste à partir du cache, sans réseau. */
export function assembleDeals(rawSettings, cache, history, now = Date.now(), errors = {}) {
  const w = wants(rawSettings);
  const settings = { ...rawSettings, pcDeals: w.pcDeals, switchDeals: w.switchDeals };
  const on = enabledSources(rawSettings, w);
  // Une source en panne depuis plus d'un jour n'est plus montrée : ses prix ont sans doute changé.
  const read = (name) => (isStale(cache[name], now) ? null : cache[name]);
  const items = (name) => (on[name] ? keepAtLevel(structuredClone(read(name)?.items || []), settings) : []);
  // « Stores sélectionnés au-dessus » : seulement les bundles des stores cochés
  const bundleWanted = (d) => !!d.store && settings.bundleStores?.[d.store] !== false && (d.store !== 'stores' || !d.platform || !!settings.stores?.[d.platform]);

  const rate = cache.rate?.usdEur || DEFAULT_USD_EUR;
  const dealabsRaw = mergeDealabsItems([...(read('dealabs')?.raw || []), ...(settings.dealabs ? read('dealabsPages')?.raw || [] : [])]);
  const dealabs = dealabsRaw
    .map((it) => classifyDealabs(it, settings, now))
    .filter((d) => d && (d.section === 'bundle' ? w.bundles : d.section === 'pc' ? settings.pcDeals : settings.switchDeals));
  const keyPrices = on.pckeys ? read('pckeys')?.prices || {} : {};
  const freebies = w.free
    ? dealabsRaw.map((it) => dealabsFreebie(it, { stores: w.stores, prime: w.prime, maxAgeDays: settings.dealMaxAgeDays || 7 }, now)).filter(Boolean)
    : [];

  const deals = buildDeals(
    {
      // copies : buildDeals ajoute des badges, le cache doit rester brut
      cheapshark: applyEuros(items('cheapshark'), cache.cheapshark?.steam || {}, rate),
      wanted: items('wanted').map((d) => onlyStores(d, settings.stores)).filter(Boolean),
      wishlist: settings.pcDeals ? structuredClone(read('wishlist')?.items || []) : [],
      gog: items('gog'),
      ea: items('ea'),
      bundles: [...items('bundles'), ...items('storebundles'), ...items('itchbundles')].filter(bundleWanted),
      switchkeys: items('switchkeys').filter((d) => settings.switch2 || d.platform !== 'switch2'),
      eshop: items('eshop').filter((d) => settings.switch2 || d.platform !== 'switch2'),
      dealabs: dealabs.filter((d) => d.section !== 'bundle' || bundleWanted(d)),
      pckeys: on.pckeys ? structuredClone(read('pckeys')?.items || []) : [],
    },
    history,
    keyPrices,
    now,
  );

  // État de chaque source pour la page de réglages
  const counts = {
    cheapshark: cache.cheapshark?.items?.length,
    wanted: cache.wanted?.items?.length,
    eshop: cache.eshop?.items?.length,
    gog: cache.gog?.items?.length,
    ea: cache.ea?.items?.length,
    bundles: cache.bundles?.items?.length,
    storebundles: cache.storebundles?.items?.length,
    itchbundles: cache.itchbundles?.items?.length,
    switchkeys: cache.switchkeys?.items?.length,
    dealabsPages: cache.dealabsPages?.raw?.length,
    dealabs: dealabs.length + freebies.length,
    pckeys: cache.pckeys ? Object.keys(cache.pckeys.prices || {}).length : undefined,
  };
  const enabled = on;
  const status = {};
  for (const name of Object.keys(enabled)) {
    if (!enabled[name]) continue;
    status[name] = errors[name]
      ? { ok: false, error: errors[name], at: cache[name]?.at || null, stale: isStale(cache[name], now) }
      : { ok: true, count: counts[name] ?? 0, at: cache[name]?.at || null };
  }

  return { deals: deals.filter((d) => !d.end || d.end > now), freebies, errors, status, rate, wishNames: cache.wishlist?.names || [], ranks: read('wanted')?.ranks || {} };
}
