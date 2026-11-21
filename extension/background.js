// FreeKeep — service worker (Manifest V3)
// Vérifie périodiquement les jeux gratuits, gère notifications, badge et réclamation assistée.
import { STORES, STORE_ORDER, ALARM_NAME } from './src/config.js';
import { fetchEpic } from './src/sources/epic.js';
import { fetchSteam, fetchSteamOwned } from './src/sources/steam.js';
import { fetchGamerPower } from './src/sources/gamerpower.js';
import { mergeGames } from './src/merge.js';
import { refreshDeals } from './src/refresh-deals.js';
import {
  getSettings, getData, saveData, stateFor, patchState, keysForHistory, getClaimTabs, setClaimTabs,
} from './src/store.js';
import { formatDate, formatDuration, formatPrice } from './src/util.js';

const SOURCES = ['epic', 'steam', 'gamerpower']; // ordre de priorité pour la fusion
const CACHE_MAX_AGE = 3 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const ICON = 'icons/icon128.png';

const plural = (n, one, many) => (n > 1 ? many : one);
const storeName = (g) => STORES[g.store]?.short || g.store;

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await scheduleAlarm();
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

const DEAL_SETTINGS = [
  'pcDeals', 'pcMinDiscount', 'gemMinDiscount', 'gemMinRating', 'ggdealsKey', 'switchDeals', 'switchMinDiscount',
  'dealabs', 'dealabsOnlyHot', 'departments', 'dealMaxAgeDays',
];

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const before = changes.settings.oldValue || {};
  const after = changes.settings.newValue || {};
  if (before.intervalHours !== after.intervalHours) scheduleAlarm();
  const dealsChanged = DEAL_SETTINGS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (dealsChanged) settingsRefresh();
  else if (JSON.stringify(before.stores) !== JSON.stringify(after.stores)) refresh('settings');
  else updateBadge();
});

// Les réglages changent souvent en rafale (curseurs) : on attend 1,5 s avant de recharger.
let settingsTimer = null;
function settingsRefresh() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => refresh('settings', { force: ['cheapshark', 'eshop', 'ggdeals'] }), 1500);
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
  const settings = await getSettings();
  const data = await getData();
  const enabled = STORE_ORDER.filter((s) => settings.stores[s]);
  const now = Date.now();

  const jobs = {
    epic: enabled.includes('epic') ? () => fetchEpic(now) : null,
    steam: enabled.includes('steam') ? () => fetchSteam() : null,
    gamerpower: enabled.length ? () => fetchGamerPower(enabled, now) : null,
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

  // Si une source échoue, on réutilise son dernier résultat (s'il a moins de 3 jours).
  const sourceStatus = {};
  for (const name of SOURCES) {
    if (!jobs[name]) continue;
    sourceStatus[name] = errors[name]
      ? { ok: false, error: errors[name], at: data.cache[name]?.at || null }
      : { ok: true, count: data.cache[name]?.items?.length ?? 0, at: data.cache[name]?.at || null };
  }

  const lists = SOURCES
    .filter((n) => jobs[n] && data.cache[n] && now - data.cache[n].at < CACHE_MAX_AGE)
    .map((n) => data.cache[n].items.filter((i) => enabled.includes(i.store)));
  const games = mergeGames(lists, now);

  if (settings.steamOwnedSync) await syncSteamOwned(games, data.states);
  notifyChanges(games, data, settings, now);

  // Bons plans PC + Switch
  let deals = data.deals;
  let dealErrors = {};
  let dealStatus = {};
  try {
    ({ deals, errors: dealErrors, status: dealStatus } = await refreshDeals(settings, data.dealCache, data.dealHistory, now, force));
    notifyDeals(deals, data, settings);
  } catch (e) {
    dealErrors = { bons_plans: String(e?.message || e) };
    console.warn('[FreeKeep] bons plans :', e);
  }
  for (const [id, st] of Object.entries(data.dealStates)) if (now - (st.at || 0) > 60 * DAY) delete data.dealStates[id];

  data.meta = {
    ...data.meta, lastRefresh: now, lastReason: reason, errors, dealErrors, initialized: true, dealsInitialized: true,
    sources: { ...sourceStatus, ...dealStatus },
  };
  await saveData({
    games, states: data.states, meta: data.meta, cache: data.cache, seen: data.seen,
    deals, dealCache: data.dealCache, dealHistory: data.dealHistory, dealStates: data.dealStates, seenDeals: data.seenDeals,
  });
  await updateBadge();
  return { ok: true, errors, dealErrors };
}

async function syncSteamOwned(games, states) {
  const candidates = games.filter((g) => {
    if (g.store !== 'steam') return false;
    const s = stateFor(states, g);
    return !s.claimed && (g.appid || s.appid);
  });
  if (!candidates.length) return;
  try {
    const owned = await fetchSteamOwned();
    for (const g of candidates) {
      const appid = String(g.appid || stateFor(states, g).appid);
      if (owned.has(appid)) patchState(states, g, { claimed: true, claimedAt: Date.now(), claimedVia: 'steam' });
    }
  } catch (e) {
    console.warn('[FreeKeep] lecture des jeux Steam possédés impossible :', e);
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
    title: `Gratuit sur ${storeName(g)} : ${g.title}`,
    message: g.end ? `À garder à vie, jusqu'au ${formatDate(g.end)}` : 'À garder à vie, pour une durée limitée',
    contextMessage: g.worth ? `Valeur : ${g.worth}` : 'FreeKeep',
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
    contextMessage: g.worth ? `Valeur : ${g.worth}` : 'FreeKeep',
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
      ? `FreeKeep est prêt : ${n} ${plural(n, 'jeu', 'jeux')} à récupérer`
      : `${n} nouveaux jeux gratuits`,
    message: lines.join('\n'),
    priority: 1,
  });
}

// ---------- Bons plans ----------

const SECTION_LABEL = { pc: 'PC', switch: 'Switch' };

function dealHeadline(d) {
  if (d.flags.priceError) return '⚠️ Erreur de prix ?';
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
  const top = deals.filter((d) => d.exceptional && !data.dealStates[d.id]?.hidden);
  const fresh = top.filter((d) => !seen.has(d.id));
  top.forEach((d) => seen.add(d.id));
  data.seenDeals = [...seen].slice(-1500);
  if (!settings.notifyDeals || !fresh.length) return;

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
      contextMessage: d.end ? `Jusqu'au ${formatDate(d.end)}` : 'FreeKeep',
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
  const n = games.filter((g) => {
    if (g.status !== 'active' || !settings.stores[g.store] || (g.end && g.end <= now)) return false;
    const s = stateFor(states, g);
    return !s.claimed && !s.hidden;
  }).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#04140a' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setTitle({
    title: n ? `FreeKeep : ${n} ${plural(n, 'jeu gratuit', 'jeux gratuits')} à récupérer` : 'FreeKeep : rien à récupérer',
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
    if (g.status !== 'active' || !settings.stores[g.store] || (g.end && g.end <= now)) return false;
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

async function publicState() {
  const [settings, data] = await Promise.all([getSettings(), getData()]);
  return {
    settings, games: data.games, states: data.states, meta: data.meta, refreshing: !!running,
    deals: data.deals, dealStates: data.dealStates,
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
      else chrome.notifications.create(`test|${Date.now()}`, { type: 'basic', iconUrl: ICON, title: 'FreeKeep', message: 'Les notifications fonctionnent.' });
      return { ok: true };
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
