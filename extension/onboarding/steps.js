// Pages et catégories du tutoriel. Une catégorie = une chose à faire, montrée par la flèche.
// part : { id, title, hint?, optional?, when?(d), valid?(d), invalidMsg?, body?(d, ctx) }
// ask : une seule réponse à donner, la flèche repart aussitôt.
// step.leave(d) : appelé dans le clic qui quitte la page.
// step.build(d) sert aux pages dont les catégories partagent des données : { before?, bodies: { [id]: élément } }
import { STORES, STORE_ORDER, PC_STORE_ORDER, PRIME_STORES, BUNDLE_STORES, LEVELS, INTERVALS } from '../src/config.js';
import { GENRE_BY_ID } from '../src/genres.js';
import { originsFor, requestAccess, siteName } from '../src/access.js';
import { h, toggleCard, switchRow, storeGrid, bundleSites, yesNo, choiceChips, more, genreChips, tagInput, levelCards, steamProfileField, steamSessionField, gogSessionField } from '../ui/components.js';

// Sites déjà autorisés (tenu à jour par onboarding.js) : une question ne peut pas attendre une réponse du navigateur.
export const allowed = new Set();
export const missing = (d) => originsFor(d).filter((o) => !allowed.has(o));

export const anyDeals = (d) => (d.pc && (d.pcDeals || d.bundles)) || (d.switch && d.switchDeals);
export const anyStore = (d) => PC_STORE_ORDER.some((s) => d.stores[s]) || (d.prime && PRIME_STORES.some((s) => d.stores[s]));

const freqLabel = (v) => (v < 1 ? `${Math.round(v * 60)} min` : `${v} h`);
const setStore = (d) => (id, on) => { d.stores[id] = on; };

// Estimation du nombre d'annonces avec les réglages en cours (rien n'est enregistré).
let estimateSeq = 0;
async function estimate(d, fetchMissing = false) {
  const seq = ++estimateSeq;
  const res = await chrome.runtime.sendMessage({ type: 'estimate', settings: d, fetch: fetchMissing }).catch(() => null);
  return seq === estimateSeq && !res?.error ? res : null; // une estimation plus récente est partie
}

export const STEPS = [
  {
    id: 'welcome',
    next: 'C’est parti →',
    nudge: true,
    render: () => h('div', { class: 'hero' },
      h('img', { class: 'hero-logo', src: '../icons/logo-512.png', alt: '', width: 120, height: 120 }),
      h('h1', {}, 'Bienvenue dans FreeKeep<3'),
      h('p', { class: 'lead' }, 'Suis la flèche !'),
      h('div', { class: 'features' },
        feature('🎁', 'Jeux gratuits', 'À garder à vie.'),
        feature('💸', 'Grosses promos', 'Que de bons jeux.'),
        feature('🔔', 'Alertes', 'Quand ça vaut le coup.'),
      ),
    ),
  },
  {
    id: 'platforms',
    title: 'Tes plateformes',
    parts: [
      {
        id: 'machines',
        title: 'Sur quoi tu joues ?',
        valid: (d) => d.pc || d.switch,
        invalidMsg: 'Choisis au moins une plateforme.',
        body: (d) => h('div', { class: 'tgrid' },
          toggleCard({ icon: '💻', title: 'PC', desc: 'Steam, Epic, GOG…', checked: d.pc, onChange: (v) => { d.pc = v; } }),
          toggleCard({ icon: '🎮', title: 'Nintendo Switch', desc: 'eShop, boîtes et clés', checked: d.switch, accent: '#f87171', onChange: (v) => { d.switch = v; } }),
        ),
      },
      {
        id: 'switch2',
        ask: true,
        title: 'Les jeux Switch 2 aussi ?',
        when: (d) => d.switch,
        body: (d) => yesNo({
          value: d.switch2,
          no: { desc: 'Seulement les jeux jouables sur Switch 1' },
          onChange: (v) => { d.switch2 = v; },
        }),
      },
    ],
  },
  {
    id: 'stores',
    show: (d) => d.pc,
    title: 'Tes jeux PC',
    valid: anyStore,
    invalidPart: 'stores',
    invalidMsg: 'Choisis au moins une plateforme.',
    parts: [
      {
        id: 'stores',
        title: 'Où as-tu un compte ?',
        hint: 'Décoche les autres : leurs jeux seront masqués.',
        body: (d) => [
          storeGrid(d.stores, setStore(d)),
          more('Les clés vendues par Humble, Fanatical ou Green Man Gaming s’activent presque toujours sur Steam.'),
        ],
      },
      {
        id: 'bundles',
        ask: true,
        title: 'Les bundles, ça t’intéresse ?',
        hint: 'Des packs de jeux à petit prix.',
        body: (d) => yesNo({ value: d.bundles, onChange: (v) => { d.bundles = v; } }),
      },
      {
        id: 'bundleSites',
        title: 'Quels bundles ?',
        when: (d) => d.bundles,
        body: (d) => [
          bundleSites(d, (id, on) => { d.bundleStores = { ...d.bundleStores, [id]: on }; }),
          more('Seuls ceux qui valent le coup sont montrés : jeux bien notés, grosse remise.'),
        ],
      },
      {
        id: 'prime',
        ask: true,
        title: 'Tu as Amazon Prime ?',
        hint: 'Prime (ex-Prime Gaming) offre des jeux chaque mois.',
        body: (d) => yesNo({ value: d.prime, yes: { icon: '👑' }, onChange: (v) => { d.prime = v; } }),
      },
      {
        id: 'primeStores',
        title: 'Où récupérer tes jeux Prime ?',
        when: (d) => d.prime,
        body: (d) => [
          storeGrid(d.stores, setStore(d), PRIME_STORES),
          more('Les jeux Prime à activer sur Epic Games, GOG ou le Microsoft Store suivent tes plateformes. Amazon n’a pas d’API publique : FreeKeep<3 les repère via GamerPower, LootScraper et Dealabs, il peut en manquer.'),
        ],
      },
    ],
  },
  {
    id: 'content',
    leave: (d) => requestAccess(missing(d)), // refusé ou passé : redemandé une fois au clic sur « Continuer »
    title: 'Tes envies',
    valid: (d) => (d.pc && (d.freeGames || d.pcDeals || d.bundles)) || (d.switch && d.switchDeals),
    invalidMsg: 'Active au moins une catégorie.',
    parts: [
      {
        id: 'pc',
        title: 'Sur PC, tu veux quoi ?',
        when: (d) => d.pc,
        body: (d) => h('div', { class: 'tgrid' },
          toggleCard({ icon: '🎁', title: 'Jeux gratuits', desc: 'À garder à vie', checked: d.freeGames, onChange: (v) => { d.freeGames = v; } }),
          toggleCard({ icon: '💻', title: 'Promos', desc: 'Bons jeux, grosse remise', checked: d.pcDeals, onChange: (v) => { d.pcDeals = v; } }),
        ),
      },
      {
        id: 'switch',
        title: 'Sur Switch, tu veux quoi ?',
        when: (d) => d.switch,
        body: (d) => h('div', { class: 'tgrid' },
          toggleCard({ icon: '🎮', title: 'Promos Switch', desc: 'eShop, boîtes et clés', checked: d.switchDeals, accent: '#f87171', onChange: (v) => { d.switchDeals = v; } }),
          toggleCard({ icon: '📦', title: 'Jeux en boîte', desc: 'Amazon, Fnac, Leclerc…', checked: d.physical, onChange: (v) => { d.physical = v; } }),
        ),
      },
      {
        id: 'dept',
        ask: true,
        title: 'Ton département ?',
        optional: true,
        hint: 'Pour les promos d’un seul magasin. Les offres nationales s’affichent toujours.',
        when: (d) => d.switch && d.physical,
        body: (d) => deptInput(d),
      },
      {
        id: 'keyshops',
        ask: true,
        title: 'Les sites de clés aussi ?',
        hint: 'Eneba, Instant Gaming, G2A… Moins cher, mais pas officiel.',
        body: (d) => yesNo({ value: d.keyshops, yes: { icon: '🔑' }, onChange: (v) => { d.keyshops = v; } }),
      },
      {
        id: 'access',
        title: 'Autorise la lecture de ces sites',
        hint: 'Ton navigateur va te demander confirmation.',
        when: (d) => missing(d).length > 0,
        body: (d, { changed }) => {
          const ask = () => requestAccess(missing(d)).then(changed);
          const names = () => originsFor(d).map(siteName).join(', ');
          const list = h('p', {}, names());
          return [h('button', { type: 'button', class: 'btn primary', 'data-manual': true, onclick: ask }, '🔓 Autoriser'),
            h('details', { class: 'help more', ontoggle: () => { list.textContent = names(); } }, h('summary', {}, 'Voir les sites'), list)];
        },
      },
    ],
  },
  {
    id: 'level',
    show: anyDeals,
    title: 'Combien de promos veux-tu voir ?',
    parts: [{ id: 'level', title: 'Niveau d’exigence' }],
    build: (d) => {
      const warn = h('div', { class: 'callout', hidden: true });
      let est = null;
      const refreshWarn = () => {
        const level = LEVELS[d.level] ? d.level : 'balanced';
        const n = est?.counts?.[level];
        warn.hidden = level === 'strict';
        warn.replaceChildren('⭐ ', h('strong', {}, n ? `Les ${n} meilleures annonces d’abord. ` : 'Les meilleures annonces d’abord. '),
          'Le reste attend derrière « Voir tout ». À l’étape « Ce que tu ne veux pas voir », masque les genres et licences qui ne t’intéressent pas.');
      };
      const cards = levelCards(LEVELS[d.level] ? d.level : 'balanced', (v) => { d.level = v; refreshWarn(); });
      refreshWarn();
      const wait = h('p', { class: 'note' }, '⏳ Je compte les annonces avec tes choix…');
      estimate(d, true).then((res) => {
        wait.hidden = true;
        if (!res) return;
        est = res;
        cards.setCounts(res.counts, res.recommended);
        refreshWarn();
      });
      return {
        bodies: {
          level: [cards, wait, warn,
            more('Les vieux jeux, les jeux mal notés et les petits jeux bradés passent après. Les erreurs de prix et les jeux de ta liste de souhaits sont toujours signalés, quel que soit le niveau.')],
        },
      };
    },
  },
  {
    id: 'steam',
    show: (d) => d.pc && (d.stores.steam || d.stores.gog),
    title: 'Tes bibliothèques',
    skippable: true,
    parts: [
      {
        id: 'steam',
        title: 'Tes jeux Steam',
        hint: 'Si c’est vert, rien à faire.',
        when: (d) => d.stores.steam,
        body: (d) => [
          steamSessionField(d.steamOwnedSync, (v) => { d.steamOwnedSync = v; }, { autoTest: true, brief: true }),
          more('Aucun mot de passe : il suffit d’être connecté à store.steampowered.com dans ce navigateur.'),
        ],
      },
      {
        id: 'profile',
        title: 'Ton profil Steam',
        optional: true,
        hint: 'Utile surtout pour ta liste de souhaits. Sinon, continue.',
        when: (d) => d.stores.steam,
        body: (d) => steamProfileField(d.steamProfile, (v) => { d.steamProfile = v; }, { autoTest: true, useSession: () => d.steamOwnedSync }),
      },
      {
        id: 'gog',
        title: 'Tes jeux GOG',
        hint: 'Si c’est vert, rien à faire.',
        when: (d) => d.stores.gog,
        body: (d) => [
          gogSessionField(d.gogSessionSync, (v) => { d.gogSessionSync = v; }, { autoTest: true, brief: true }),
          more('Aucun mot de passe : il suffit d’être connecté à gog.com dans ce navigateur.'),
        ],
      },
      {
        id: 'owned',
        ask: true,
        title: 'Masquer les jeux que tu as déjà ?',
        hint: 'Leurs promos n’apparaîtront plus.',
        body: (d) => yesNo({ value: d.hideOwned, yes: { icon: '🙈' }, onChange: (v) => { d.hideOwned = v; } }),
      },
      {
        id: 'wishlist',
        ask: true,
        title: 'Mettre en avant ta liste de souhaits Steam ?',
        hint: 'Alerte dès qu’un de ces jeux passe à -50 % ou plus.',
        when: (d) => d.stores.steam,
        body: (d) => yesNo({ value: d.useWishlist, yes: { icon: '❤️' }, onChange: (v) => { d.useWishlist = v; d.notifyWishlist = v; } }),
      },
    ],
  },
  {
    id: 'exclude',
    title: 'Ce que tu ne veux pas voir',
    skippable: true,
    parts: [
      { id: 'genres', title: 'Quels genres masquer ?', hint: 'Clique pour masquer.' },
      { id: 'keywords', title: 'Quelles licences bannir ?', hint: 'Clique sur une suggestion, ou tape un nom.' },
    ],
    build: (d) => {
      const total = h('div', { class: 'callout' }, '⏳ Je compte les annonces…');
      const tips = h('div', { hidden: true });
      let timer = null;
      const recount = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const res = await estimate(d);
          if (res) showTotal(res);
        }, 350);
      };
      const showTotal = (res) => {
        const many = res.many;
        total.className = many ? 'callout' : 'callout tip';
        total.replaceChildren(many ? '⚠️ ' : '✅ ', h('strong', {}, `Environ ${res.current} annonces avec tes filtres. `),
          many ? 'C’est beaucoup : les nombres indiquent combien chaque filtre en retirerait.' : 'Facile à parcourir.');
      };
      const genres = genreChips(d.excludedGenres, (v) => { d.excludedGenres = v; recount(); });
      const tagsBox = tagInput(d.bannedKeywords, (v) => { d.bannedKeywords = v; recount(); });
      (async () => {
        const res = await estimate(d, true);
        if (res) {
          showTotal(res);
          genres.setHits(res.hits.genres);
        } else total.hidden = true;
        const rec = await chrome.runtime.sendMessage({ type: 'recommend', settings: d, hits: res?.hits }).catch(() => null);
        if (!rec?.franchises) return;
        tagsBox.setSuggestions(rec.franchises);
        if (!rec.genres?.length) return;
        const names = rec.genres.map((id) => `${GENRE_BY_ID[id].emoji} ${GENRE_BY_ID[id].label}`).join(', ');
        const btn = h('button', { type: 'button', class: 'btn' }, 'Masquer ces genres');
        btn.addEventListener('click', () => { genres.exclude(rec.genres); tips.hidden = true; });
        tips.className = 'callout tip';
        tips.replaceChildren('💡 ', h('strong', {}, `D’après tes ${rec.total} jeux Steam, `), `tu n’en as presque aucun dans : ${names}.`, h('br'), btn);
        tips.hidden = false;
      })();
      return {
        before: total,
        bodies: {
          genres: [tips, genres, more('Les genres sont détectés via Steam et l’eShop Nintendo. Pour les autres jeux, FreeKeep<3 se base sur le titre.')],
          keywords: [tagsBox, h('p', { class: 'note' }, '⭐ = conseillé pour toi'), more('⭐ : tu n’as aucun jeu de cette licence sur Steam, et elle masquerait des annonces du moment.')],
        },
      };
    },
  },
  {
    id: 'alerts',
    title: 'Tes alertes',
    parts: [
      {
        id: 'notify',
        title: 'Quand te prévenir ?',
        when: (d) => (d.pc && d.freeGames) || anyDeals(d),
        body: (d) => h('div', { class: 'tgrid' },
          d.pc && d.freeGames ? [
            toggleCard({ icon: '🎁', title: 'Nouveau jeu gratuit', checked: d.notifyNew, onChange: (v) => { d.notifyNew = v; } }),
            toggleCard({ icon: '⏳', title: 'Dernier jour', desc: 'Jeu gratuit pas encore récupéré', checked: d.notifyLastDay, onChange: (v) => { d.notifyLastDay = v; } }),
          ] : null,
          anyDeals(d) ? toggleCard({ icon: '🔥', title: 'Affaires exceptionnelles', desc: 'Erreurs de prix, prix record', checked: d.notifyDeals, onChange: (v) => { d.notifyDeals = v; } }) : null,
          wishAlert(d) ? toggleCard({ icon: '❤️', title: 'Liste de souhaits en promo', checked: d.notifyWishlist, onChange: (v) => { d.notifyWishlist = v; } }) : null),
      },
      {
        id: 'freq',
        ask: true,
        title: 'Vérifier tous les combien ?',
        hint: 'Les erreurs de prix partent vite : 5 à 15 minutes.',
        body: (d) => [
          choiceChips(INTERVALS.map(([v]) => [v, freqLabel(v), v === 0.25]), d.intervalHours, (v) => { d.intervalHours = v; }),
          more('FreeKeep<3 vérifie en arrière-plan, popup fermé, tant que ton navigateur est ouvert. Hors erreurs de prix, les sources sont relues au plus toutes les 15 minutes.'),
        ],
      },
      {
        id: 'autoClick',
        ask: true,
        title: 'Cliquer sur « Obtenir » à ta place ?',
        hint: 'Expérimental : agit sur ton compte du store. Jamais d’achat payant.',
        when: (d) => d.pc && d.freeGames,
        body: (d) => yesNo({ value: d.autoClick, yes: { icon: '🖱️', desc: 'Quand tu cliques « Récupérer »' }, onChange: (v) => { d.autoClick = v; } }),
      },
    ],
  },
  {
    id: 'done',
    title: 'Tout est prêt 🎉',
    next: 'Terminer',
    nudge: true,
    render: (d) => [
      h('div', { class: 'done-box' },
        h('p', {}, '👉 Clique sur l’icône FreeKeep<3 (le cœur) en haut à droite de ton navigateur.', h('br'), 'Épingle-la via l’icône 🧩 ou l’icône des extensions.')),
      h('details', { class: 'help more' }, h('summary', {}, 'Voir mes choix'), recap(d)),
      h('p', { class: 'note' }, 'Tout se change dans ⚙ Réglages, où tu peux aussi relancer ce tutoriel.'),
    ],
  },
];

const wishAlert = (d) => d.pc && d.stores.steam && d.useWishlist;

function feature(ico, title, text) {
  return h('div', { class: 'feature' }, h('span', { class: 'ico' }, ico), h('strong', {}, title), h('small', {}, text));
}

function deptInput(d) {
  const input = h('input', { type: 'text', class: 'short', placeholder: 'ex. 80, 60', value: d.departments || '', 'data-autofocus': true, 'aria-label': 'Ton département' });
  input.addEventListener('input', () => { d.departments = input.value.trim(); });
  const ok = h('button', { type: 'button', class: 'btn', onclick: () => input.blur() }, 'OK');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
  return h('div', { class: 'inline' }, input, ok);
}

function recap(d) {
  const line = (t, v) => [h('dt', {}, t), h('dd', {}, v)];
  const stores = STORE_ORDER.filter((s) => d.stores[s] && (!PRIME_STORES.includes(s) || d.prime)).map((s) => STORES[s].short);
  const sections = [
    d.pc && d.freeGames ? 'Jeux gratuits' : null,
    d.pc && d.pcDeals ? 'Promos PC' : null,
    d.pc && d.bundles ? 'Bundles' : null,
    d.switch && d.switchDeals ? `Promos ${d.switch2 ? 'Switch + Switch 2' : 'Switch'}` : null,
  ].filter(Boolean);
  const extras = [d.physical && d.switch ? 'boîtes' : null, d.keyshops ? 'sites de clés' : null].filter(Boolean);
  return h('dl', { class: 'recap' },
    line('Plateformes', [d.pc ? 'PC' : null, d.switch ? (d.switch2 ? 'Switch + Switch 2' : 'Switch') : null].filter(Boolean).join(' · ')),
    d.pc ? line('Stores PC', stores.join(', ') || '—') : null,
    d.pc ? line('Amazon Prime', d.prime ? 'oui 👑' : 'non') : null,
    line('Sections', sections.join(' · ') || '—'),
    extras.length ? line('Inclus', extras.join(', ')) : null,
    anyDeals(d) ? line('Exigence', LEVELS[d.level]?.label || 'Personnalisé') : null,
    d.pc && d.stores.steam ? line('Bibliothèque Steam', [d.steamOwnedSync ? 'via ta session Steam' : null, d.steamProfile ? 'profil lié' : null].filter(Boolean).join(' · ') || 'non') : null,
    d.pc && d.stores.gog ? line('Bibliothèque GOG', d.gogSessionSync ? 'via ta session gog.com' : 'non') : null,
    line('Genres masqués', d.excludedGenres.map((g) => GENRE_BY_ID[g]?.label).filter(Boolean).join(', ') || 'aucun'),
    line('Licences bannies', d.bannedKeywords.join(', ') || 'aucune'),
    line('Vérification', `toutes les ${freqLabel(d.intervalHours)}`),
  );
}
