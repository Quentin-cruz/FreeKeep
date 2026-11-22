// FreeKeep — tutoriel de premier lancement (relançable depuis les réglages)
import { STORES, STORE_ORDER, PC_STORE_ORDER, PRIME_STORES, LEVELS, INTERVALS, DEAL_SOURCES } from '../src/config.js';
import { GENRE_BY_ID } from '../src/genres.js';
import { getSettings, saveSettings } from '../src/store.js';
import { h, toggleCard, switchRow, storeGrid, primeBox, genreChips, tagInput, levelCards, steamProfileField, steamSessionField, gogSessionField } from '../ui/components.js';

const $ = (s) => document.querySelector(s);
let draft = null;
let index = 0;
let finished = false;

const anyDeals = (d) => (d.pc && d.pcDeals) || (d.switch && d.switchDeals);
const anyStore = (d) => PC_STORE_ORDER.some((s) => d.stores[s]) || (d.prime && PRIME_STORES.some((s) => d.stores[s]));

// ---------------------------------------------------------------------------
// Étapes (certaines n'apparaissent que selon les choix précédents)
// ---------------------------------------------------------------------------
const STEPS = [
  {
    id: 'welcome',
    next: 'C’est parti →',
    render: () => h('div', { class: 'hero' },
      h('img', { class: 'hero-logo', src: '../icons/logo-512.png', alt: '', width: 120, height: 120 }),
      h('h1', {}, 'Bienvenue dans FreeKeep<3'),
      h('p', { class: 'lead' }, 'Réponds à quelques questions (1 minute) : FreeKeep<3 ne te montrera que ce qui te concerne vraiment.'),
      h('div', { class: 'features' },
        feature('🎁', 'Jeux gratuits à vie', 'Epic, Steam, GOG, Alienware, Fanatical… récupérés en un clic.'),
        feature('💸', 'Vraies grosses promos', 'Que des bons jeux à grosse remise, et les erreurs de prix.'),
        feature('🔔', 'Alertes', 'Notification quand ça vaut vraiment le coup.'),
      ),
    ),
  },
  {
    id: 'platforms',
    title: 'Sur quoi tu joues ?',
    lead: 'Les menus de FreeKeep<3 s’adaptent à tes plateformes.',
    valid: (d) => d.pc || d.switch,
    invalidMsg: 'Choisis au moins une plateforme.',
    render: (d) => {
      const sub = h('div', { class: 'sub' },
        switchRow({ title: 'Je veux aussi les jeux Switch 2', desc: 'Sinon, seuls les jeux jouables sur la Switch 1 sont montrés.', checked: d.switch2, onChange: (v) => { d.switch2 = v; } }));
      sub.hidden = !d.switch;
      return [
        h('div', { class: 'tgrid' },
          toggleCard({ icon: '💻', title: 'PC', desc: 'Jeux gratuits et promos sur Steam, Epic, GOG…', checked: d.pc, onChange: (v) => { d.pc = v; } }),
          toggleCard({ icon: '🎮', title: 'Nintendo Switch', desc: 'Promos eShop, jeux en boîte et clés.', checked: d.switch, accent: '#f87171', onChange: (v) => { d.switch = v; sub.hidden = !v; } }),
        ),
        sub,
      ];
    },
  },
  {
    id: 'stores',
    show: (d) => d.pc,
    title: 'Où actives-tu tes jeux PC ?',
    lead: 'Coche les plateformes où tu as un compte. Les jeux et promos des autres seront masqués.',
    valid: anyStore,
    invalidMsg: 'Choisis au moins une plateforme.',
    render: (d) => [
      storeGrid(d.stores, (id, on) => { d.stores[id] = on; }),
      h('p', { class: 'note' }, 'Les clés vendues par Humble, Fanatical ou Green Man Gaming s’activent presque toujours sur Steam.'),
      primeBox(d, (key, a, b) => { if (key === 'prime') d.prime = a; else d.stores[a] = b; }),
    ],
  },
  {
    id: 'content',
    title: 'Qu’est-ce que tu veux voir ?',
    lead: 'Tu pourras changer ça à tout moment dans les réglages.',
    render: (d) => {
      const dept = h('div', { class: 'field' },
        h('span', {}, '📍 Ton département, pour les promos valables dans un seul magasin (les offres nationales s’affichent toujours) :'),
        deptInput(d));
      dept.hidden = !(d.switch && d.physical);
      const cards = [];
      if (d.pc) {
        cards.push(toggleCard({ icon: '🎁', title: 'Jeux PC gratuits à garder', desc: 'Offerts à vie : Epic chaque semaine, Steam, GOG, Prime, Alienware Arena…', checked: d.freeGames, onChange: (v) => { d.freeGames = v; } }));
        cards.push(toggleCard({ icon: '💻', title: 'Promos PC', desc: 'Gros jeux bien notés et pépites, à grosse remise.', checked: d.pcDeals, onChange: (v) => { d.pcDeals = v; } }));
      }
      if (d.switch) {
        cards.push(toggleCard({ icon: '🎮', title: 'Promos Switch', desc: 'eShop officiel, jeux en boîte et clés.', checked: d.switchDeals, accent: '#f87171', onChange: (v) => { d.switchDeals = v; } }));
        cards.push(toggleCard({ icon: '📦', title: 'Jeux en boîte (magasins)', desc: 'Amazon, Fnac, Leclerc, Micromania… repérés par Dealabs.', checked: d.physical, onChange: (v) => { d.physical = v; dept.hidden = !(d.switch && v); } }));
      }
      cards.push(toggleCard({ icon: '🔑', title: 'Sites de clés', desc: 'Eneba, Instant Gaming, G2A… Moins cher, mais pas des boutiques officielles.', checked: d.keyshops, onChange: (v) => { d.keyshops = v; } }));
      cards.push(toggleCard({ icon: '📚', title: 'Bundles', desc: 'Packs de plusieurs jeux à petit prix (Humble, Fanatical…).', checked: d.bundles, onChange: (v) => { d.bundles = v; } }));
      return [h('div', { class: 'tgrid' }, cards), dept];
    },
    valid: (d) => (d.pc && (d.freeGames || d.pcDeals)) || (d.switch && d.switchDeals),
    invalidMsg: 'Active au moins une catégorie.',
  },
  {
    id: 'level',
    show: anyDeals,
    title: 'Quel niveau d’exigence pour les promos ?',
    lead: 'FreeKeep<3 écarte déjà les jeux mal notés et les petits jeux bradés. Choisis à quel point il doit être sélectif.',
    render: (d) => [
      levelCards(LEVELS[d.level] ? d.level : 'balanced', (v) => { d.level = v; }),
      h('p', { class: 'note' }, 'Les erreurs de prix et les jeux de ta liste de souhaits sont toujours signalés, quel que soit le niveau.'),
    ],
  },
  {
    id: 'steam',
    show: (d) => d.pc && (d.stores.steam || d.stores.gog),
    title: 'Tes bibliothèques',
    lead: 'FreeKeep<3 masque les promos sur les jeux que tu as déjà, sans jamais te demander de mot de passe.',
    render: (d) => [
      d.stores.steam ? [
        h('h2', {}, 'Steam'),
        steamSessionField(d.steamOwnedSync, (v) => { d.steamOwnedSync = v; }, { autoTest: true }),
        h('p', { class: 'note' }, 'Lien de ton profil (facultatif) : jeux possédés et liste de souhaits.'),
        steamProfileField(d.steamProfile, (v) => { d.steamProfile = v; }, { autoTest: true, useSession: () => d.steamOwnedSync }),
      ] : null,
      d.stores.gog ? [
        h('h2', { style: 'margin-top:18px' }, 'GOG'),
        gogSessionField(d.gogSessionSync, (v) => { d.gogSessionSync = v; }),
      ] : null,
      h('div', { class: 'panel-lite', style: 'margin-top:14px' },
        switchRow({ title: 'Masquer les promos sur les jeux que je possède', checked: d.hideOwned, onChange: (v) => { d.hideOwned = v; } }),
        d.stores.steam ? switchRow({ title: 'Mettre en avant ma liste de souhaits Steam', desc: 'Alerte dès qu’un jeu de ta liste passe à -50 % ou plus.', checked: d.useWishlist, onChange: (v) => { d.useWishlist = v; d.notifyWishlist = v; } }) : null,
      ),
    ],
    skippable: true,
  },
  {
    id: 'exclude',
    title: 'Ce que tu ne veux pas voir',
    lead: 'Clique sur les genres à masquer, et ajoute des licences que tu veux bannir.',
    render: (d) => [
      h('h2', {}, 'Genres à masquer'),
      genreChips(d.excludedGenres, (v) => { d.excludedGenres = v; }),
      h('p', { class: 'note' }, 'Les genres sont détectés via Steam et l’eShop Nintendo. Pour les autres jeux, FreeKeep<3 se base sur le titre.'),
      h('h2', {}, 'Licences / mots-clés bannis'),
      tagInput(d.bannedKeywords, (v) => { d.bannedKeywords = v; }),
    ],
    skippable: true,
  },
  {
    id: 'alerts',
    title: 'Tes alertes',
    lead: 'FreeKeep<3 vérifie tout seul en arrière-plan, même popup fermé, tant que ton navigateur est ouvert.',
    render: (d) => {
      const wants = [];
      if (d.pc && d.freeGames) {
        wants.push(switchRow({ title: '🎁 Nouveau jeu gratuit', checked: d.notifyNew, onChange: (v) => { d.notifyNew = v; } }));
        wants.push(switchRow({ title: '⏳ Rappel le dernier jour', desc: 'Si un jeu gratuit non récupéré expire dans moins de 24 h.', checked: d.notifyLastDay, onChange: (v) => { d.notifyLastDay = v; } }));
      }
      if (anyDeals(d)) wants.push(switchRow({ title: '🔥 Affaires exceptionnelles', desc: 'Erreurs de prix, chutes soudaines, plus bas historiques.', checked: d.notifyDeals, onChange: (v) => { d.notifyDeals = v; } }));
      if (d.pc && d.stores.steam && d.useWishlist) wants.push(switchRow({ title: '❤️ Liste de souhaits en promo', checked: d.notifyWishlist, onChange: (v) => { d.notifyWishlist = v; } }));
      const freq = h('select', {},
        INTERVALS.map(([v, l]) => h('option', { value: String(v) }, l)));
      freq.value = String(d.intervalHours);
      freq.addEventListener('change', () => { d.intervalHours = Number(freq.value); });
      const extra = [];
      if (d.pc && d.freeGames) {
        extra.push(switchRow({ title: '🖱️ Clic automatique sur « Obtenir »', desc: 'Quand tu cliques « Récupérer », FreeKeep<3 ouvre la page et clique pour toi (jamais d’achat payant).', checked: d.autoClick, onChange: (v) => { d.autoClick = v; } }));
      }
      return [
        h('div', { class: 'panel-lite' }, wants),
        h('div', { class: 'field' }, h('span', {}, '⏱ Fréquence des vérifications :'), freq),
        h('p', { class: 'note' }, 'Les erreurs de prix partent vite : 5 à 15 minutes pour ne pas les rater. Les autres sources sont relues au plus toutes les 15 minutes.'),
        extra.length ? h('div', { class: 'panel-lite', style: 'margin-top:14px' }, extra) : null,
      ];
    },
  },
  {
    id: 'done',
    title: 'Tout est prêt 🎉',
    lead: 'Voici ta configuration :',
    next: 'Terminer',
    render: (d) => {
      const stores = STORE_ORDER.filter((s) => d.stores[s] && (!PRIME_STORES.includes(s) || d.prime)).map((s) => STORES[s].short);
      const sections = [
        d.pc && d.freeGames ? 'Jeux gratuits' : null,
        d.pc && d.pcDeals ? 'Promos PC' : null,
        d.switch && d.switchDeals ? `Promos ${d.switch2 ? 'Switch + Switch 2' : 'Switch'}` : null,
      ].filter(Boolean);
      const extras = [d.physical && d.switch ? 'boîtes' : null, d.keyshops ? 'sites de clés' : null, d.bundles ? 'bundles' : null].filter(Boolean);
      const recap = h('dl', { class: 'recap' },
        dt('Plateformes'), dd([d.pc ? 'PC' : null, d.switch ? (d.switch2 ? 'Switch + Switch 2' : 'Switch') : null].filter(Boolean).join(' · ')),
        d.pc ? [dt('Stores PC'), dd(stores.join(', ') || '—')] : null,
        d.pc ? [dt('Amazon Prime'), dd(d.prime ? 'oui 👑' : 'non')] : null,
        dt('Sections'), dd(sections.join(' · ') || '—'),
        extras.length ? [dt('Inclus'), dd(extras.join(', '))] : null,
        anyDeals(d) ? [dt('Exigence'), dd(LEVELS[d.level]?.label || 'Personnalisé')] : null,
        d.pc && d.stores.steam ? [dt('Bibliothèque Steam'), dd([d.steamOwnedSync ? 'via ta session Steam' : null, d.steamProfile ? 'profil lié' : null].filter(Boolean).join(' · ') || 'non')] : null,
        d.pc && d.stores.gog ? [dt('Bibliothèque GOG'), dd(d.gogSessionSync ? 'via ta session gog.com' : 'non')] : null,
        dt('Genres masqués'), dd(d.excludedGenres.map((g) => GENRE_BY_ID[g]?.label).filter(Boolean).join(', ') || 'aucun'),
        dt('Licences bannies'), dd(d.bannedKeywords.join(', ') || 'aucune'),
      );
      return [
        recap,
        h('div', { class: 'done-box' },
          h('p', {}, '👉 Clique sur l’icône FreeKeep<3 (le cœur) en haut à droite de ton navigateur.', h('br'), 'Épingle-la via l’icône 🧩 ou l’icône des extensions.'),
          h('p', {}, 'Tout se modifie à tout moment dans ⚙ Réglages. Tu peux aussi relancer ce tutoriel depuis les réglages.'),
        ),
      ];
    },
  },
];

function feature(ico, title, text) {
  return h('div', { class: 'feature' }, h('span', { class: 'ico' }, ico), h('strong', {}, title), h('small', {}, text));
}
const dt = (t) => h('dt', {}, t);
const dd = (t) => h('dd', {}, t);

function deptInput(d) {
  const input = h('input', { type: 'text', class: 'short', placeholder: 'ex. 80, 60', value: d.departments || '' });
  input.addEventListener('input', () => { d.departments = input.value.trim(); });
  return input;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const visibleSteps = () => STEPS.filter((s) => !s.show || s.show(draft));

function render() {
  const steps = visibleSteps();
  index = Math.min(index, steps.length - 1);
  const step = steps[index];
  const box = $('#step');
  box.replaceChildren(...[
    step.title ? h('h1', {}, step.title) : null,
    step.lead ? h('p', { class: 'lead' }, step.lead) : null,
    step.render(draft),
    h('p', { class: 'note warn', id: 'invalid', hidden: true }),
  ].flat(Infinity).filter(Boolean));
  $('#bar').style.width = `${Math.round(((index + 1) / steps.length) * 100)}%`;
  $('#step-count').textContent = `${index + 1} / ${steps.length}`;
  $('#btn-back').style.visibility = index === 0 ? 'hidden' : 'visible';
  $('#btn-skip').hidden = !step.skippable;
  $('#btn-next').textContent = step.next || 'Suivant →';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function next() {
  const steps = visibleSteps();
  const step = steps[index];
  if (step.valid && !step.valid(draft)) {
    const warn = $('#invalid');
    warn.textContent = `⚠ ${step.invalidMsg}`;
    warn.hidden = false;
    return;
  }
  if (step.id === 'done') return finish();
  index += 1;
  render();
}

async function finish() {
  const btn = $('#btn-next');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  finished = true;
  draft.onboarded = true;
  await saveSettings(draft);
  chrome.runtime.sendMessage({ type: 'refresh', force: ['steamlib', 'wishlist', ...DEAL_SOURCES] }).catch(() => {});
  try {
    await chrome.action.openPopup();
  } catch { /* le navigateur refuse : le message à l'écran guide l'utilisateur */ }
  btn.disabled = false;
  btn.textContent = 'Fermer cet onglet';
  btn.onclick = async (e) => {
    e.stopImmediatePropagation();
    const tab = await chrome.tabs.getCurrent();
    if (tab) chrome.tabs.remove(tab.id);
  };
  $('#btn-back').style.visibility = 'hidden';
  const box = document.querySelector('.done-box');
  if (box) box.prepend(h('p', { style: 'font-weight:700;color:var(--accent);margin-bottom:6px' }, '✔ Configuration enregistrée. FreeKeep<3 lance sa première vérification.'));
}

$('#btn-next').addEventListener('click', () => { if (!finished) next(); });
$('#btn-skip').addEventListener('click', () => { index += 1; render(); });
$('#btn-back').addEventListener('click', () => { index = Math.max(0, index - 1); render(); });
document.addEventListener('keydown', (e) => {
  if (!finished && e.key === 'Enter' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) next();
});

(async () => {
  draft = structuredClone(await getSettings());
  if (!LEVELS[draft.level]) draft.level = 'balanced';
  draft.excludedGenres = [...(draft.excludedGenres || [])];
  draft.bannedKeywords = [...(draft.bannedKeywords || [])];
  render();
})();
