// FreeKeep — popup : 3 sections (Gratuits, Promos PC, Switch)
import { STORES, CHANNELS, SWITCH_PLATFORMS, STALE_AFTER_MS } from '../src/config.js';
import { stateFor } from '../src/store.js';
import { wants, showsGame } from '../src/prefs.js';
import { GENRE_BY_ID } from '../src/genres.js';
import { normTitle, formatDuration, formatDate, formatShortDate, formatAgo, formatPrice } from '../src/util.js';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);

let S = null; // état renvoyé par le service worker
const ui = { section: 'free', tab: 'active', filter: 'all', showHidden: false, showFiltered: false, refreshing: false };

const params = new URLSearchParams(location.search);
if (params.has('tab')) document.body.classList.add('in-tab');
try {
  ui.section = params.get('section') || localStorage.getItem('fk:section') || 'free';
} catch { /* stockage indisponible : section par défaut */ }

// ---------- Mini helper DOM ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const ICON_HIDE = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.innerHTML = '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9.9 4.2A9.6 9.6 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-2.2 3.3M6.6 6.6C3.6 8.5 2 12 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6M14.1 14.1A3 3 0 0 1 9.9 9.9M2 2l20 20"/>';
  return svg;
};

// ---------- Données dérivées ----------
function deriveFree() {
  const now = Date.now();
  const { settings, games, states } = S;
  const rows = games
    .filter((g) => showsGame(g, wants(settings)) && (!g.end || g.end > now))
    .map((g) => ({ g, s: stateFor(states, g) }));

  const filtered = rows.filter((r) => r.g.hiddenBy && r.g.status === 'active' && !r.s.claimed);
  const active = rows.filter((r) => r.g.status === 'active' && !r.s.claimed && !r.g.hiddenBy);
  const seen = new Set();
  const claimed = Object.entries(states)
    .filter(([, s]) => s.claimed && s.snapshot)
    .sort(([, a], [, b]) => (b.claimedAt || 0) - (a.claimedAt || 0))
    .filter(([, s]) => {
      const id = `${s.snapshot.store}:${normTitle(s.snapshot.title)}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(([key, s]) => ({ key, s }));

  return {
    available: active.filter((r) => !r.s.hidden),
    hidden: active.filter((r) => r.s.hidden),
    upcoming: wants(settings).upcoming ? rows.filter((r) => r.g.status === 'upcoming' && !r.g.hiddenBy) : [],
    claimed,
    filtered,
  };
}

function deriveDeals(section) {
  const now = Date.now();
  const all = (S.deals || []).filter((d) => d.section === section && (!d.end || d.end > now));
  const hiddenIds = S.dealStates || {};
  return {
    visible: all.filter((d) => !hiddenIds[d.id]?.hidden && !d.hiddenBy),
    hidden: all.filter((d) => hiddenIds[d.id]?.hidden && !d.hiddenBy),
    filtered: all.filter((d) => d.hiddenBy),
  };
}

const storeOf = (item) => item.g?.store || item.s?.snapshot?.store;

// ---------- Rendu ----------
function render() {
  if (!S) return;
  const free = deriveFree();
  const pc = deriveDeals('pc');
  const sw = deriveDeals('switch');

  // Sections selon la personnalisation
  const w = wants(S.settings);
  if (!w.sections.includes(ui.section) && w.sections.length) ui.section = w.sections[0];
  $('.sections').hidden = w.sections.length < 2;
  document.querySelectorAll('.section').forEach((b) => { b.hidden = !w.sections.includes(b.dataset.section); });
  $('#onboard').hidden = !!S.settings.onboarded;

  // Sélecteur de section
  const counts = { free: free.available.length, pc: pc.visible.length, switch: sw.visible.length };
  const hot = { pc: pc.visible.some((d) => d.exceptional), switch: sw.visible.some((d) => d.exceptional) };
  document.querySelectorAll('.section').forEach((b) => {
    const id = b.dataset.section;
    b.classList.toggle('active', id === ui.section);
    const c = b.querySelector('.count');
    c.textContent = counts[id];
    c.classList.toggle('hot', !!hot[id]);
  });

  const n = free.available.length;
  const nHot = [...pc.visible, ...sw.visible].filter((d) => d.exceptional).length;
  $('#subtitle').textContent = !S.meta.lastRefresh
    ? 'Première vérification…'
    : [n ? `${n} ${n > 1 ? 'jeux gratuits' : 'jeu gratuit'}` : null, nHot ? `${nHot} ${nHot > 1 ? 'affaires' : 'affaire'} 🔥` : null]
      .filter(Boolean).join(' · ') || 'Tout est à jour';

  $('#free-tabs').hidden = ui.section !== 'free' || !w.sections.length;
  renderBanner();

  const list = $('#list');
  list.replaceChildren();
  if (!w.sections.length) {
    $('#filters').replaceChildren();
    list.append(empty('🧭', 'Rien d’activé pour l’instant', h('button', { class: 'link-btn', onclick: () => chrome.runtime.openOptionsPage() }, 'Choisir ce que je veux voir')));
  } else if (ui.section === 'free') renderFree(list, free);
  else renderDeals(list, ui.section === 'pc' ? pc : sw, ui.section);

  const sources = {
    free: ['Epic, Steam, ', h('a', { href: 'https://www.gamerpower.com', target: '_blank' }, 'GamerPower'), S.settings.dealabs ? ', Dealabs' : ''],
    pc: ['Prix : ', h('a', { href: 'https://www.cheapshark.com', target: '_blank' }, 'CheapShark'), ', Dealabs', S.settings.ggdealsKey ? [', ', h('a', { href: 'https://gg.deals', target: '_blank' }, 'GG.deals')] : ''],
    switch: ['Prix : eShop Nintendo, ', h('a', { href: 'https://www.dealabs.com', target: '_blank' }, 'Dealabs')],
  }[ui.section];
  $('.sources').replaceChildren('Données : ', ...sources.flat());

  $('#last-check').textContent = S.meta.lastRefresh ? `Vérifié ${formatAgo(S.meta.lastRefresh)}` : '';
  $('#btn-refresh').classList.toggle('spinning', ui.refreshing || S.refreshing);
}

function renderBanner() {
  const box = $('#banner');
  box.replaceChildren();
  const names = {
    epic: 'Epic Games', steam: 'Steam', gamerpower: 'GamerPower', cheapshark: 'CheapShark', eshop: 'eShop Nintendo',
    dealabs: 'Dealabs', ggdeals: 'GG.deals', watchlist: 'CheapShark', bons_plans: 'bons plans',
  };
  const relevant = {
    free: ['epic', 'steam', 'gamerpower'],
    pc: ['cheapshark', 'dealabs', 'ggdeals', 'watchlist', 'bons_plans'],
    switch: ['eshop', 'dealabs', 'bons_plans'],
  }[ui.section];
  const all = { ...(S.meta.errors || {}), ...(S.meta.dealErrors || {}) };
  const errors = Object.entries(all).filter(([k]) => relevant.includes(k));
  if (!errors.length) return;
  const txt = errors.map(([k, v]) => `${names[k] || k} (${v})`).join(', ');
  box.append(h('div', { class: 'banner' }, `⚠ Source indisponible : ${txt}. Les dernières données connues sont affichées.`));
}

// ---------- Section « Gratuits » ----------
function renderFree(list, d) {
  for (const [tab, rows] of [['active', d.available], ['upcoming', d.upcoming], ['claimed', d.claimed]]) {
    document.querySelector(`[data-count="${tab}"]`).textContent = rows.length;
  }
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === ui.tab));
  $('.tab[data-tab="upcoming"]').hidden = !wants(S.settings).upcoming;

  if (ui.tab === 'upcoming' && !wants(S.settings).upcoming) ui.tab = 'active';
  const current = ui.tab === 'active' ? d.available : ui.tab === 'upcoming' ? d.upcoming : d.claimed;
  const stores = wants(S.settings).stores;
  renderChips(
    current,
    stores.map((s) => ({ id: s, label: STORES[s].short, color: STORES[s].color })),
    (r, id) => storeOf(r) === id,
    stores.length >= 2,
  );
  const filtered = current.filter((r) => ui.filter === 'all' || storeOf(r) === ui.filter);

  if (!S.meta.lastRefresh && !S.games.length) {
    list.append(...[0, 1, 2].map(() => h('div', { class: 'skeleton' })));
  } else if (ui.tab === 'active') {
    renderAvailable(list, filtered, d.hidden.filter((r) => ui.filter === 'all' || r.g.store === ui.filter));
    filteredToggle(list, d.filtered.length, () => d.filtered.forEach((r) => list.append(gameCard(r, 'filtered'))));
  } else if (ui.tab === 'upcoming') {
    if (!filtered.length) list.append(empty('🗓️', 'Rien d’annoncé pour l’instant', 'Epic dévoile ses prochains jeux offerts chaque jeudi.'));
    filtered.forEach((r) => list.append(gameCard(r, 'upcoming')));
  } else {
    if (!filtered.length) list.append(empty('📦', 'Aucun jeu récupéré pour l’instant', 'Clique sur « Je l’ai » ou récupère un jeu : il apparaîtra ici.'));
    filtered.forEach((r) => list.append(claimedRow(r)));
  }
}

function renderAvailable(list, rows, hidden) {
  if (rows.length >= 2) {
    list.append(
      h('div', { class: 'list-actions' },
        h('span', {}, 'Ouvre chaque page et lance la récupération'),
        h('button', { class: 'btn mini primary', onclick: openAll }, `Tout récupérer (${rows.length})`),
      ),
    );
  }
  if (!rows.length) {
    list.append(
      hidden.length
        ? empty('🙈', 'Tous les jeux restants sont masqués', '')
        : empty('🎮', 'Rien à récupérer pour l’instant', `FreeKeep<3 vérifie toutes les ${S.settings.intervalHours < 1 ? `${Math.round(S.settings.intervalHours * 60)} min` : `${S.settings.intervalHours} h`} et te prévient dès qu’un jeu passe gratuit.`),
    );
  }
  rows.forEach((r) => list.append(gameCard(r, 'active')));
  hiddenToggle(list, hidden.length, () => hidden.forEach((r) => list.append(gameCard(r, 'hidden'))));
}

// ---------- Sections « Promos PC » et « Switch » ----------
const DEAL_FILTERS = {
  pc: [
    { id: 'top', label: '🔥 Top', test: (d) => d.exceptional },
    { id: 'wishlist', label: '❤️ Souhaits', test: (d) => !!d.flags?.wishlist },
    { id: 'official', label: 'Officiel', color: CHANNELS.official.color, test: (d) => d.channel === 'official' },
    { id: 'keyshop', label: 'Clés', color: CHANNELS.keyshop.color, test: (d) => d.channel === 'keyshop' || !!d.keyshop },
    { id: 'bundle', label: 'Bundles', color: CHANNELS.bundle.color, test: (d) => d.channel === 'bundle' },
  ],
  switch: [
    { id: 'top', label: '🔥 Top', test: (d) => d.exceptional },
    { id: 'switch1', label: 'Switch', color: SWITCH_PLATFORMS.switch1.color, test: (d) => d.platform !== 'switch2', onlyIf: () => S.settings.switch2 },
    { id: 'switch2', label: 'Switch 2', color: SWITCH_PLATFORMS.switch2.color, test: (d) => d.platform === 'switch2', onlyIf: () => S.settings.switch2 },
    { id: 'eshop', label: 'eShop', color: CHANNELS.eshop.color, test: (d) => d.channel === 'eshop' },
    { id: 'physical', label: 'Physique', color: CHANNELS.physical.color, test: (d) => d.channel === 'physical' },
    { id: 'keyshop', label: 'Clés', color: CHANNELS.keyshop.color, test: (d) => d.channel === 'keyshop' },
  ],
};

function renderDeals(list, { visible, hidden, filtered }, section) {
  const filters = DEAL_FILTERS[section].filter((f) => !f.onlyIf || f.onlyIf());
  renderChips(visible, filters, (d, id) => filters.find((f) => f.id === id).test(d), true);
  const active = filters.find((f) => f.id === ui.filter);
  const rows = active ? visible.filter(active.test) : visible;

  const enabled = section === 'pc' ? S.settings.pcDeals : S.settings.switchDeals;
  if (!enabled) {
    list.append(empty('💤', 'Section désactivée', h('button', { class: 'link-btn', onclick: () => chrome.runtime.openOptionsPage() }, 'L’activer dans les réglages')));
    return;
  }
  if (!S.meta.dealsInitialized && !S.deals?.length) {
    list.append(...[0, 1, 2].map(() => h('div', { class: 'skeleton' })));
    return;
  }
  if (!rows.length) {
    list.append(
      section === 'pc'
        ? empty('🔎', 'Aucune pépite pour l’instant', 'Seuls les gros jeux et les jeux très bien notés à grosse remise sont gardés. Les seuils se règlent dans les réglages.')
        : empty('🔎', 'Aucune grosse promo Switch', 'FreeKeep<3 écarte les petits jeux bradés : seuls les jeux populaires, les gros jeux et les jeux Nintendo sont gardés.'),
    );
  }
  rows.forEach((d) => list.append(dealCard(d, false)));
  hiddenToggle(list, hidden.length, () => hidden.forEach((d) => list.append(dealCard(d, true))));
  filteredToggle(list, filtered.length, () => filtered.forEach((d) => list.append(dealCard(d, true))));
}

function priceBlock(d) {
  if (d.price == null) return null;
  return h('div', { class: 'price-row' },
    h('strong', { class: `price${d.price === 0 ? ' free' : ''}` }, formatPrice(d.price, d.currency)),
    d.normalPrice && d.normalPrice > d.price ? h('s', {}, formatPrice(d.normalPrice, d.currency)) : null,
    d.prevPrice && !d.normalPrice ? h('s', { title: 'Prix à la vérification précédente' }, formatPrice(d.prevPrice, d.currency)) : null,
    h('span', { class: 'merchant' }, d.merchant),
  );
}

function pill(text, cls, title) {
  return h('span', { class: `pill ${cls || ''}`, title }, text);
}

function dealPills(d) {
  const f = d.flags || {};
  const out = [];
  if (d.hiddenBy) out.push(pill(hiddenLabel(d.hiddenBy), 'muted'));
  if (f.wishlist) out.push(pill('❤️ Liste de souhaits', 'wish'));
  if (f.priceError) out.push(pill('⚠️ Erreur de prix ?', 'danger', 'Signalé comme erreur de prix sur Dealabs : peut être annulé par le vendeur'));
  if (f.drop) out.push(pill('📉 Chute soudaine', 'warn', d.prevPrice ? `Avant : ${formatPrice(d.prevPrice, d.currency)}` : ''));
  if (f.historicLow) out.push(pill('🏆 Plus bas historique', 'gold'));
  if (f.hot) out.push(pill('🔥 Hot Dealabs', 'hot', 'Deal validé par la communauté Dealabs'));
  if (f.nintendo) out.push(pill('Nintendo', 'nintendo'));
  if (f.gem) out.push(pill('💎 Pépite', 'gem', 'Très bien noté par les joueurs'));
  if (d.rating?.metacritic) out.push(pill(`MC ${d.rating.metacritic}`, 'score', 'Note Metacritic'));
  if (d.rating?.steam) out.push(pill(`Steam ${d.rating.steam} %`, 'score', d.rating.steamText || 'Avis Steam'));
  if (d.keyshop && d.channel !== 'keyshop') out.push(pill(`🔑 Clé ${formatPrice(d.keyshop.price, d.keyshop.currency)}`, 'key', 'Meilleur prix sur les sites de clés (GG.deals)'));
  if (d.channel === 'physical') out.push(pill('📦 Boîte', 'muted'));
  if (d.channel === 'keyshop' && d.source !== 'ggdeals') out.push(pill('🔑 Site de clés', 'key'));
  if (f.local) out.push(pill('📍 En magasin', 'muted'));
  if (d.end) {
    const left = d.end - Date.now();
    out.push(h('span', { class: `pill timer${left < 24 * 3600e3 ? ' urgent' : ''}`, 'data-end': d.end, title: `Jusqu'au ${formatDate(d.end)}` }, `⏱ ${formatDuration(left)}`));
  }
  return out;
}

function compareUrl(d) {
  if (d.dealabsUrl) return { label: 'Dealabs', url: d.dealabsUrl };
  if (d.section === 'pc') return { label: 'Comparer', url: `https://gg.deals/search/?title=${encodeURIComponent(d.title)}` };
  if (d.source !== 'dealabs') return { label: 'Comparer', url: `https://www.dealabs.com/search?q=${encodeURIComponent(`${d.title} switch`)}` };
  return null;
}

function dealCard(d, isHidden) {
  const coverEl = cover(d.images, d.section === 'switch' ? 'switch' : 'pc', d.square);
  if (d.section === 'pc' && STORES[d.platform]) coverEl.append(badge(d.platform));
  if (d.platform === 'switch2') coverEl.append(h('span', { class: 'store-badge', style: 'color:#fff;background:#e60012' }, 'Switch 2'));
  if (d.discount) coverEl.append(h('span', { class: 'disc' }, `-${d.discount} %`));
  if (d.exceptional) coverEl.append(h('span', { class: 'flame', title: 'Affaire exceptionnelle' }, '🔥'));
  const cmp = compareUrl(d);
  const actions = isHidden
    ? [h('button', { class: 'btn', onclick: () => setDealHidden(d, false) }, 'Réafficher')]
    : [
        h('button', { class: 'btn primary', onclick: () => open(d.url) }, 'Voir l’offre'),
        cmp ? h('button', { class: 'btn ghost', onclick: () => open(cmp.url) }, cmp.label) : null,
        h('button', { class: 'btn icon', onclick: () => setDealHidden(d, true), title: 'Masquer ce bon plan', 'aria-label': 'Masquer' }, ICON_HIDE()),
      ];
  return h('article', { class: `card deal${isHidden ? ' dim' : ''}${d.exceptional ? ' exceptional' : ''}` },
    coverEl,
    h('div', { class: 'body' },
      h('h3', { class: 'title', title: d.title }, d.title),
      priceBlock(d),
      h('div', { class: 'pills' }, ...dealPills(d)),
      h('div', { class: 'actions' }, ...actions),
    ),
  );
}

// ---------- Éléments communs ----------
function renderChips(rows, defs, match, show) {
  const box = $('#filters');
  box.replaceChildren();
  if (!show) return;
  const chip = (id, label, color, n) =>
    h('button', { class: `chip${ui.filter === id ? ' active' : ''}`, onclick: () => { ui.filter = id; render(); } },
      color ? h('span', { class: 'dot', style: `background:${color}` }) : null,
      label,
      h('span', { class: 'n' }, n));
  box.append(
    chip('all', 'Tous', null, rows.length),
    ...defs
      .map((f) => ({ f, n: rows.filter((r) => match(r, f.id)).length }))
      .filter(({ f, n }) => n > 0 || ui.filter === f.id) // pas de filtre vide
      .map(({ f, n }) => chip(f.id, f.label, f.color, n)),
  );
}

function hiddenLabel(reason) {
  if (reason === 'owned') return '🎮 Déjà dans ta bibliothèque';
  if (reason?.startsWith('genre:')) {
    const g = GENRE_BY_ID[reason.slice(6)];
    return `🚫 ${g ? `${g.emoji} ${g.label}` : 'Genre masqué'}`;
  }
  if (reason?.startsWith('keyword:')) return `🚫 « ${reason.slice(8)} »`;
  return '🚫 Filtré';
}

function filteredToggle(list, n, renderFiltered) {
  if (!n) return;
  list.append(
    h('button', { class: 'link-btn toggle-hidden', onclick: () => { ui.showFiltered = !ui.showFiltered; render(); } },
      ui.showFiltered ? 'Cacher ce que tes filtres masquent' : `🚫 ${n} masqué${n > 1 ? 's' : ''} par tes filtres (voir)`),
  );
  if (ui.showFiltered) renderFiltered();
}

function hiddenToggle(list, n, renderHidden) {
  if (!n) return;
  list.append(
    h('button', { class: 'link-btn toggle-hidden', onclick: () => { ui.showHidden = !ui.showHidden; render(); } },
      ui.showHidden ? 'Cacher les éléments masqués' : `Afficher les éléments masqués (${n})`),
  );
  if (ui.showHidden) renderHidden();
}

function empty(icon, title, text) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon), h('strong', {}, title), text);
}

const PLACEHOLDER = { pc: { bg: '#1e293b', short: 'PC' }, switch: { bg: '#7f1d1d', short: 'S' } };

function cover(images, store, square = false) {
  const meta = STORES[store] || PLACEHOLDER[store] || {};
  const box = h('div', { class: `cover${square ? ' square' : ''}` });
  const urls = [...(images || [])];
  const placeholder = () => box.prepend(h('div', { class: 'ph', style: `background:${meta.bg || '#222'}` }, (meta.short || '?')[0]));
  if (!urls.length) placeholder();
  else {
    const img = h('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: urls.shift() });
    img.addEventListener('error', () => {
      if (urls.length) img.src = urls.shift();
      else {
        img.remove();
        placeholder();
      }
    });
    box.append(img);
  }
  return box;
}

function badge(store) {
  const meta = STORES[store] || { short: store, color: '#fff', bg: '#333' };
  return h('span', { class: 'store-badge', style: `color:${meta.color};background:${meta.bg}` }, meta.short);
}

function timerEl(g, mode) {
  const now = Date.now();
  if (mode === 'upcoming') {
    if (!g.start) return null;
    return h('span', { class: 'timer', 'data-start': g.start, title: formatDate(g.start) }, `Gratuit dans ${formatDuration(g.start - now)}`);
  }
  if (!g.end) return h('span', { class: 'timer' }, 'Durée limitée');
  const left = g.end - now;
  const cls = left < 24 * 3600e3 ? 'timer urgent' : left < 72 * 3600e3 ? 'timer soon' : 'timer';
  return h('span', { class: cls, 'data-end': g.end, title: `Jusqu'au ${formatDate(g.end)}` }, `⏱ ${formatDuration(left)}`);
}

function gameCard({ g }, mode) {
  const viaAggregator = g.sources?.length === 1 && g.sources[0] === 'gamerpower';
  const actions =
    mode === 'upcoming'
      ? [h('button', { class: 'btn', onclick: () => open(g.url) }, 'Voir la page')]
      : mode === 'hidden'
        ? [h('button', { class: 'btn', onclick: () => setHidden(g, false) }, 'Réafficher')]
        : mode === 'filtered'
          ? [h('button', { class: 'btn', onclick: () => claim(g) }, 'Récupérer quand même'), h('span', { class: 'pill muted' }, hiddenLabel(g.hiddenBy))]
        : [
            h('button', { class: 'btn primary', onclick: () => claim(g) }, 'Récupérer'),
            h('button', { class: 'btn ghost', onclick: () => setClaimed(g, true), title: 'Je possède déjà ce jeu' }, 'Je l’ai'),
            h('button', { class: 'btn icon', onclick: () => setHidden(g, true), title: 'Masquer ce jeu', 'aria-label': 'Masquer' }, ICON_HIDE()),
          ];

  const coverEl = cover(g.images, g.store);
  coverEl.append(badge(g.store));
  const via = g.via ? `via ${g.via}` : viaAggregator ? 'via GamerPower' : null;

  return h('article', { class: `card${mode === 'hidden' || mode === 'filtered' ? ' dim' : ''}` },
    coverEl,
    h('div', { class: 'body' },
      h('h3', { class: 'title', title: g.title }, g.title),
      h('div', { class: 'meta' },
        timerEl(g, mode),
        g.worth ? h('span', {}, `Valeur ${g.worth}`) : null,
        via && !g.prime ? h('span', { class: g.via ? 'via' : '', title: 'Site qui organise le giveaway (compte parfois requis)' }, via) : null,
        g.prime ? h('span', { class: 'pill prime', title: 'Réservé aux abonnés Amazon Prime' }, '👑 Prime') : null,
        g.cloud ? h('span', { class: 'pill cloud', title: 'Jouable en streaming avec Prime, pas ajouté à ta bibliothèque' }, '☁️ Cloud · pas à garder') : null,
      ),
      h('div', { class: 'actions' }, ...actions),
    ),
  );
}

function claimedRow({ key, s }) {
  const snap = s.snapshot;
  return h('div', { class: 'row' },
    cover(snap.images, snap.store),
    h('div', { class: 'body' },
      h('div', { class: 'title', title: snap.title }, snap.title),
      h('div', { class: 'meta' },
        h('span', {}, STORES[snap.store]?.short || snap.store),
        s.claimedAt ? h('span', {}, `le ${formatShortDate(s.claimedAt)}`) : null,
        snap.worth ? h('span', {}, snap.worth) : null,
      ),
    ),
    h('button', { class: 'link-btn', onclick: () => unclaim(key, snap.title), title: 'Retirer de la liste des récupérés' }, 'Annuler'),
  );
}

function updateTimers() {
  const now = Date.now();
  document.querySelectorAll('.timer[data-end]').forEach((el) => {
    const left = Number(el.dataset.end) - now;
    el.textContent = `⏱ ${formatDuration(left)}`;
    const base = el.classList.contains('pill') ? 'pill timer' : 'timer';
    el.className = left < 24 * 3600e3 ? `${base} urgent` : left < 72 * 3600e3 ? `${base} soon` : base;
  });
  document.querySelectorAll('.timer[data-start]').forEach((el) => {
    el.textContent = `Gratuit dans ${formatDuration(Number(el.dataset.start) - now)}`;
  });
  if (S?.meta?.lastRefresh) $('#last-check').textContent = `Vérifié ${formatAgo(S.meta.lastRefresh)}`;
}

// ---------- Actions ----------
let snackTimer = null;
function snackbar(text, undo) {
  const bar = $('#snackbar');
  bar.replaceChildren(h('span', {}, text));
  if (undo) bar.append(h('button', { onclick: async () => { bar.hidden = true; await undo(); } }, 'Annuler'));
  bar.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => (bar.hidden = true), 5000);
}

const open = (url) => chrome.tabs.create({ url });

async function claim(g) {
  await send({ type: 'openClaim', key: g.key });
  window.close();
}

async function openAll() {
  await send({ type: 'openAll' });
  window.close();
}

async function setClaimed(g, claimed) {
  S = await send({ type: 'setClaimed', key: g.key, claimed });
  render();
  if (claimed) snackbar(`« ${g.title} » marqué comme récupéré`, () => setClaimed(g, false));
}

async function setHidden(g, hidden) {
  S = await send({ type: 'setHidden', key: g.key, hidden });
  render();
  if (hidden) snackbar(`« ${g.title} » masqué`, () => setHidden(g, false));
}

async function setDealHidden(d, hidden) {
  S = await send({ type: 'setDealHidden', id: d.id, hidden });
  render();
  if (hidden) snackbar(`« ${d.title} » masqué`, () => setDealHidden(d, false));
}

async function unclaim(key, title) {
  S = await send({ type: 'setClaimed', key, claimed: false });
  render();
  snackbar(`« ${title} » retiré des récupérés`);
}

async function refresh() {
  if (ui.refreshing) return;
  ui.refreshing = true;
  render();
  try {
    S = await send({ type: 'refresh' });
  } finally {
    ui.refreshing = false;
    render();
  }
}

function setSection(section) {
  ui.section = section;
  ui.filter = 'all';
  ui.showHidden = false;
  ui.showFiltered = false;
  try {
    localStorage.setItem('fk:section', section);
  } catch { /* rien */ }
  render();
  $('#list').scrollTop = 0;
}

// ---------- Initialisation ----------
document.querySelectorAll('.section').forEach((b) => b.addEventListener('click', () => setSection(b.dataset.section)));
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    ui.tab = t.dataset.tab;
    ui.filter = 'all';
    render();
  }),
);
$('#btn-refresh').addEventListener('click', refresh);
$('#btn-onboard').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') }));
$('#btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

let reloadTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session') return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    S = await send({ type: 'getState' });
    render();
  }, 150);
});

setInterval(updateTimers, 30 * 1000);

(async () => {
  // Ouvert depuis une notification « bons plans » : on va directement à la bonne section.
  try {
    const { openSection } = await chrome.storage.session.get('openSection');
    if (openSection) {
      ui.section = openSection;
      await chrome.storage.session.remove('openSection');
    }
  } catch { /* rien */ }
  S = await send({ type: 'getState' });
  render();
  if (!S.meta.lastRefresh || Date.now() - S.meta.lastRefresh > STALE_AFTER_MS) refresh();
})();
