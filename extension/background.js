// FreeKeep — service worker (Manifest V3)
// Vérifie périodiquement les jeux gratuits et les bons plans, applique la personnalisation,
// gère notifications, badge et réclamation assistée.
import { STORES, ALARM_NAME, DEAL_SOURCES, LEVELS } from './src/config.js';
import { fetchEpic } from './src/sources/epic.js';
import { fetchSteam } from './src/sources/steam.js';
import { fetchGamerPower } from './src/sources/gamerpower.js';
import { fetchSteamLibrary, fetchSteamProfile, fetchSteamSession } from './src/sources/steamlibrary.js';
import { fetchGogLibrary } from './src/sources/goglibrary.js';
import { enrichAppInfo } from './src/sources/steamapps.js';
import { resolveSteamIds } from './src/sources/steamsearch.js';
import { fetchSteamItems } from './src/sources/steamstore.js';
import { worthInEur, DEFAULT_USD_EUR } from './src/sources/rates.js';
import { mergeGames } from './src/merge.js';
import { refreshDeals, fetchDealSources, assembleDeals } from './src/refresh-deals.js';
import { fetchLootScraper } from './src/sources/lootscraper.js';
import { tasteFrom, genresToHide, rankFranchises, filterHits, recommendedLevel, COMFORT } from './src/recommend.js';
import { isExceptional, scoreDeal } from './src/deals.js';
import { effective, wants, hiddenReason, makeOwnedIndex, sameGameStrict, extractGameName, steamOnly, showsGame } from './src/prefs.js';
import {
  getSettings, saveSettings, migrateKey, getDraft, saveDraft, getData, saveData, locked, updateData, stateFor, patchState, keysForHistory, getClaimTabs, updateClaimTabs,
} from './src/store.js';
import { isNewer, fetchLatestVersion, CHECK_EVERY } from './src/update.js';
import { mergeStates } from './src/backup.js';
import { deniedSources, missingOrigins, syncClaimScripts, DENIED } from './src/access.js';
import { pausedError, noteFailure, noteSuccess, checkDrop } from './src/health.js';
import { isGamePage, isNextStep, isProductPage, matchByUrl, steamApp } from './src/claim.js';
import { formatDate, formatDuration, formatPrice } from './src/util.js';

const SOURCES = ['epic', 'steam', 'lootscraper', 'gamerpower']; // ordre de priorité pour la fusion
const CACHE_MAX_AGE = 3 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const ICON = 'icons/icon128.png';
const LIBRARY_MAX_AGE = 12 * 3600 * 1000;
const FREE_GAP = 14 * 60 * 1000; // vérifications rapprochées : Epic, Steam et GamerPower ne sont relus que toutes les 15 min

const plural = (n, one, many) => (n > 1 ? many : one);
const storeName = (g) => STORES[g.store]?.short || g.store;

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await migrateKey().catch((e) => console.warn('[FreeKeep] clé GG.deals :', e));
  await updateScripts();
  await scheduleAlarm();
  const settings = await getSettings();
  // Tutoriel au premier lancement (et après une mise à jour si jamais fait)
  if (!settings.onboarded && (reason === 'install' || reason === 'update')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
  await refresh(reason);
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await updateScripts();
  const { meta } = await getData();
  if (!meta.lastRefresh || Date.now() - meta.lastRefresh > 60 * 60 * 1000) refresh('startup');
  else updateBadge();
});

// Accès à un site accordé ou retiré
const updateScripts = () => syncClaimScripts().catch((e) => console.warn('[FreeKeep] pages des stores :', e));
chrome.permissions?.onAdded.addListener(async () => {
  await updateScripts();
  settingsRefresh(['dealabs', 'goglib', 'rate', ...DEAL_SOURCES]);
});
chrome.permissions?.onRemoved.addListener(updateScripts);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refresh('alarm');
});

// Réglages qui ne demandent qu'un nouveau tri (pas de nouveau téléchargement)
const CHEAP_SETTINGS = ['notifyNew', 'notifyLastDay', 'notifyDeals', 'notifyWishlist', 'autoClick', 'intervalHours', 'onboarded', 'checkUpdates'];
// Réglages qui changent ce qu'on demande aux API
const REFETCH_SETTINGS = ['pc', 'switch', 'stores', 'ggdealsKey', 'keyshops', 'bundles', 'pcDeals', 'switchDeals'];
const LIBRARY_SETTINGS = ['steamProfile', 'steamOwnedSync', 'useWishlist'];
const GOG_SETTINGS = ['gogSessionSync'];
const NOTIFY_SETTINGS = ['notifyNew', 'notifyLastDay', 'notifyDeals', 'notifyWishlist'];

const changedSettings = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const needsRefresh = (changed) => changed.some((k) => !CHEAP_SETTINGS.includes(k));

chrome.storage.onChanged.addListener((changes, area) => {
  // Clé GG.deals : gardée sur cet ordinateur, hors des réglages synchronisés
  if (area === 'local' && changes.ggdealsKey && (changes.ggdealsKey.oldValue || '') !== (changes.ggdealsKey.newValue || '')) settingsRefresh(['ggdeals', 'watchlist']);
  if (area !== 'sync' || !changes.settings) return;
  const before = changes.settings.oldValue || {};
  const after = changes.settings.newValue || {};
  const changed = changedSettings(before, after);
  if (changed.includes('intervalHours')) scheduleAlarm();
  if (!needsRefresh(changed)) {
    updateBadge();
    return;
  }
  const force = new Set();
  if (changed.some((k) => REFETCH_SETTINGS.includes(k))) DEAL_SOURCES.forEach((f) => force.add(f));
  if (changed.some((k) => LIBRARY_SETTINGS.includes(k))) ['steamlib', 'cheapshark', 'wishlist'].forEach((f) => force.add(f));
  if (changed.some((k) => GOG_SETTINGS.includes(k))) force.add('goglib');
  settingsRefresh([...force]);
});

// Les réglages changent souvent en rafale : on attend 1,5 s avant de recharger.
let settingsTimer = null;
let pendingForce = new Set();
function settingsRefresh(force = []) {
  force.forEach((f) => pendingForce.add(f));
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const f = [...pendingForce];
    pendingForce = new Set();
    const settings = await getSettings();
    // La vérification en cours a déjà pris ces réglages (fin du tutoriel) : inutile d'en refaire une.
    if (running && current?.settings && !needsRefresh(changedSettings(current.settings, settings)) && f.every((x) => current.force.includes(x))) return;
    refresh('settings', { force: f, fresh: true });
  }, 1500);
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getClaimTabs())[tabId]) await updateClaimTabs((tabs) => { delete tabs[tabId]; });
});

async function scheduleAlarm() {
  const { intervalHours } = await getSettings();
  const period = Math.max(5, Math.round((Number(intervalHours) || 1) * 60));
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: period, periodInMinutes: period });
  }
}

// ---------------------------------------------------------------------------
// Rafraîchissement des sources
// ---------------------------------------------------------------------------

let running = null; // vérification en cours
let current = null; // ses réglages et les sources qu'elle recharge
let next = null;    // vérification à lancer juste après

function start(reason, force) {
  current = { settings: null, force };
  running = keepAlive(doRefresh(reason, force)).finally(() => { running = null; });
  return running;
}

// Le navigateur arrête un service worker inactif depuis 30 s, même s'il attend encore une réponse.
// Un appel régulier à une API de l'extension le garde éveillé, seulement le temps du travail.
async function keepAlive(work) {
  const beat = setInterval(() => chrome.runtime.getPlatformInfo?.().catch(() => {}), 20 * 1000);
  try {
    return await work;
  } finally {
    clearInterval(beat);
  }
}

/**
 * Une seule vérification à la fois. Pendant qu'une tourne :
 *  - sans demande particulière (popup, alarme), on attend simplement celle en cours ;
 *  - avec `force` ou `fresh` (réglage changé), une seule autre part juste après, avec les réglages du moment.
 */
function refresh(reason = 'manual', { force = [], fresh = false } = {}) {
  if (!running && !next) return start(reason, force);
  if (running && !fresh && !force.length) return running;
  if (!next) {
    next = { reason, force: new Set() };
    next.promise = running.catch(() => {}).then(() => {
      const n = next;
      next = null;
      return start(n.reason, [...n.force]);
    });
  }
  force.forEach((f) => next.force.add(f));
  return next.promise;
}

// Tutoriel quitté en route depuis 30 min : les réponses déjà données s'appliquent, et les alertes démarrent.
const TUTORIAL_QUIET = 30 * 60 * 1000;
async function adoptDraft(now) {
  const saved = await getDraft();
  if (!saved?.draft || saved.adopted || now - saved.at < TUTORIAL_QUIET) return;
  const settings = await getSettings();
  if (settings.onboarded || saved.base !== JSON.stringify(settings) || !(saved.draft.pc || saved.draft.switch)) return;
  await saveSettings({ ...saved.draft, onboarded: false });
  await saveDraft({ ...saved, base: JSON.stringify(await getSettings()), adopted: true });
}

// Pas d'alerte pendant le tutoriel ; s'il n'est jamais fini, elles démarrent quand même au bout de 30 min.
async function tutorialRunning(settings, meta, now) {
  if (settings.onboarded) return false;
  const saved = await getDraft();
  return now - Math.max(meta.firstSeen || now, saved?.at || 0) < TUTORIAL_QUIET;
}

async function doRefresh(reason, force) {
  await adoptDraft(Date.now()).catch((e) => console.warn('[FreeKeep] tutoriel :', e));
  const rawSettings = await getSettings();
  current.settings = rawSettings;
  const settings = effective(rawSettings);
  const w = wants(settings);
  const data = await getData();
  const enabled = w.free ? w.stores : [];
  const now = Date.now();
  const denied = await deniedSources();

  // ---- 1. Jeux gratuits ----
  const jobs = {
    epic: enabled.includes('epic') ? () => fetchEpic(now) : null,
    steam: enabled.includes('steam') ? () => fetchSteam() : null,
    lootscraper: enabled.length ? () => fetchLootScraper(now) : null,
    gamerpower: enabled.length ? () => fetchGamerPower(enabled, now, { prime: w.prime }) : null,
  };
  const errors = {};
  await Promise.all(
    SOURCES.map(async (name) => {
      if (!jobs[name]) return;
      if (denied.has(name)) {
        errors[name] = DENIED;
        return;
      }
      if (reason === 'alarm') {
        const paused = pausedError(data.cache, name, now);
        if (paused) errors[name] = paused;
        if (paused || (data.cache[name] && now - data.cache[name].at < FREE_GAP)) return;
      }
      try {
        const got = { items: await jobs[name](), at: Date.now() };
        checkDrop(data.cache[name], got, now, name === 'epic' ? 1 : 5); // Epic offre toujours au moins un jeu
        data.cache[name] = got;
        noteSuccess(data.cache, name);
      } catch (e) {
        errors[name] = String(e?.message || e);
        noteFailure(data.cache, name, errors[name], now);
        console.warn(`[FreeKeep] source ${name} :`, e);
      }
    }),
  );
  const sourceStatus = {};
  for (const name of SOURCES) {
    if (!jobs[name]) continue;
    sourceStatus[name] = errors[name]
      ? { ok: false, error: errors[name], at: data.cache[name]?.at || null }
      : { ok: true, count: data.cache[name]?.items?.length ?? 0, at: data.cache[name]?.at || null };
  }

  // ---- 2. Bibliothèque + liste de souhaits Steam ----
  const libChanged = await syncSteamLibrary(settings, data, now, force.includes('steamlib'));
  if (libChanged) force = [...new Set([...force, 'cheapshark', 'wishlist'])];
  await nameOwnedGames(data);
  if (data.steamLib?.at) {
    sourceStatus.steamlib = data.steamLib.error
      ? { ok: false, error: data.steamLib.error, at: data.steamLib.at }
      : { ok: true, count: data.steamLib.count || 0, at: data.steamLib.at };
  }
  await syncGogLibrary(settings, data, now, force.includes('goglib'), denied);
  if (data.gogLib?.at) {
    sourceStatus.goglib = data.gogLib.error
      ? { ok: false, error: data.gogLib.error, at: data.gogLib.at }
      : { ok: true, count: data.gogLib.count || 0, at: data.gogLib.at };
  }
  const owned = makeOwnedIndex(data.steamLib, data.gogLib);
  const wishlist = settings.useWishlist ? data.steamLib?.wishlist || [] : [];
  const wishSet = new Set(wishlist.map(String));

  // ---- 3. Bons plans PC + Switch ----
  let deals = data.deals;
  let freebies = [];
  let dealErrors = {};
  let dealStatus = {};
  let rate = DEFAULT_USD_EUR;
  let wishNames = [];
  try {
    ({ deals, freebies, errors: dealErrors, status: dealStatus, rate, wishNames } = await refreshDeals(settings, data.dealCache, data.dealHistory, now, force, { wishlist, denied }));
  } catch (e) {
    dealErrors = { bons_plans: String(e?.message || e) };
    console.warn('[FreeKeep] bons plans :', e);
  }

  // Ce qui est téléchargé est gardé tout de suite : si le navigateur coupe la suite, rien n'est à refaire.
  await locked(() => saveData({ cache: data.cache, dealCache: data.dealCache, steamLib: data.steamLib, gogLib: data.gogLib, steamNames: data.steamNames }));

  // Fusion des jeux gratuits. Si une source échoue, on réutilise son dernier résultat (s'il a moins de 3 jours).
  // Les jeux offerts repérés sur Dealabs (Prime, Microsoft Store, Battle.net…) passent en dernier.
  const keep = (i) => enabled.includes(i.store) && (!i.prime || w.prime);
  const lists = SOURCES
    .filter((n) => jobs[n] && data.cache[n] && now - data.cache[n].at < CACHE_MAX_AGE)
    .map((n) => data.cache[n].items.filter(keep));
  const primeKnown = (data.cache.lootscraper?.items || []).some((i) => i.prime);
  // « 7 jeux offerts avec Prime » : chaque jeu est déjà listé séparément
  lists.push((freebies || []).filter((i) => keep(i) && !(i.prime && i.multi && primeKnown)));
  const primeHidden = w.free && !w.prime ? new Set((data.cache.lootscraper?.items || []).filter((i) => i.prime).map((i) => i.title)).size : 0;
  const games = mergeGames(lists, now);
  for (const g of games) if (g.worth) g.worth = worthInEur(g.worth, rate);

  // Annonces Dealabs sans identifiant Steam : on le retrouve par le nom (jeux possédés, souhaits, genres).
  if (settings.stores?.steam) await resolveSteamIds(deals, data.nameIds, now);

  // Plus de « non précisé » : trouvé sur Steam → Steam, sinon « Autres » (masqué si cette plateforme n'est pas cochée).
  for (const d of deals) if (d.section === 'pc' && !d.platform) d.platform = d.steamAppID ? 'steam' : 'other';

  // ---- 4. Genres (seulement si l'utilisateur en exclut) ----
  if ((settings.excludedGenres || []).length) {
    const appids = [...games.map((g) => g.appid), ...deals.map((d) => d.steamAppID)].filter(Boolean);
    try {
      await enrichAppInfo(appids, data.appInfo, { now });
    } catch (e) {
      console.warn('[FreeKeep] genres Steam :', e);
    }
  }

  // ---- 5. Personnalisation ----
  for (const g of games) {
    g.hiddenBy = hiddenReason({ title: g.title, steamAppID: g.appid }, settings, { appInfo: data.appInfo, isGame: true });
  }
  const isWished = (d) => d.section === 'pc' && d.channel !== 'bundle'
    && (d.steamAppID ? wishSet.has(String(d.steamAppID)) : wishNames.some((n) => sameGameStrict(n, extractGameName(d.title))));
  deals = deals.map((d) => {
    const wished = isWished(d);
    const out = { ...(wished ? steamOnly(d) : d) };
    out.flags = { ...d.flags, wishlist: !!(d.flags?.wishlist || wished) && out.hiddenBy !== 'wishlist' };
    if (d.bundle) {
      const has = d.bundle.appids.filter((id) => owned.hasApp(id)).length;
      out.bundle = { ...d.bundle, owned: has };
      out.flags.wishlist = d.bundle.appids.some((id) => wishSet.has(id) && !owned.hasApp(id));
    }
    out.hiddenBy = hiddenReason(out, settings, { appInfo: data.appInfo, owned })
      || (out.hiddenBy === 'wishlist' ? 'wishlist' : null)
      || (d.section === 'pc' && d.platform === 'other' && !settings.stores?.other && d.channel !== 'keyshop' ? 'platform' : null);
    out.exceptional = isExceptional(out);
    out.score = scoreDeal(out);
    return out;
  }).sort((a, b) => b.score - a.score);

  const sessionIds = await steamSessionIds(games, data.states, settings);
  const update = await checkUpdate(settings, data.meta.update, now);

  // ---- 6. Enregistrement ----
  // Les téléchargements prennent plusieurs secondes : on relit ce que l'utilisateur a pu changer entre-temps
  // (récupéré, masqué), puis on enregistre d'un bloc, sans autre écriture au milieu.
  await locked(async () => {
    const current = await getData();
    data.states = current.states;
    data.dealStates = current.dealStates;
    markSteamOwned(games, data.states, data.steamLib, sessionIds);
    syncGogOwned(games, data.states, owned);
    const latest = await getSettings();
    data.meta.firstSeen ||= now;
    data.meta.update = update;
    await finishRefresh({
      quiet: await tutorialRunning(latest, data.meta, now),
      data, games, deals, now, reason, errors, dealErrors,
      sources: { ...sourceStatus, ...dealStatus }, primeHidden,
      // Réglages de notification du moment, même coupés en cours de route
      settings: { ...settings, ...Object.fromEntries(NOTIFY_SETTINGS.map((k) => [k, latest[k]])) },
      // Réglages changés : ces résultats sont dépassés, la prochaine vérification notifiera les bons.
      outdated: needsRefresh(changedSettings(rawSettings, latest)),
    });
  });
  await updateBadge();
  return { ok: true, errors, dealErrors };
}

// Nouvelle version sur GitHub (une lecture par jour, sauf extension installée depuis un store).
async function checkUpdate(settings, last, now) {
  const manifest = chrome.runtime.getManifest?.();
  if (!settings.checkUpdates || !manifest || manifest.update_url) return null;
  if (last && now - last.at < CHECK_EVERY) return last;
  try {
    const version = await fetchLatestVersion();
    return { at: now, version: isNewer(version, manifest.version) ? version : null };
  } catch (e) {
    console.warn('[FreeKeep] nouvelle version :', e);
    return { at: now, version: last?.version || null };
  }
}

// Notifications + enregistrement (appelé sous verrou).
async function finishRefresh({ quiet, data, games, deals, settings, now, reason, errors, dealErrors, sources, outdated, primeHidden }) {
  const visibleGames = games.filter((g) => !g.hiddenBy);
  const visibleDeals = deals.filter((d) => !d.hiddenBy);
  if (!quiet) {
    if (!outdated) {
      notifyChanges(visibleGames, data, settings, now);
      notifyDeals(visibleDeals, data, settings);
    }
  } else {
    // On mémorise ce qui existe déjà pour ne pas tout notifier après le tutoriel.
    const seen = new Set(data.seen);
    games.forEach((g) => g.keys.forEach((k) => seen.add(k)));
    data.seen = [...seen].slice(-800);
    data.seenDeals = [...new Set([...data.seenDeals, ...deals.filter((d) => d.exceptional).map((d) => d.id)])].slice(-1500);
  }
  for (const [id, st] of Object.entries(data.dealStates)) if (now - (st.at || 0) > 60 * DAY) delete data.dealStates[id];

  data.meta = {
    ...data.meta, lastRefresh: now, lastReason: reason, errors, dealErrors,
    initialized: data.meta.initialized || !outdated, dealsInitialized: data.meta.dealsInitialized || !outdated,
    sources, primeHidden,
  };
  await saveData({
    games, states: data.states, meta: data.meta, cache: data.cache, seen: data.seen,
    deals, dealCache: data.dealCache, dealHistory: data.dealHistory, dealStates: data.dealStates, seenDeals: data.seenDeals,
    steamLib: data.steamLib, gogLib: data.gogLib, appInfo: data.appInfo, nameIds: data.nameIds, steamNames: data.steamNames,
  });
}

// Bibliothèque GOG via la session gog.com du navigateur (aucun identifiant stocké).
const gogError = (e) => {
  const m = String(e?.message || e);
  return /HTTP 40[13]|JSON|Unexpected token|pas connecté/i.test(m) ? 'pas connecté à gog.com dans ce navigateur' : m;
};

async function syncGogLibrary(settings, data, now, force, denied) {
  const lib = data.gogLib || {};
  if (denied.has('goglib')) return false;
  if (!(settings.pc && settings.stores?.gog && settings.gogSessionSync)) {
    data.gogLib = {};
    return !!lib.at;
  }
  // Après une erreur (pas connecté), on réessaie au bout d'une heure.
  if (!force && lib.at && now - lib.at < (lib.error ? 3600 * 1000 : LIBRARY_MAX_AGE)) return false;
  const before = lib.count || 0;
  try {
    const res = await fetchGogLibrary();
    data.gogLib = { username: res.username, ids: res.games.map((g) => g.id), names: res.games.map((g) => g.title), count: res.games.length, at: now, error: null };
  } catch (e) {
    data.gogLib = { ...lib, error: gogError(e), at: now };
  }
  return (data.gogLib.count || 0) !== before;
}

// Noms des jeux Steam possédés (la session ne donne que leurs numéros) : pour les reconnaître sur GOG, EA, Dealabs…
const NAMES_PER_RUN = 500;
async function nameOwnedGames(data) {
  const ids = data.steamLib?.appids || [];
  const missing = ids.filter((id) => data.steamNames[id] === undefined).slice(0, NAMES_PER_RUN);
  if (missing.length) {
    try {
      const items = await fetchSteamItems(missing, { reviews: false });
      for (const id of missing) data.steamNames[id] = items[id]?.game ? items[id].name : '';
    } catch (e) {
      console.warn('[FreeKeep] noms des jeux Steam :', e);
    }
  }
  if (!ids.length) return;
  const owned = new Set(ids.map(String));
  for (const id of Object.keys(data.steamNames)) if (!owned.has(id)) delete data.steamNames[id];
  data.steamLib.names = [...new Set([...(data.steamLib.names || []), ...Object.values(data.steamNames).filter(Boolean)])];
}

// Jeux GOG gratuits déjà dans la bibliothèque GOG → cochés « récupérés ».
function syncGogOwned(games, states, owned) {
  for (const g of games) {
    if (g.store !== 'gog' || stateFor(states, g).claimed) continue;
    if (owned.hasGogName(g.title)) patchState(states, g, { claimed: true, claimedAt: Date.now(), claimedVia: 'gog' });
  }
}

// Bibliothèque Steam : session du navigateur et/ou profil. Renvoie true si elle a changé.
async function syncSteamLibrary(settings, data, now, force) {
  const lib = data.steamLib || {};
  const input = settings.steamProfile || '';
  const useSession = !!settings.steamOwnedSync;
  if (!(settings.pc && settings.stores?.steam) || !(input || useSession)) {
    data.steamLib = {};
    return !!lib.at;
  }
  const key = `${input}|${useSession}`;
  const same = lib.key === key;
  // Après une erreur (pas connecté), on réessaie au bout d'une heure.
  if (!force && same && lib.at && now - lib.at < (lib.error ? 3600 * 1000 : LIBRARY_MAX_AGE)) return false;
  const before = `${lib.count || 0}|${(lib.wishlist || []).length}`;
  const res = await fetchSteamLibrary({ input, useSession });
  const prev = same ? lib : {}; // en cas d'échec, on garde les derniers jeux connus
  data.steamLib = {
    key,
    input,
    steamid: res.steamID64 || prev.steamid || null,
    profileName: res.profileName || prev.profileName || '',
    appids: res.error ? prev.appids || [] : res.appids,
    names: res.names.length ? res.names : prev.names || [],
    wishlist: res.wishlist || prev.wishlist || [],
    wishlistError: res.wishlist ? null : res.wishlistError || 'liste de souhaits non lue',
    error: res.error,
    at: now,
  };
  data.steamLib.count = data.steamLib.appids.length;
  return before !== `${data.steamLib.count}|${data.steamLib.wishlist.length}`;
}

const steamCandidates = (games, states) => games.filter((g) => g.store === 'steam' && !stateFor(states, g).claimed);

// Jeux possédés d'après la session Steam du navigateur (seulement s'il y a un jeu gratuit Steam à vérifier).
async function steamSessionIds(games, states, settings) {
  if (!settings.steamOwnedSync || !steamCandidates(games, states).some((g) => g.appid || stateFor(states, g).appid)) return new Set();
  try {
    return new Set((await fetchSteamSession()).appids);
  } catch (e) {
    console.warn('[FreeKeep] lecture des jeux Steam possédés impossible :', e);
    return new Set();
  }
}

// Jeux gratuits Steam déjà possédés : via la bibliothèque et/ou la session Steam du navigateur.
function markSteamOwned(games, states, lib, sessionIds) {
  const libIds = new Set((lib?.appids || []).map(String));
  for (const g of steamCandidates(games, states)) {
    const appid = String(g.appid || stateFor(states, g).appid || '');
    const byLib = (appid && libIds.has(appid)) || (!appid && (lib?.names || []).some((n) => sameGameStrict(n, g.title)));
    const bySession = appid && sessionIds.has(appid);
    if (byLib || bySession) patchState(states, g, { claimed: true, claimedAt: Date.now(), claimedVia: byLib ? 'library' : 'steam' });
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function notifyChanges(games, data, settings, now) {
  const seen = new Set(data.seen);
  const firstRun = !data.meta.initialized;
  const pending = (g) => {
    const s = stateFor(data.states, g);
    return !s.claimed && !s.hidden;
  };

  const active = games.filter((g) => g.status === 'active');
  const fresh = active.filter((g) => !g.keys.some((k) => seen.has(k)) && pending(g));
  active.forEach((g) => g.keys.forEach((k) => seen.add(k)));
  data.seen = [...seen].slice(-800);

  if (settings.notifyNew && fresh.length) {
    if (firstRun || fresh.length > 2) notifySummary(fresh, firstRun);
    else fresh.forEach(notifyGame);
  }

  if (settings.notifyLastDay) {
    for (const g of active) {
      if (!g.end || g.end <= now || g.end - now > DAY || !pending(g)) continue;
      if (stateFor(data.states, g).remindedEnd === g.end) continue;
      if (!fresh.includes(g)) notifyLastDay(g, now);
      patchState(data.states, g, { remindedEnd: g.end });
    }
  }
}

function claimButtons() {
  return [{ title: 'Récupérer' }, { title: "Je l'ai déjà" }];
}

function notifyGame(g) {
  chrome.notifications.create(`game|${g.key}`, {
    type: 'basic',
    iconUrl: ICON,
    title: `${g.cloud ? 'Inclus avec Prime sur Luna' : `Gratuit sur ${storeName(g)}`} : ${g.title}`,
    message: g.cloud
      ? 'À jouer en cloud (pas à garder)'
      : `${g.prime ? 'Avec Amazon Prime · ' : ''}${g.end ? `À garder à vie, jusqu'au ${formatDate(g.end)}` : 'À garder à vie, pour une durée limitée'}`,
    contextMessage: g.worth ? `Valeur : ${g.worth}` : 'FreeKeep<3',
    buttons: claimButtons(),
    priority: 1,
  });
}

function notifyLastDay(g, now) {
  chrome.notifications.create(`lastday|${g.key}`, {
    type: 'basic',
    iconUrl: ICON,
    title: `Dernier jour : ${g.title}`,
    message: `Encore gratuit sur ${storeName(g)} pendant ${formatDuration(g.end - now)} (jusqu'au ${formatDate(g.end)})`,
    contextMessage: g.worth ? `Valeur : ${g.worth}` : 'FreeKeep<3',
    buttons: claimButtons(),
    priority: 2,
  });
}

function notifySummary(list, firstRun) {
  const n = list.length;
  const lines = list.slice(0, 4).map((g) => `• ${g.title} (${storeName(g)})`);
  if (n > 4) lines.push(`+ ${n - 4} ${plural(n - 4, 'autre', 'autres')}`);
  chrome.notifications.create(`summary|${Date.now()}`, {
    type: 'basic',
    iconUrl: ICON,
    title: firstRun
      ? `FreeKeep<3 est prêt : ${n} ${plural(n, 'jeu', 'jeux')} à récupérer`
      : `${n} nouveaux jeux gratuits`,
    message: lines.join('\n'),
    priority: 1,
  });
}

// ---------- Bons plans ----------

const SECTION_LABEL = { pc: 'PC', switch: 'Switch', bundle: 'Bundle' };

function dealHeadline(d) {
  if (d.flags.priceError) return '⚠️ Erreur de prix ?';
  if (d.flags.wishlist) return '❤️ Liste de souhaits';
  if (d.flags.drop) return '📉 Chute de prix';
  if (d.flags.historicLow) return '🏆 Plus bas historique';
  if (d.flags.hot) return '🔥 Deal hot';
  return '💸 Grosse promo';
}

function dealLine(d) {
  const price = d.price != null ? formatPrice(d.price, d.currency) : '';
  const was = d.normalPrice ? ` au lieu de ${formatPrice(d.normalPrice, d.currency)}` : d.prevPrice ? ` (avant : ${formatPrice(d.prevPrice, d.currency)})` : '';
  const disc = d.discount ? ` (-${d.discount} %)` : '';
  return `${price}${was}${disc} chez ${d.merchant}`.trim();
}

function notifyDeals(deals, data, settings) {
  const seen = new Set(data.seenDeals);
  const first = !data.meta.dealsInitialized;
  const top = deals.filter((d) => d.exceptional && !data.dealStates[d.id]?.hidden)
    .filter((d) => settings.notifyDeals || (settings.notifyWishlist && d.flags.wishlist));
  const idsOf = (d) => d.ids || [d.id];
  const fresh = top.filter((d) => !idsOf(d).some((id) => seen.has(id)));
  top.forEach((d) => idsOf(d).forEach((id) => seen.add(id)));
  data.seenDeals = [...seen].slice(-1500);
  if (!fresh.length) return;

  if (first || fresh.length > 2) {
    const lines = fresh.slice(0, 4).map((d) => `• ${d.title} (${SECTION_LABEL[d.section]}) ${d.discount ? `-${d.discount} %` : formatPrice(d.price, d.currency)}`);
    if (fresh.length > 4) lines.push(`+ ${fresh.length - 4} autres`);
    chrome.notifications.create(`dealsummary|${fresh[0].section}|${Date.now()}`, {
      type: 'basic',
      iconUrl: ICON,
      title: `🔥 ${fresh.length} ${plural(fresh.length, 'affaire exceptionnelle', 'affaires exceptionnelles')}`,
      message: lines.join('\n'),
      priority: 1,
    });
    return;
  }
  for (const d of fresh) {
    chrome.notifications.create(`deal|${d.id}`, {
      type: 'basic',
      iconUrl: ICON,
      title: `${dealHeadline(d)} ${SECTION_LABEL[d.section]} : ${d.title}`,
      message: dealLine(d),
      contextMessage: d.end ? `Jusqu'au ${formatDate(d.end)}` : 'FreeKeep<3',
      priority: d.flags.priceError ? 2 : 1,
    });
  }
}

async function openDeal(id) {
  const { deals } = await getData();
  const d = deals.find((x) => x.id === id);
  if (d) chrome.tabs.create({ url: d.url });
}

async function openPopupOn(section) {
  await chrome.storage.session.set({ openSection: section });
  try {
    await chrome.action.openPopup();
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL(`popup/popup.html?tab=1&section=${section}`) });
  }
}

const splitId = (id) => {
  const i = id.indexOf('|');
  return i < 0 ? [id, null] : [id.slice(0, i), id.slice(i + 1)];
};

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const [kind, key] = splitId(id);
  if (key && (kind === 'game' || kind === 'lastday')) return openClaim(key);
  if (kind === 'deal') return openDeal(key);
  if (kind === 'dealsummary') return openPopupOn(key.split('|')[0]);
  return openPopupOn('free');
});

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  chrome.notifications.clear(id);
  const [, key] = splitId(id);
  if (!key) return;
  if (index === 0) await openClaim(key);
  else await setFlag(key, 'claimed', true);
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function updateBadge() {
  const [settings, { games, states }] = await Promise.all([getSettings(), getData()]);
  const now = Date.now();
  const w = wants(settings);
  const n = games.filter((g) => {
    // Luna (cloud) : rien à récupérer, donc pas compté dans le badge.
    if (!w.free || g.hiddenBy || g.cloud || g.status !== 'active' || !showsGame(g, w) || (g.end && g.end <= now)) return false;
    const s = stateFor(states, g);
    return !s.claimed && !s.hidden;
  }).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#04140a' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setTitle({
    title: n ? `FreeKeep<3 : ${n} ${plural(n, 'jeu gratuit', 'jeux gratuits')} à récupérer` : 'FreeKeep<3 : rien à récupérer',
  });
}

// ---------------------------------------------------------------------------
// Actions sur les jeux
// ---------------------------------------------------------------------------

const findGame = (games, key) => games.find((g) => g.key === key || g.keys?.includes(key)) || null;

function historyGame(states, key) {
  const s = states[key];
  if (!s?.snapshot) return null;
  return { ...s.snapshot, key, keys: keysForHistory(states, key) };
}

async function setFlag(key, flag, value) {
  const patch = { [flag]: value };
  if (flag === 'claimed') {
    patch.claimedAt = value ? Date.now() : null;
    patch.claimedVia = value ? 'manual' : null;
  }
  await updateData(({ games, states }) => {
    const g = findGame(games, key) || historyGame(states, key);
    if (!g) return null;
    patchState(states, g, patch);
    return { states };
  });
  await updateBadge();
}

async function openClaim(key, { active = true } = {}) {
  const { games, states } = await getData();
  const g = findGame(games, key);
  if (!g) return;
  const url = stateFor(states, g).resolvedUrl || g.url;
  const tab = await chrome.tabs.create({ url, active });
  await updateClaimTabs((tabs) => { tabs[tab.id] = { key: g.key, on: false }; });
}

async function openAll() {
  const [settings, { games, states }] = await Promise.all([getSettings(), getData()]);
  const now = Date.now();
  const todo = games.filter((g) => {
    if (g.hiddenBy || g.cloud || g.status !== 'active' || !showsGame(g, wants(settings)) || (g.end && g.end <= now)) return false;
    const s = stateFor(states, g);
    return !s.claimed && !s.hidden;
  });
  for (const [i, g] of todo.entries()) await openClaim(g.key, { active: i === 0 });
  return todo.length;
}

// ---------------------------------------------------------------------------
// Dialogue avec les pages des stores (content/claim.js)
// ---------------------------------------------------------------------------

async function claimHello(msg, sender) {
  const tabId = sender.tab?.id;
  const [settings, data, tabs] = await Promise.all([getSettings(), getData(), getClaimTabs()]);
  const claim = tabId != null ? tabs[tabId] : null;
  const claimed = claim ? findGame(data.games, claim.key) : null;
  // Onglet ouvert par « Récupérer » : on n'agit que sur la page de CE jeu (et l'étape qui la suit), jamais
  // sur un autre jeu visité ensuite dans le même onglet.
  let linked = false;
  if (claimed) {
    const step = isNextStep(msg.url);
    linked = !msg.top || step ? !!claim.on : isGamePage(claimed, stateFor(data.states, claimed), msg.url, msg.title);
    if (msg.top && !step && linked !== !!claim.on) await updateClaimTabs((t) => { if (t[tabId]) t[tabId].on = linked; });
  }
  const game = linked ? claimed : msg.top ? matchByUrl(data.games, (g) => stateFor(data.states, g), msg.url) : null;
  if (!game) return { linked: false, game: null };

  const s = stateFor(data.states, game);
  // Lien GamerPower -> on mémorise la vraie page du store pour la suite.
  if (linked && msg.top && isProductPage(msg.url) && !s.resolvedUrl && /gamerpower\.com/.test(game.url)) {
    const patch = { resolvedUrl: msg.url.split('#')[0] };
    const appid = steamApp(msg.url);
    if (appid) patch.appid = appid;
    await updateData(({ states }) => {
      patchState(states, game, patch);
      return { states };
    });
  }

  return {
    linked,
    autoClick: settings.autoClick,
    owned: !!s.claimed,
    game: { key: game.key, title: game.title, store: game.store },
  };
}

async function claimOwned(msg, sender) {
  let g = null;
  await updateData(({ games, states }) => {
    g = findGame(games, msg.key);
    if (!g || stateFor(states, g).claimed) return null;
    patchState(states, g, { claimed: true, claimedAt: Date.now(), claimedVia: 'page' });
    return { states };
  });
  if (!g) return { ok: false };
  await updateBadge();
  // Si la confirmation vient d'une iframe (checkout Epic), on prévient la page principale.
  if (sender.tab?.id != null && sender.frameId) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'freekeep:owned', title: g.title }, { frameId: 0 }).catch(() => {});
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Messages (popup, options, content script)
// ---------------------------------------------------------------------------

function libSummary(lib = {}) {
  return {
    input: lib.input || '', profileName: lib.profileName || '', count: lib.count || 0, at: lib.at || null,
    error: lib.error || null, wishlistCount: (lib.wishlist || []).length, wishlistError: lib.wishlistError || null,
  };
}

async function publicState() {
  const [settings, data] = await Promise.all([getSettings(), getData()]);
  return {
    settings, games: data.games, states: data.states, meta: data.meta, refreshing: !!(running || next), tutorialStarted: !!(await getDraft()), missing: await missingOrigins(settings),
    deals: data.deals, dealStates: data.dealStates, steamLib: libSummary(data.steamLib),
    gogLib: { username: data.gogLib?.username || '', count: data.gogLib?.count || 0, at: data.gogLib?.at || null, error: data.gogLib?.error || null },
  };
}

// Vérifie un lien de profil Steam sans rien enregistrer (tutoriel / réglages).
async function testSteamProfile(input, useSession) {
  try {
    await fetchSteamProfile(input); // lien invalide : erreur claire
    const lib = await fetchSteamLibrary({ input, useSession });
    return { ok: true, profileName: lib.profileName, count: lib.appids.length, ownedError: lib.error, wishlistCount: lib.wishlist ? lib.wishlist.length : null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Vérifie la session Steam du navigateur sans rien enregistrer.
async function testSteamSession() {
  try {
    const res = await fetchSteamSession();
    return { ok: true, count: res.appids.length, wishlistCount: res.wishlist.length };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ---------- Tutoriel : estimation et recommandations ----------

// Lit les sources qui manquent pour ces réglages (sans les enregistrer), une seule lecture à la fois.
async function prefetch(draft) {
  while (running || next) await (next?.promise || running).catch(() => {});
  current = { settings: null, force: [] };
  running = keepAlive((async () => {
    const data = await getData();
    await fetchDealSources(draft, data.dealCache, Date.now(), [], { wishlist: data.steamLib?.wishlist || [], denied: await deniedSources() });
    // Tags Steam des annonces trouvées : sans eux, le nombre de jeux par genre serait faux.
    const { deals } = assembleDeals({ ...draft, level: 'wide' }, data.dealCache, {}, Date.now());
    await enrichAppInfo(deals.map((d) => d.steamAppID), data.appInfo).catch((e) => console.warn('[FreeKeep] genres Steam :', e));
    await locked(() => saveData({ dealCache: data.dealCache, appInfo: data.appInfo }));
  })()).finally(() => { running = null; });
  await running;
}

async function estimate(rawDraft, fetchMissing) {
  const draft = { ...rawDraft };
  if (fetchMissing) await prefetch(effective(draft)).catch((e) => console.warn('[FreeKeep] estimation :', e));
  const data = await getData();
  const owned = makeOwnedIndex(data.steamLib, data.gogLib);
  const now = Date.now();
  const listFor = (level, filtered = true) => {
    const s = effective({ ...draft, level });
    return assembleDeals(s, data.dealCache, structuredClone(data.dealHistory), now).deals
      .filter((d) => !filtered || !hiddenReason(d, s, { appInfo: data.appInfo, owned }));
  };
  const counts = Object.fromEntries(Object.keys(LEVELS).map((l) => [l, listFor(l).length]));
  const level = LEVELS[draft.level] ? draft.level : 'balanced';
  const hits = filterHits(listFor(level, false), data.games, data.appInfo);
  return { counts, level, current: counts[level], recommended: recommendedLevel(counts), many: counts[level] > COMFORT, hits };
}

let tasteCache = null;
async function steamTaste() {
  if (tasteCache) return tasteCache;
  const data = await getData();
  let ids = data.steamLib?.appids || [];
  if (!ids.length) {
    try {
      ids = (await fetchSteamSession()).appids;
    } catch {
      return null;
    }
  }
  if (!ids.length) return null;
  // 400 fiches suffisent pour connaître les goûts (réparties sur toute la bibliothèque)
  const step = Math.max(1, Math.floor(ids.length / 400));
  const sample = ids.filter((_, i) => i % step === 0).slice(0, 400);
  const items = Object.values(await fetchSteamItems(sample, { reviews: false, tags: 8 })).filter((i) => i.game);
  tasteCache = tasteFrom(items);
  return tasteCache;
}

async function recommend(draft, hits) {
  const taste = draft.pc && draft.stores?.steam && draft.steamOwnedSync ? await steamTaste().catch(() => null) : null;
  return {
    total: taste?.total || 0,
    genres: genresToHide(taste, hits?.genres, draft.excludedGenres || []),
    franchises: rankFranchises(taste, hits?.keywords),
  };
}

async function handleMessage(msg, sender) {
  switch (msg?.type) {
    case 'getState':
      return publicState();
    case 'refresh':
      await refresh('manual', { force: msg.force || [] });
      return publicState();
    case 'setClaimed':
      await setFlag(msg.key, 'claimed', !!msg.claimed);
      return publicState();
    case 'setHidden':
      await setFlag(msg.key, 'hidden', !!msg.hidden);
      return publicState();
    case 'openClaim':
      await openClaim(msg.key);
      return { ok: true };
    case 'openAll':
      return { ok: true, opened: await openAll() };
    case 'setDealHidden':
      await updateData(({ dealStates }) => {
        if (msg.hidden) dealStates[msg.id] = { hidden: true, at: Date.now() };
        else delete dealStates[msg.id];
        return { dealStates };
      });
      return publicState();
    case 'testNotification': {
      const { games } = await getData();
      const sample = games.find((g) => g.status === 'active');
      if (sample) notifyGame(sample);
      else chrome.notifications.create(`test|${Date.now()}`, { type: 'basic', iconUrl: ICON, title: 'FreeKeep<3', message: 'Les notifications fonctionnent.' });
      return { ok: true };
    }
    case 'estimate':
      return estimate(msg.settings, !!msg.fetch);
    case 'recommend':
      return recommend(msg.settings, msg.hits);
    case 'testSteamProfile':
      return testSteamProfile(msg.input, msg.useSession !== false);
    case 'testSteamSession':
      return testSteamSession();
    case 'testGogSession':
      try {
        const res = await fetchGogLibrary();
        return { ok: true, count: res.games.length, username: res.username };
      } catch (e) {
        return { ok: false, error: gogError(e) };
      }
    case 'resetData':
      // Une vérification en cours réenregistrerait les anciennes données : on la laisse finir d'abord.
      while (running || next) await (next?.promise || running).catch(() => {});
      await locked(async () => {
        const { ggdealsKey } = await chrome.storage.local.get('ggdealsKey'); // un réglage, donc conservé
        await chrome.storage.local.clear();
        if (ggdealsKey) await chrome.storage.local.set({ ggdealsKey });
      });
      await refresh('reset');
      return publicState();
    case 'importStates':
      await updateData(({ states, dealStates }) => ({ states: mergeStates(states, msg.states || {}), dealStates: { ...msg.dealStates, ...dealStates } }));
      await updateBadge();
      return { ok: true };
    case 'claim:hello':
      return claimHello(msg, sender);
    case 'claim:owned':
      return claimOwned(msg, sender);
    default:
      return { error: 'message inconnu' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
  return true; // réponse asynchrone
});
