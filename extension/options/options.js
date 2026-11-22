// FreeKeep — réglages (onglets, enregistrement automatique)
import { LEVELS, ALARM_NAME, INTERVALS, DEAL_SOURCES } from '../src/config.js';
import { getSettings, saveSettings } from '../src/store.js';
import { wants } from '../src/prefs.js';
import { formatAgo } from '../src/util.js';
import { h, toggleCard, switchRow, selectRow, storeGrid, primeBox, genreChips, tagInput, levelCards, steamProfileField, steamSessionField, gogSessionField } from '../ui/components.js';

const $ = (s) => document.querySelector(s);
let settings = null;
let tab = new URLSearchParams(location.search).get('tab') || 'profile';

// ---------- Enregistrement ----------
let saveTimer = null;
let savedTimer = null;
function save({ rerender = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings(settings);
    const el = $('#saved');
    el.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (el.hidden = true), 1300);
  }, 250);
  renderNav();
  if (rerender) renderPanel();
}
const set = (key, rerender = false) => (value) => {
  settings[key] = value;
  save({ rerender });
};

// ---------- Onglets ----------
const TABS = [
  { id: 'profile', icon: '👤', label: 'Mes plateformes' },
  { id: 'content', icon: '🎯', label: 'Ce que je veux voir' },
  { id: 'filters', icon: '🚫', label: 'Filtres', badge: () => (settings.excludedGenres.length + settings.bannedKeywords.length) || null },
  { id: 'steam', icon: '📚', label: 'Mes bibliothèques', show: () => settings.pc && (settings.stores.steam || settings.stores.gog) },
  { id: 'alerts', icon: '🔔', label: 'Alertes' },
  { id: 'sources', icon: '📡', label: 'Sources & données' },
];

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren(...TABS.filter((t) => !t.show || t.show()).map((t) => {
    const n = t.badge?.();
    return h('button', { type: 'button', class: tab === t.id ? 'active' : '', onclick: () => { tab = t.id; renderNav(); renderPanel(); } },
      h('span', {}, t.icon), t.label, n ? h('span', { class: 'badge' }, n) : null);
  }));
}

const box = (title, hint, ...children) => h('section', { class: 'box' }, title ? h('h2', {}, title) : null, hint ? h('p', { class: 'hint' }, hint) : null, ...children);

// ---------- Contenu des onglets ----------
const PANELS = {
  profile: () => [
    h('h1', {}, 'Mes plateformes'),
    h('p', { class: 'lead' }, 'Les menus de FreeKeep<3 s’adaptent à ce que tu coches ici.'),
    box('Sur quoi tu joues', null,
      h('div', { class: 'tgrid' },
        toggleCard({ icon: '💻', title: 'PC', desc: 'Jeux gratuits et promos PC', checked: settings.pc, onChange: set('pc', true) }),
        toggleCard({ icon: '🎮', title: 'Nintendo Switch', desc: 'Promos eShop, boîtes et clés', checked: settings.switch, accent: '#f87171', onChange: set('switch', true) }),
      ),
      settings.switch ? h('div', { class: 'sub-row' }, switchRow({ title: 'Inclure les jeux Switch 2', desc: 'Sinon, seuls les jeux jouables sur Switch 1 sont montrés.', checked: settings.switch2, onChange: set('switch2') })) : null,
    ),
    settings.pc ? box('Où tu actives tes jeux PC', 'Les jeux gratuits et les promos des plateformes non cochées sont masqués.',
      storeGrid(settings.stores, (id, on) => { settings.stores[id] = on; save({ rerender: id === 'steam' || id === 'gog' }); })) : null,
    settings.pc ? box('Amazon Prime', null,
      primeBox(settings, (key, a, b) => { if (key === 'prime') settings.prime = a; else settings.stores[a] = b; save(); })) : null,
  ],

  content: () => {
    const w = wants(settings);
    const sections = [];
    if (settings.pc) {
      sections.push(switchRow({ title: '🎁 Jeux PC gratuits à garder', checked: settings.freeGames, onChange: set('freeGames', true) }));
      if (settings.freeGames && settings.stores.epic) sections.push(switchRow({ title: '🗓️ Jeux Epic de la semaine prochaine', desc: 'Onglet « Bientôt »', checked: settings.showUpcoming, onChange: set('showUpcoming') }));
      sections.push(switchRow({ title: '💻 Promos PC', checked: settings.pcDeals, onChange: set('pcDeals', true) }));
    }
    if (settings.switch) {
      sections.push(switchRow({ title: '🎮 Promos Switch', checked: settings.switchDeals, onChange: set('switchDeals', true) }));
      sections.push(switchRow({ title: '📦 Jeux en boîte (magasins)', desc: 'Amazon, Fnac, Leclerc… via Dealabs', checked: settings.physical, onChange: set('physical') }));
    }
    sections.push(switchRow({ title: '🔑 Sites de clés', desc: 'Eneba, Instant Gaming, G2A… (marché gris : moins cher, sans garantie éditeur)', checked: settings.keyshops, onChange: set('keyshops', true) }));
    sections.push(switchRow({ title: '📚 Bundles', checked: settings.bundles, onChange: set('bundles') }));

    const custom = settings.level === 'custom';
    const adv = h('details', { class: 'adv', open: custom || null },
      h('summary', {}, custom ? 'Réglages avancés (personnalisés)' : 'Réglages avancés'),
      h('div', { class: 'rows' },
        selectRow({ title: 'Remise mini sur les gros jeux PC', desc: 'Jeux à 29 $+ bien notés (Metacritic 75+ ou Steam 80 %+)', value: settings.pcMinDiscount, options: [40, 50, 60, 70, 75, 80, 90].map((v) => [v, `-${v} %`]), onChange: (v) => { settings.pcMinDiscount = Number(v); settings.level = 'custom'; save({ rerender: true }); } }),
        selectRow({ title: 'Pépites : note Steam mini', desc: '3 000 avis minimum', value: settings.gemMinRating, options: [80, 85, 90, 95].map((v) => [v, `${v} %`]), onChange: (v) => { settings.gemMinRating = Number(v); settings.level = 'custom'; save({ rerender: true }); } }),
        selectRow({ title: 'Pépites : remise mini', value: settings.gemMinDiscount, options: [40, 50, 60, 70, 75, 80].map((v) => [v, `-${v} %`]), onChange: (v) => { settings.gemMinDiscount = Number(v); settings.level = 'custom'; save({ rerender: true }); } }),
        settings.switch ? selectRow({ title: 'Remise mini eShop', desc: 'Les jeux Nintendo sont gardés dès -20 %', value: settings.switchMinDiscount, options: [20, 30, 40, 50, 60, 70].map((v) => [v, `-${v} %`]), onChange: (v) => { settings.switchMinDiscount = Number(v); settings.level = 'custom'; save({ rerender: true }); } }) : null,
      ),
    );
    const ggKey = h('input', { type: 'text', class: 'wide mono', placeholder: 'Colle ta clé API GG.deals', value: settings.ggdealsKey || '', autocomplete: 'off', spellcheck: 'false' });
    let t = null;
    ggKey.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => set('ggdealsKey')(ggKey.value.trim()), 500); });

    return [
      h('h1', {}, 'Ce que je veux voir'),
      h('p', { class: 'lead' }, 'Chaque section désactivée disparaît du popup.'),
      box('Sections', null, h('div', { class: 'rows' }, sections)),
      w.pcDeals || w.switchDeals ? box('Niveau d’exigence', 'FreeKeep<3 écarte déjà les jeux mal notés et les petits jeux bradés.',
        levelCards(custom ? null : settings.level, (v) => { settings.level = v; save({ rerender: true }); }), adv) : null,
      w.pcDeals && settings.keyshops && settings.stores.steam ? box('Surveillance des sites de clés (facultatif)',
        'Avec une clé API GG.deals gratuite, FreeKeep<3 affiche le prix « clé » de chaque promo et te prévient si un gros jeu chute soudainement. Crée un compte sur gg.deals → Settings → API.',
        h('div', { class: 'inline' }, ggKey, h('a', { class: 'btn', href: 'https://gg.deals/settings/', target: '_blank', rel: 'noopener' }, 'Obtenir une clé'))) : null,
    ];
  },

  filters: () => [
    h('h1', {}, 'Filtres'),
    h('p', { class: 'lead' }, 'Ce que tu ne veux jamais voir, ni dans les jeux gratuits, ni dans les promos.'),
    box('Genres masqués', 'Clique pour masquer / réafficher. Détection via Steam et l’eShop Nintendo ; pour les autres jeux, via le titre.',
      genreChips(settings.excludedGenres, set('excludedGenres'))),
    box('Licences et mots-clés bannis', 'Tout titre contenant un de ces noms est masqué, même écrit un peu autrement : « Hogwart’s Legacy », « NBA 2K26 » ou « EA FC 27 » pour « EA Sports FC ». « LEGO » masque tous les jeux LEGO.',
      tagInput(settings.bannedKeywords, set('bannedKeywords'))),
    h('p', { class: 'note' }, 'Les jeux de ta liste de souhaits Steam ignorent le filtre de genres (mais pas les mots-clés bannis).'),
  ],

  steam: () => {
    const card = h('div', { id: 'lib-card' });
    const gogCard = h('div', { id: 'gog-card' });
    if (settings.stores.steam) refreshLibCard(card);
    if (settings.stores.gog && settings.gogSessionSync) refreshGogCard(gogCard);
    return [
      h('h1', {}, 'Mes bibliothèques'),
      h('p', { class: 'lead' }, 'Sans mot de passe : FreeKeep<3 lit tes sessions Steam et gog.com déjà ouvertes dans ce navigateur, si tu le veux.'),
      settings.stores.steam ? box('Steam', null, card,
        steamSessionField(settings.steamOwnedSync, (v) => { set('steamOwnedSync', true)(v); }),
        h('p', { class: 'note' }, 'Lien de ton profil public (facultatif) :'),
        steamProfileField(settings.steamProfile, (v) => { if (v !== settings.steamProfile) set('steamProfile')(v); }, { useSession: () => settings.steamOwnedSync })) : null,
      settings.stores.gog ? box('GOG', null, gogCard,
        gogSessionField(settings.gogSessionSync, (v) => { set('gogSessionSync', true)(v); })) : null,
      box('Utilisation', null, h('div', { class: 'rows' },
        switchRow({ title: 'Masquer les promos sur les jeux que je possède', checked: settings.hideOwned, onChange: set('hideOwned') }),
        settings.stores.steam ? switchRow({ title: 'Mettre en avant ma liste de souhaits Steam', desc: 'Badge ❤️, en tête de liste, et promos dès -20 % même si le jeu n’est pas « gros ».', checked: settings.useWishlist, onChange: set('useWishlist') }) : null,
      )),
      box('Et les autres plateformes ?', null,
        h('ul', { class: 'other-libs' },
          h('li', {}, h('strong', {}, 'Détection automatique : '), 'quand tu visites la page d’un jeu Epic, GOG ou Ubisoft et qu’elle affiche « Dans la bibliothèque », FreeKeep<3 le note.'),
          h('li', {}, h('strong', {}, 'Bouton « Je l’ai » : '), 'sur chaque jeu gratuit, pour les cas restants.'),
          h('li', {}, 'Epic, Ubisoft, EA, Battle.net, Microsoft Store et Amazon ne publient pas de bibliothèque lisible sans te connecter à ton compte : FreeKeep<3 évite volontairement de le faire.'),
        )),
    ];
  },

  alerts: () => {
    const w = wants(settings);
    const rows = [];
    if (w.free) {
      rows.push(switchRow({ title: '🎁 Nouveau jeu gratuit', checked: settings.notifyNew, onChange: set('notifyNew') }));
      rows.push(switchRow({ title: '⏳ Rappel le dernier jour', desc: 'Si un jeu gratuit non récupéré expire dans moins de 24 h', checked: settings.notifyLastDay, onChange: set('notifyLastDay') }));
    }
    if (w.pcDeals || w.switchDeals) rows.push(switchRow({ title: '🔥 Affaires exceptionnelles', desc: 'Erreurs de prix, chutes soudaines, plus bas historiques à -75 %+, deals hot à -60 %+', checked: settings.notifyDeals, onChange: set('notifyDeals') }));
    if (w.pcDeals && settings.stores.steam && settings.useWishlist) rows.push(switchRow({ title: '❤️ Liste de souhaits en promo', desc: 'Dès -50 %', checked: settings.notifyWishlist, onChange: set('notifyWishlist') }));
    return [
      h('h1', {}, 'Alertes'),
      h('p', { class: 'lead' }, 'FreeKeep<3 vérifie en arrière-plan, même popup fermé, tant que le navigateur est ouvert.'),
      box('Notifications', null, h('div', { class: 'rows' }, rows.length ? rows : h('p', { class: 'note' }, 'Aucune section active.')),
        h('div', { class: 'inline', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn', onclick: () => chrome.runtime.sendMessage({ type: 'testNotification' }) }, 'Envoyer une notification de test'))),
      box('Fréquence', null, h('div', { class: 'rows' },
        selectRow({ title: 'Vérifier', desc: 'Erreurs de prix : 5 à 15 min conseillé. Les autres sources sont relues au plus toutes les 15 min', value: settings.intervalHours, options: INTERVALS, onChange: (v) => set('intervalHours')(Number(v)) }))),
      w.free ? box('Récupération', null, h('div', { class: 'rows' },
        switchRow({ title: '🖱️ Clic automatique sur « Obtenir »', desc: 'Quand tu cliques « Récupérer ». Captchas et confirmations restent manuels ; sur Epic, la commande n’est validée que si le total est à 0.', checked: settings.autoClick, onChange: set('autoClick') }))) : null,
    ];
  },

  sources: () => {
    const list = h('div', { id: 'sources-list' });
    const next = h('span', { id: 'next-check' }, '…');
    const btn = h('button', { type: 'button', class: 'btn' }, 'Vérifier maintenant');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Vérification…';
      try {
        await chrome.runtime.sendMessage({ type: 'refresh', force: ['dealabs', 'steamlib', 'wishlist', ...DEAL_SOURCES] });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Vérifier maintenant';
        refreshSources();
      }
    });
    const reset = h('button', { type: 'button', class: 'btn danger' }, 'Réinitialiser');
    let armed = null;
    reset.addEventListener('click', async () => {
      if (!armed) {
        reset.textContent = 'Confirmer ?';
        reset.classList.add('confirm');
        armed = setTimeout(() => { armed = null; reset.textContent = 'Réinitialiser'; reset.classList.remove('confirm'); }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      reset.disabled = true;
      reset.textContent = 'Réinitialisation…';
      await chrome.runtime.sendMessage({ type: 'resetData' });
      reset.disabled = false;
      reset.classList.remove('confirm');
      reset.textContent = 'Réinitialiser';
    });
    setTimeout(refreshSources, 0);
    const dept = h('input', { type: 'text', class: 'short', value: settings.departments || '', placeholder: 'ex. 80, 60' });
    let t = null;
    dept.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => set('departments')(dept.value.trim()), 500); });
    return [
      h('h1', {}, 'Sources & données'),
      h('p', { class: 'lead' }, 'L’état de chaque source, vérifié en direct.'),
      box('État des sources', null, h('div', { class: 'status-head' }, next, btn), list),
      box('Dealabs', 'Communauté de bons plans : jeux en boîte, sites de clés, erreurs de prix.', h('div', { class: 'rows' },
        switchRow({ title: 'Utiliser Dealabs', checked: settings.dealabs, onChange: set('dealabs') }),
        switchRow({ title: 'Seulement les deals « hot »', desc: 'Validés par la communauté. Les erreurs de prix passent toujours, et les jeux en boîte aussi (sauf au niveau 🔥)', checked: settings.dealabsOnlyHot, onChange: set('dealabsOnlyHot') }),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('strong', {}, 'Départements pour les deals en magasin'), h('small', {}, 'Les promos valables dans un seul magasin ne sont gardées que pour ces départements')), dept),
        selectRow({ title: 'Garder les deals pendant', value: settings.dealMaxAgeDays, options: [[3, '3 jours'], [7, '7 jours'], [14, '14 jours']], onChange: (v) => set('dealMaxAgeDays')(Number(v)) }),
      )),
      box('Données', null, h('div', { class: 'rows' },
        h('div', { class: 'row' }, h('span', { class: 'row-text' }, h('strong', {}, 'Tout réinitialiser'), h('small', {}, 'Efface l’historique des jeux récupérés, les éléments masqués et le cache. Les réglages sont conservés.')), reset))),
      h('p', { class: 'credits' }, 'Sources : Epic Games Store, Steam, ',
        h('a', { href: 'https://www.gamerpower.com', target: '_blank' }, 'GamerPower'), ', ',
        h('a', { href: 'https://www.cheapshark.com', target: '_blank' }, 'CheapShark'), ' (prix convertis au taux de la Banque centrale européenne), GOG, EA, eShop Nintendo, Eneba, Kinguin, Instant Gaming, Fanatical, Humble Bundle, ',
        h('a', { href: 'https://barter.vg', target: '_blank' }, 'Barter.vg'), ', ',
        h('a', { href: 'https://www.dealabs.com', target: '_blank' }, 'Dealabs'), ', ',
        h('a', { href: 'https://gg.deals', target: '_blank' }, 'GG.deals'), ', SteamSpy. FreeKeep<3 n’est affilié à aucun de ces services.'),
    ];
  },
};

function renderPanel() {
  if (!TABS.find((t) => t.id === tab && (!t.show || t.show()))) tab = 'profile';
  $('#panel').replaceChildren(...PANELS[tab]().flat().filter(Boolean));
}

// ---------- Bibliothèque Steam (état) ----------
async function refreshLibCard(card) {
  const state = await chrome.runtime.sendMessage({ type: 'getState' }).catch(() => null);
  const lib = state?.steamLib || {};
  if (!settings.steamProfile && !settings.steamOwnedSync) {
    card.replaceChildren(h('div', { class: 'lib-card' }, h('span', { class: 'big' }, '🔗'), h('div', {}, h('strong', {}, 'Bibliothèque non liée'), h('small', {}, 'Active la lecture via ta session Steam ci-dessous.'))));
    return;
  }
  const sync = h('button', { type: 'button', class: 'btn' }, 'Synchroniser');
  sync.addEventListener('click', async () => {
    sync.disabled = true;
    sync.textContent = 'Synchronisation…';
    await chrome.runtime.sendMessage({ type: 'refresh', force: ['steamlib', 'cheapshark'] }).catch(() => {});
    refreshLibCard(card);
  });
  const ok = !lib.error && lib.count;
  card.replaceChildren(h('div', { class: `lib-card ${ok ? 'ok' : lib.error ? 'ko' : ''}` },
    h('span', { class: 'big' }, ok ? '✅' : lib.error ? '⚠️' : '⏳'),
    h('div', {},
      h('strong', {}, ok ? `${lib.profileName || 'Steam'} : ${lib.count} jeux et DLC` : lib.error ? 'Synchronisation impossible' : 'Synchronisation en attente…'),
      h('small', {}, ok
        ? `${settings.useWishlist ? (lib.wishlistError ? 'liste de souhaits non accessible' : `${lib.wishlistCount} en liste de souhaits`) + ' · ' : ''}mis à jour ${lib.at ? formatAgo(lib.at) : ''}`
        : lib.error ? `${lib.error}${lib.wishlistCount ? ` · ${lib.wishlistCount} en liste de souhaits` : ''}` : 'La première synchronisation arrive dans quelques secondes.')),
    sync));
}

async function refreshGogCard(card) {
  const state = await chrome.runtime.sendMessage({ type: 'getState' }).catch(() => null);
  const lib = state?.gogLib || {};
  const sync = h('button', { type: 'button', class: 'btn' }, 'Synchroniser');
  sync.addEventListener('click', async () => {
    sync.disabled = true;
    sync.textContent = 'Synchronisation…';
    await chrome.runtime.sendMessage({ type: 'refresh', force: ['goglib'] }).catch(() => {});
    refreshGogCard(card);
  });
  const ok = !lib.error && lib.count;
  card.replaceChildren(h('div', { class: `lib-card ${ok ? 'ok' : lib.error ? 'ko' : ''}` },
    h('span', { class: 'big' }, ok ? '✅' : lib.error ? '⚠️' : '⏳'),
    h('div', {},
      h('strong', {}, ok ? `${lib.username || 'GOG'} : ${lib.count} jeux` : lib.error ? 'Synchronisation impossible' : 'Synchronisation en attente…'),
      h('small', {}, ok ? `mis à jour ${lib.at ? formatAgo(lib.at) : ''}` : lib.error ? `${lib.error} — connecte-toi sur gog.com puis clique Synchroniser.` : 'La première synchronisation arrive dans quelques secondes.')),
    sync));
}

// ---------- État des sources ----------
const SOURCE_INFO = {
  epic: ['Epic Games Store', 'Jeux offerts de la semaine'],
  steam: ['Steam', 'Jeux à -100 %'],
  gamerpower: ['GamerPower', 'Giveaways : GOG, Ubisoft, Prime, Alienware, Fanatical, Humble…'],
  steamlib: ['Bibliothèque Steam', 'Tes jeux et ta liste de souhaits (session Steam du navigateur)'],
  goglib: ['Bibliothèque GOG', 'Tes jeux (session gog.com du navigateur)'],
  cheapshark: ['CheapShark', 'Promos PC sur 30+ stores officiels'],
  gog: ['GOG', 'Promos du catalogue GOG, en euros'],
  ea: ['EA', 'Offres du site EA, en euros'],
  bundles: ['Bundles', 'Humble Bundle, Fanatical, Green Man Gaming, IndieGala (via Barter.vg)'],
  switchkeys: ['Clés Switch', 'Eneba, Kinguin, Instant Gaming, comparés à l’eShop'],
  dealabsPages: ['Dealabs (pages)', 'Température, prix de référence, offres des 30 derniers jours'],
  eshop: ['eShop Nintendo', 'Promos Switch, prix et dates de fin'],
  dealabs: ['Dealabs', 'Boîtes, clés, erreurs de prix + jeux offerts (Prime, MS Store, Battle.net)'],
  ggdeals: ['GG.deals', 'Prix des sites de clés (clé API)'],
};

async function refreshSources() {
  const list = $('#sources-list');
  if (!list) return;
  const { meta } = await chrome.storage.local.get('meta');
  const alarm = await chrome.alarms.get(ALARM_NAME);
  const last = meta?.lastRefresh ? `Dernière : ${formatAgo(meta.lastRefresh)}` : 'Aucune vérification pour l’instant';
  const nextTxt = alarm ? ` · Prochaine : ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(alarm.scheduledTime)}` : '';
  const next = $('#next-check');
  if (next) next.textContent = last + nextTxt;
  const status = meta?.sources || {};
  list.replaceChildren(...Object.entries(SOURCE_INFO).map(([id, [name, desc]]) => {
    const st = status[id];
    let pill;
    let detail = '';
    if (!st) {
      const why = id === 'ggdeals' && !settings.ggdealsKey ? 'Pas de clé' : id === 'steamlib' && !settings.steamProfile && !settings.steamOwnedSync ? 'Non lié' : 'Désactivée';
      pill = h('span', { class: 'state off' }, why);
    } else if (st.ok) {
      pill = h('span', { class: 'state ok' }, `✔ ${st.count} ${st.count > 1 ? 'résultats' : 'résultat'}`);
      detail = st.at ? `données ${formatAgo(st.at)}` : '';
    } else {
      pill = h('span', { class: 'state ko', title: st.error || '' }, '✘ Erreur');
      detail = st.error || '';
    }
    return h('div', { class: 'src' }, h('div', {}, h('strong', {}, name), h('small', {}, desc)), h('div', { class: 'src-state' }, pill, h('small', {}, detail)));
  }));
}

// ---------- Démarrage ----------
$('#btn-tuto').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.meta || changes.steamLib)) {
    refreshSources();
    const card = $('#lib-card');
    if (card) refreshLibCard(card);
  }
  // Réglages modifiés ailleurs (tutoriel) : on recharge
  if (area === 'sync' && changes.settings && JSON.stringify(changes.settings.newValue) !== JSON.stringify(settings)) {
    getSettings().then((s) => {
      if (JSON.stringify(s) === JSON.stringify(settings)) return;
      settings = s;
      renderNav();
      renderPanel();
    });
  }
});
setInterval(refreshSources, 30 * 1000);

(async () => {
  settings = await getSettings();
  if (!LEVELS[settings.level] && settings.level !== 'custom') settings.level = 'balanced';
  renderNav();
  renderPanel();
})();
