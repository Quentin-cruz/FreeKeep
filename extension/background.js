// FreeKeep — service worker (Manifest V3)
// Vérifie périodiquement les jeux gratuits et les bons plans, applique la personnalisation,
// gère notifications, badge et réclamation assistée.
import { STORES, ALARM_NAME } from './src/config.js';
import { fetchEpic } from './src/sources/epic.js';
import { fetchSteam } from './src/sources/steam.js';
import { fetchGamerPower } from './src/sources/gamerpower.js';
import { fetchSteamLibrary, fetchSteamProfile, fetchSteamSession, fetchSteamWishlist } from './src/sources/steamlibrary.js';
import { fetchGogLibrary } from './src/sources/goglibrary.js';
import { enrichAppInfo } from './src/sources/steamapps.js';
import { needsTags } from './src/genres.js';
import { mergeGames } from './src/merge.js';
import { refreshDeals } from './src/refresh-deals.js';
import { isExceptional, scoreDeal } from './src/deals.js';
import { effective, wants, hiddenReason, makeOwnedIndex, sameGameStrict, showsGame } from './src/prefs.js';
import {
  getSettings, getData, saveData, stateFor, patchState, keysForHistory, getClaimTabs, setClaimTabs,
} from './src/store.js';
import { formatDate, formatDuration, formatPrice } from './src/util.js';

const SOURCES = ['epic', 'steam', 'gamerpower']; // ordre de priorité pour la fusion
const CACHE_MAX_AGE = 3 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const ICON = 'icons/icon128.png';
const LIBRARY_MAX_AGE = 12 * 3600 * 1000;

const plural = (n, one, many) => (n > 1 ? many : one);
const storeName = (g) => STORES[g.store]?.short || g.store;

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
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
  const { meta } = await getData();
  if (!meta.lastRefresh || Date.now() - meta.lastRefresh > 60 * 60 * 1000) refresh('startup');
  else updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refresh('alarm');
});

// Réglages qui ne demandent qu'un nouveau tri (pas de nouveau téléchargement)
const CHEAP_SETTINGS = ['notifyNew', 'notifyLastDay', 'notifyDeals', 'notifyWishlist', 'autoClick', 'intervalHours', 'onboarded'];
// Réglages qui changent ce qu'on demande aux API
const REFETCH_SETTINGS = ['pc', 'switch', 'switch2', 'stores', 'level', 'pcMinDiscount', 'gemMinDiscount', 'gemMinRating', 'switchMinDiscount', 'ggdealsKey', 'keyshops', 'pcDeals', 'switchDeals'];
const LIBRARY_SETTINGS = ['steamProfile', 'steamOwnedSync', 'useWishlist'];
const GOG_SETTINGS = ['gogSessionSync'];

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const before = changes.settings.oldValue || {};
  const after = changes.settings.newValue || {};
  const changed = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.includes('intervalHours')) scheduleAlarm();
  if (!changed.length || changed.every((k) => CHEAP_SETTINGS.includes(k))) {
    updateBadge();
    return;
  }
  const force = new Set();
  if (changed.some((k) => REFETCH_SETTINGS.includes(k))) ['cheapshark', 'eshop', 'ggdeals'].forEach((f) => force.add(f));
  if (changed.some((k) => LIBRARY_SETTINGS.includes(k))) ['steamlib', 'cheapshark'].forEach((f) => force.add(f));
  if (changed.some((k) => GOG_SETTINGS.includes(k))) force.add('goglib');
  settingsRefresh([...force]);
});

// Les réglages changent souvent en rafale : on attend 1,5 s avant de recharger.
let settingsTimer = null;
let pendingForce = new Set();
function settingsRefresh(force = []) {
  force.forEach((f) => pendingForce.add(f));
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    const f = [...pendingForce];
    pendingForce = new Set();
    refresh('settings', { force: f });
  }, 1500);
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabs = await getClaimTabs();
  if (tabs[tabId]) {
    delete tabs[tabId];
    await setClaimTabs(tabs);
  }
});

async function scheduleAlarm() {
  const { intervalHours } = await getSettings();
  const period = Math.max(0.5, Number(intervalHours) || 1) * 60;
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: period, periodInMinutes: period });
  }
}

// ---------------------------------------------------------------------------
// Rafraîchissement des sources
// ---------------------------------------------------------------------------

let running = null;

function refresh(reason = 'manual', opts = {}) {
  if (!running) running = doRefresh(reason, opts).finally(() => { running = null; });
  return running;
}

async function doRefresh(reason, { force = [] } = {}) {
  const settings = effective(await getSettings());
  const w = wants(settings);
  const data = await getData();
  const enabled = w.free ? w.stores : [];
  const now = Date.now();

  // ---- 1. Jeux gratuits ----
  const jobs = {
    epic: enabled.includes('epic') ? () => fetchEpic(now) : null,
    steam: enabled.includes('steam') ? () => fetchSteam() : null,
    gamerpower: enabled.length ? () => fetchGamerPower(enabled, now, { prime: w.prime }) : null,
  };
  const errors = {};
  await Promise.all(
    SOURCES.map(async (name) => {
      if (!jobs[name]) return;
      try {
        data.cache[name] = { items: await jobs[name](), at: Date.now() };
      } catch (e) {
        errors[name] = String(e?.message || e);
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
  if (libChanged && !force.includes('cheapshark')) force = [...force, 'cheapshark'];
  if (data.steamLib?.at) {
    sourceStatus.steamlib = data.steamLib.error
      ? { ok: false, error: data.steamLib.error, at: data.steamLib.at }
      : { ok: true, count: data.steamLib.count || 0, at: data.steamLib.at };
  }
  await syncGogLibrary(settings, data, now, force.includes('goglib'));
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
  try {
    ({ deals, freebies, errors: dealErrors, status: dealStatus } = await refreshDeals(settings, data.dealCache, data.dealHistory, now, force, { wishlist }));
  } catch (e) {
    dealErrors = { bons_plans: String(e?.message || e) };
    console.warn('[FreeKeep] bons plans :', e);
  }

  // Fusion des jeux gratuits. Si une source échoue, on réutilise son dernier résultat (s'il a moins de 3 jours).
  // Les jeux offerts repérés sur Dealabs (Prime, Microsoft Store, Battle.net…) passent en dernier.
  const keep = (i) => enabled.includes(i.store) && (!i.prime || w.prime);
  const lists = SOURCES
    .filter((n) => jobs[n] && data.cache[n] && now - data.cache[n].at < CACHE_MAX_AGE)
    .map((n) => data.cache[n].items.filter(keep));
  lists.push((freebies || []).filter(keep));
  const games = mergeGames(lists, now);

  // ---- 4. Genres (seulement si l'utilisateur en exclut) ----
  if ((settings.excludedGenres || []).length) {
    const appids = [...games.map((g) => g.appid), ...deals.map((d) => d.steamAppID)].filter(Boolean);
    try {
      await enrichAppInfo(appids, data.appInfo, { withTags: needsTags(settings.excludedGenres), now });
    } catch (e) {
      console.warn('[FreeKeep] genres Steam :', e);
    }
  }

  // ---- 5. Personnalisation ----
  for (const g of games) {
    g.hiddenBy = hiddenReason({ title: g.title, steamAppID: g.appid }, settings, { appInfo: data.appInfo, isGame: true });
  }
  deals = deals.map((d) => {
    const flags = { ...d.flags, wishlist: d.flags?.wishlist || (!!d.steamAppID && wishSet.has(String(d.steamAppID))) };
    const out = { ...d, flags };
    out.hiddenBy = hiddenReason(out, settings, { appInfo: data.appInfo, owned });
    out.exceptional = isExceptional(out);
    out.score = scoreDeal(out);
    return out;
  }).sort((a, b) => b.score - a.score);

  await syncSteamOwned(games, data.states, settings, data.steamLib);
  syncGogOwned(games, data.states, owned);

  // ---- 6. Notifications (pas pendant le tutoriel) ----
  const visibleGames = games.filter((g) => !g.hiddenBy);
  const visibleDeals = deals.filter((d) => !d.hiddenBy);
  if (settings.onboarded) {
    notifyChanges(visibleGames, data, settings, now);
    notifyDeals(visibleDeals, data, settings);
  } else {
    // On mémorise ce qui existe déjà pour ne pas tout notifier après le tutoriel.
    const seen = new Set(data.seen);
    games.forEach((g) => g.keys.forEach((k) => seen.add(k)));
    data.seen = [...seen].slice(-800);
    data.seenDeals = [...new Set([...data.seenDeals, ...deals.filter((d) => d.exceptional).map((d) => d.id)])].slice(-1500);
  }
  for (const [id, st] of Object.entries(data.dealStates)) if (now - (st.at || 0) > 60 * DAY) delete data.dealStates[id];

  data.meta = {
    ...data.meta, lastRefresh: now, lastReason: reason, errors, dealErrors, initialized: true, dealsInitialized: true,
    sources: { ...sourceStatus, ...dealStatus },
  };
  await saveData({
    games, states: data.states, meta: data.meta, cache: data.cache, seen: data.seen,
    deals, dealCache: data.dealCache, dealHistory: data.dealHistory, dealStates: data.dealStates, seenDeals: data.seenDeals,
    steamLib: data.steamLib, gogLib: data.gogLib, appInfo: data.appInfo,
  });
  await updateBadge();
  return { ok: true, errors, dealErrors };
}

// Bibliothèque GOG via la session gog.com du navigateur (aucun identifiant stocké).
const gogError = (e) => {
  const m = String(e?.message || e);
  return /HTTP 40[13]|JSON|Unexpected token|pas connecté/i.test(m) ? 'pas connecté à gog.com dans ce navigateur' : m;
};

async function syncGogLibrary(settings, data, now, force) {
  const lib = data.gogLib || {};
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

// Jeux gratuits Steam déjà possédés : via la bibliothèque publique et/ou la session Steam du navigateur.
async function syncSteamOwned(games, states, settings, lib) {
  const candidates = games.filter((g) => g.store === 'steam' && !stateFor(states, g).claimed);
  if (!candidates.length) return;
  const libIds = new Set((lib?.appids || []).map(String));
  let sessionIds = new Set();
  if (settings.steamOwnedSync && candidates.some((g) => g.appid || stateFor(states, g).appid)) {
    try {
      sessionIds = new Set((await fetchSteamSession()).appids);
    } catch (e) {
      console.warn('[FreeKeep] lecture des jeux Steam possédés impossible :', e);
    }
  }
  for (const g of candidates) {
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

const SECTION_LABEL = { pc: 'PC', switch: 'Switch' };

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
  const fresh = top.filter((d) => !seen.has(d.id));
  top.forEach((d) => seen.add(d.id));
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
  const { games, states } = await getData();
  const g = findGame(games, key) || historyGame(states, key);
  if (!g) return;
  const patch = { [flag]: value };
  if (flag === 'claimed') {
    patch.claimedAt = value ? Date.now() : null;
    patch.claimedVia = value ? 'manual' : null;
  }
  patchState(states, g, patch);
  await saveData({ states });
  await updateBadge();
}

async function openClaim(key, { active = true } = {}) {
  const { games, states } = await getData();
  const g = findGame(games, key);
  if (!g) return;
  const url = stateFor(states, g).resolvedUrl || g.url;
  const tab = await chrome.tabs.create({ url, active });
  const tabs = await getClaimTabs();
  tabs[tab.id] = g.key;
  await setClaimTabs(tabs);
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

const PRODUCT_PAGE = [
  /^https:\/\/store\.epicgames\.com\/[^/]+\/(?:p|bundles)\/[^/?#]+/,
  /^https:\/\/store\.steampowered\.com\/app\/\d+/,
  /^https:\/\/www\.gog\.com\/(?:[a-z]{2}\/)?game\/[^/?#]+/,
  /^https:\/\/store\.ubisoft\.com\/.+\.html/,
  /^https:\/\/register\.ubisoft\.com\/[^/?#]+/,
];
const isProductPage = (url) => PRODUCT_PAGE.some((re) => re.test(url || ''));

const cleanUrl = (u) =>
  String(u || '').split(/[?#]/)[0].replace(/\/$/, '').replace(/\/(?:fr|en|en-us|fr-fr|fr-FR|en-US)(?=\/)/, '');

function matchByUrl(games, states, url) {
  if (!url) return null;
  const epicSlug = /store\.epicgames\.com\/[^/]+\/(?:p|bundles)\/([^/?#]+)/.exec(url)?.[1];
  const appid = /store\.steampowered\.com\/app\/(\d+)/.exec(url)?.[1];
  return (
    games.find((g) => {
      const s = stateFor(states, g);
      if (epicSlug) return g.store === 'epic' && (g.slug === epicSlug || cleanUrl(s.resolvedUrl).endsWith(`/${epicSlug}`));
      if (appid) return g.store === 'steam' && String(g.appid || s.appid) === appid;
      return !!s.resolvedUrl && cleanUrl(s.resolvedUrl) === cleanUrl(url);
    }) || null
  );
}

async function claimHello(msg, sender) {
  const tabId = sender.tab?.id;
  const [settings, data, tabs] = await Promise.all([getSettings(), getData(), getClaimTabs()]);
  const linkedKey = tabId != null ? tabs[tabId] : null;
  const game = linkedKey ? findGame(data.games, linkedKey) : matchByUrl(data.games, data.states, msg.url);
  if (!game) return { linked: false, game: null };

  const s = stateFor(data.states, game);
  // Lien GamerPower -> on mémorise la vraie page du store pour la suite.
  if (linkedKey && msg.top && isProductPage(msg.url) && !s.resolvedUrl && /gamerpower\.com/.test(game.url)) {
    const patch = { resolvedUrl: msg.url.split('#')[0] };
    const appid = /store\.steampowered\.com\/app\/(\d+)/.exec(msg.url)?.[1];
    if (appid) patch.appid = appid;
    patchState(data.states, game, patch);
    await saveData({ states: data.states });
  }

  return {
    linked: !!linkedKey,
    autoClick: settings.autoClick,
    owned: !!s.claimed,
    game: { key: game.key, title: game.title, store: game.store },
  };
}

async function claimOwned(msg, sender) {
  const data = await getData();
  const g = findGame(data.games, msg.key);
  if (!g) return { ok: false };
  if (!stateFor(data.states, g).claimed) {
    patchState(data.states, g, { claimed: true, claimedAt: Date.now(), claimedVia: 'page' });
    await saveData({ states: data.states });
    await updateBadge();
  }
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
    settings, games: data.games, states: data.states, meta: data.meta, refreshing: !!running,
    deals: data.deals, dealStates: data.dealStates, steamLib: libSummary(data.steamLib),
    gogLib: { username: data.gogLib?.username || '', count: data.gogLib?.count || 0, at: data.gogLib?.at || null, error: data.gogLib?.error || null },
  };
}

// Vérifie un lien de profil Steam sans rien enregistrer (tutoriel / réglages).
async function testSteamProfile(input) {
  try {
    const res = await fetchSteamProfile(input);
    let wishlistCount = null;
    try {
      wishlistCount = (await fetchSteamWishlist(res.steamID64)).length;
    } catch { /* liste de souhaits privée ou indisponible */ }
    return { ok: true, profileName: res.profileName, wishlistCount };
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
    case 'setDealHidden': {
      const { dealStates } = await getData();
      if (msg.hidden) dealStates[msg.id] = { hidden: true, at: Date.now() };
      else delete dealStates[msg.id];
      await saveData({ dealStates });
      return publicState();
    }
    case 'testNotification': {
      const { games } = await getData();
      const sample = games.find((g) => g.status === 'active');
      if (sample) notifyGame(sample);
      else chrome.notifications.create(`test|${Date.now()}`, { type: 'basic', iconUrl: ICON, title: 'FreeKeep<3', message: 'Les notifications fonctionnent.' });
      return { ok: true };
    }
    case 'testSteamProfile':
      return testSteamProfile(msg.input);
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
      await chrome.storage.local.clear();
      await refresh('reset');
      return publicState();
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
