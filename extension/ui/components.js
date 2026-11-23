// Composants d'interface partagés par le tutoriel et la page de réglages.
import { STORES, PC_STORE_ORDER, LEVELS, KEYWORD_SUGGESTIONS, BUNDLE_STORES } from '../src/config.js';
import { GENRES } from '../src/genres.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// Grande carte cochable (plateformes, contenus…)
export function toggleCard({ icon, title, desc, checked, onChange, accent, disabled }) {
  const el = h('button', { type: 'button', class: `tcard${checked ? ' on' : ''}`, 'aria-pressed': String(!!checked), disabled, style: accent ? `--accent-c:${accent}` : null },
    icon ? h('span', { class: 'tcard-icon' }, icon) : null,
    h('span', { class: 'tcard-text' }, h('strong', {}, title), desc ? h('small', {}, desc) : null),
    h('span', { class: 'tcard-check', 'aria-hidden': 'true' }, '✓'),
  );
  el.addEventListener('click', () => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
  return el;
}

// Question à deux réponses. `onChange` est appelé à chaque clic, même sur la réponse déjà choisie.
export function yesNo({ value, yes = {}, no = {}, onChange }) {
  const make = (v, { icon, title, desc }) => {
    const el = h('button', { type: 'button', class: 'tcard answer', 'data-answer': v ? 'yes' : 'no' },
      h('span', { class: 'tcard-icon' }, icon),
      h('span', { class: 'tcard-text' }, h('strong', {}, title), desc ? h('small', {}, desc) : null),
      h('span', { class: 'tcard-check', 'aria-hidden': 'true' }, '✓'));
    el.addEventListener('click', () => { select(v); onChange(v); });
    return el;
  };
  const cards = new Map([[true, make(true, { icon: '👍', title: 'Oui', ...yes })], [false, make(false, { icon: '🙅', title: 'Non', ...no })]]);
  const select = (v) => cards.forEach((el, k) => {
    el.classList.toggle('on', k === v);
    el.setAttribute('aria-pressed', String(k === v));
  });
  select(value); // rien de coché tant qu'il n'y a pas de réponse
  return h('div', { class: 'tgrid' }, [...cards.values()]);
}

// Choix unique en puces. `options` = [[valeur, texte, conseillé ?]].
export function choiceChips(options, value, onChange) {
  const chips = options.map(([v, label, star]) => {
    const el = h('button', { type: 'button', class: `chip pick${v === value ? ' on' : ''}`, 'aria-pressed': String(v === value) }, `${star ? '⭐ ' : ''}${label}`);
    el.addEventListener('click', () => {
      chips.forEach((c) => { c.classList.toggle('on', c === el); c.setAttribute('aria-pressed', String(c === el)); });
      onChange(v);
    });
    return el;
  });
  return h('div', { class: 'chips' }, chips);
}

// Explication repliée : rien à lire sauf si on le demande.
export const more = (...content) => h('details', { class: 'help more' }, h('summary', {}, 'En savoir plus'), h('p', {}, ...content));

// Interrupteur compact (ligne de réglage)
export function switchRow({ title, desc, checked, onChange }) {
  const input = h('input', { type: 'checkbox', class: 'switch' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('strong', {}, title), desc ? h('small', {}, desc) : null), input);
}

export function selectRow({ title, desc, value, options, onChange }) {
  const sel = h('select', {}, options.map(([v, label]) => h('option', { value: String(v) }, label)));
  sel.value = String(value);
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('strong', {}, title), desc ? h('small', {}, desc) : null), sel);
}

const STORE_DESC = {
  battlenet: 'Blizzard, Activision',
  microsoft: 'Xbox App sur PC',
  amazon: 'Application Amazon Games',
  legacy: 'Codes Legacy Games',
  luna: 'Jeux en streaming, pas à garder',
};

export function storeGrid(stores, onChange, ids = PC_STORE_ORDER) {
  return h('div', { class: 'tgrid' },
    ids.map((id) =>
      toggleCard({
        icon: h('span', { class: 'store-dot', style: `background:${STORES[id].bg};color:${STORES[id].color}` }, STORES[id].short.slice(0, 2)),
        title: STORES[id].name,
        desc: STORE_DESC[id],
        checked: !!stores[id],
        accent: STORES[id].color,
        onChange: (on) => onChange(id, on),
      })),
  );
}

// Sites de bundles
export function bundleSites(d, onChange) {
  return h('div', { class: 'tgrid' }, Object.values(BUNDLE_STORES).map((b) =>
    toggleCard({
      icon: h('span', { class: 'store-dot', style: `background:${b.bg};color:${b.color}` }, b.short.slice(0, 2)),
      title: b.name,
      desc: b.desc,
      checked: d.bundleStores?.[b.id] !== false,
      accent: b.color,
      onChange: (on) => onChange(b.id, on),
    })));
}

// Bloc « Bundles » : oui / non, puis les sites
export function bundleBox(d, onChange) {
  const sub = h('div', { class: 'sub' },
    h('p', { class: 'note' }, 'Packs de jeux à petit prix. Seuls ceux qui valent le coup sont montrés (jeux bien notés, grosse remise).'),
    bundleSites(d, (id, on) => onChange('store', id, on)));
  sub.hidden = !d.bundles;
  return h('div', { class: 'prime-box' },
    switchRow({ title: '📚 Bundles', desc: 'Humble Bundle, Fanatical, Steam, GOG, itch.io…', checked: d.bundles, onChange: (v) => { sub.hidden = !v; onChange('bundles', v); } }),
    sub,
  );
}

// Bloc « Amazon Prime » : abonnement + plateformes propres à Prime.
// `d` = réglages en cours d'édition ; `onChange(key, value)` est appelé à chaque modification.
export function primeBox(d, onChange) {
  const sub = h('div', { class: 'sub' },
    h('p', { class: 'note' }, 'Chaque mois, Prime offre des jeux à garder. Où veux-tu les récupérer ?'),
    storeGrid(d.stores, (id, on) => onChange('store', id, on), ['amazon', 'legacy', 'luna']),
    h('p', { class: 'note' },
      'Les jeux Prime à activer sur Epic Games, GOG ou le Microsoft Store suivent tes choix de plateformes ci-dessus. ',
      'Amazon n’a pas d’API publique : FreeKeep<3 les repère via GamerPower et Dealabs, il peut en manquer.'),
  );
  sub.hidden = !d.prime;
  return h('div', { class: 'prime-box' },
    switchRow({
      title: '👑 J’ai Amazon Prime',
      desc: 'Jeux offerts chaque mois aux abonnés (ex-Prime Gaming, désormais dans Amazon Luna).',
      checked: d.prime,
      onChange: (v) => { sub.hidden = !v; onChange('prime', v); },
    }),
    sub,
  );
}

// Puces de genres : une puce active = genre EXCLU
// Renvoie un élément avec `setHits({ genre: n })` (annonces que chaque genre masquerait) et `exclude([genres])`.
export function genreChips(excluded, onChange) {
  const set = new Set(excluded);
  const chips = new Map(GENRES.map((g) => {
    const n = h('span', { class: 'n' });
    const chip = h('button', { type: 'button', class: `chip${set.has(g.id) ? ' banned' : ''}` }, `${g.emoji} ${g.label}`, n);
    chip.addEventListener('click', () => {
      if (set.has(g.id)) set.delete(g.id);
      else set.add(g.id);
      chip.classList.toggle('banned', set.has(g.id));
      onChange([...set]);
    });
    return [g.id, { chip, n }];
  }));
  const box = h('div', { class: 'chips' }, [...chips.values()].map((c) => c.chip));
  box.setHits = (hits) => { for (const [id, { n }] of chips) n.textContent = hits?.[id] ? ` ${hits[id]}` : ''; };
  box.exclude = (ids) => {
    ids.forEach((id) => { set.add(id); chips.get(id)?.chip.classList.add('banned'); });
    onChange([...set]);
  };
  return box;
}

export { KEYWORD_SUGGESTIONS };

// Saisie de mots-clés (licences à bannir)
// `setSuggestions([{ keyword, hits, owned, star }])` trie et annote les suggestions.
export function tagInput(values, onChange, suggestions = KEYWORD_SUGGESTIONS) {
  let list = [...values];
  let ranked = suggestions.map((keyword) => ({ keyword, hits: 0, owned: 0, star: false }));
  const tags = h('div', { class: 'tags' });
  const input = h('input', { type: 'text', placeholder: 'Tape un nom de licence puis Entrée (ex. Call of Duty)', class: 'tag-input', autocomplete: 'off' });
  const sugg = h('div', { class: 'sugg' });

  const commit = () => {
    onChange([...list]);
    render();
  };
  const add = (raw) => {
    const v = String(raw).trim().replace(/,$/, '').trim();
    if (!v || list.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    list.push(v);
    commit();
  };
  const render = () => {
    tags.replaceChildren(
      ...list.map((v) => h('span', { class: 'tag' }, v, h('button', { type: 'button', title: `Retirer ${v}`, onclick: () => { list = list.filter((x) => x !== v); commit(); } }, '×'))),
      input,
    );
    const left = ranked.filter((s) => !list.some((x) => x.toLowerCase() === s.keyword.toLowerCase()));
    sugg.replaceChildren(...(left.length ? [h('span', { class: 'sugg-label' }, 'Suggestions :'), ...left.map((s) => h('button', {
      type: 'button', class: `chip small${s.owned ? ' owned' : ''}`, onclick: () => add(s.keyword),
      title: s.owned ? `Tu possèdes ${s.owned} jeu${s.owned > 1 ? 'x' : ''} de cette licence` : s.hits ? `Masquerait ${s.hits} annonce${s.hits > 1 ? 's' : ''} du moment` : null,
    }, `${s.star ? '⭐' : '+'} ${s.keyword}`, s.owned ? h('span', { class: 'n' }, ` tu en as ${s.owned}`) : s.hits ? h('span', { class: 'n' }, ` ${s.hits}`) : null))] : []));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input.value);
      input.value = '';
      input.focus();
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      commit();
      input.focus();
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      add(input.value);
      input.value = '';
    }
  });
  tags.addEventListener('click', () => input.focus());
  render();
  const root = h('div', { class: 'tagbox' }, tags, sugg);
  root.setSuggestions = (r) => { ranked = r; render(); };
  return root;
}

export function levelCards(value, onChange) {
  const wrap = h('div', { class: 'tgrid three' });
  const extras = {};
  const cards = Object.entries(LEVELS).map(([id, l]) => {
    const extra = h('small', { class: 'level-extra' });
    extras[id] = extra;
    const card = h('button', { type: 'button', 'data-level': id, class: `tcard radio${value === id ? ' on' : ''}` },
      h('span', { class: 'tcard-icon' }, l.emoji),
      h('span', { class: 'tcard-text' }, h('strong', {}, l.label), h('small', {}, l.desc), extra),
      h('span', { class: 'tcard-check' }, '✓'));
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('on'));
      card.classList.add('on');
      onChange(id);
    });
    return card;
  });
  wrap.append(...cards);
  wrap.setCounts = (counts, recommended) => {
    cards.forEach((c) => c.classList.toggle('reco', c.dataset.level === recommended));
    for (const [id, el] of Object.entries(extras)) el.textContent = counts?.[id] != null ? `≈ ${counts[id]} annonces${id === recommended ? ' · ⭐ conseillé pour toi' : ''}` : '';
  };
  return wrap;
}

// Champ « lien de profil Steam » + bouton de vérification
export function steamProfileField(value, onChange, { autoTest = false, useSession = () => true, onResult = () => {} } = {}) {
  const input = h('input', { type: 'text', class: 'wide', placeholder: 'https://steamcommunity.com/id/ton-pseudo/', value: value || '', autocomplete: 'off', spellcheck: 'false' });
  const status = h('div', { class: 'status' });
  const btn = h('button', { type: 'button', class: 'btn' }, 'Vérifier');

  const test = async (manual = true) => {
    const v = input.value.trim();
    onChange(v);
    if (!v) {
      status.className = 'status';
      status.textContent = '';
      return;
    }
    btn.disabled = true;
    status.className = 'status wait';
    status.textContent = 'Lecture de tes jeux et de ta liste de souhaits…';
    const res = await chrome.runtime.sendMessage({ type: 'testSteamProfile', input: v, useSession: useSession() }).catch((e) => ({ ok: false, error: e.message }));
    btn.disabled = false;
    if (res?.ok) {
      const who = res.profileName ? `${res.profileName} : ` : '';
      const wl = res.wishlistCount == null ? 'liste de souhaits non accessible' : `${res.wishlistCount} jeu${res.wishlistCount > 1 ? 'x' : ''} en liste de souhaits`;
      onResult(!!res.count, manual);
      if (res.count) {
        status.className = 'status ok';
        status.textContent = `✔ ${who}${res.count} jeux et DLC possédés reconnus, leurs promos seront masquées · ${wl}`;
      } else {
        status.className = 'status ko';
        status.replaceChildren(`⚠ ${who}${wl}, mais tes jeux possédés n’ont pas pu être lus (${res.ownedError || 'aucun jeu'}). Steam ne les montre qu’une fois connecté : `,
          h('a', { href: 'https://store.steampowered.com/login/', target: '_blank', rel: 'noopener' }, 'connecte-toi à Steam'), ', puis clique Vérifier.');
      }
    } else {
      status.className = 'status ko';
      status.textContent = `✘ ${res?.error || 'erreur inconnue'}`;
    }
  };
  btn.addEventListener('click', () => test(true));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') test(true); });
  input.addEventListener('change', () => onChange(input.value.trim()));
  if (autoTest && value) setTimeout(() => test(false), 50);

  const help = h('details', { class: 'help' },
    h('summary', {}, 'À quoi sert ce lien ? Où le trouver ?'),
    h('ol', {},
      h('li', {}, 'Sur Steam, clique sur ton pseudo puis « Profil ». Copie l’adresse de la page (steamcommunity.com/id/… ou /profiles/…).'),
      h('li', {}, 'Ouvre ', h('a', { href: 'https://steamcommunity.com/my/edit/settings', target: '_blank', rel: 'noopener' }, 'tes paramètres de confidentialité Steam'), ' et mets « Mon profil » et « Liste de souhaits » sur Public.'),
    ),
    h('p', {}, 'Reste connecté à Steam dans ce navigateur : même pour un profil public, Steam ne montre plus la liste des jeux possédés sans connexion. Sans session, le lien permet seulement de lire ta liste de souhaits.'),
  );
  return h('div', { class: 'steam-field' }, h('div', { class: 'inline' }, input, btn), status, help);
}

// Bibliothèque lue via la session du navigateur : interrupteur + vérification.
// `brief` : sans l'explication (tutoriel, où elle est repliée).
// `onResult(ok, manual)` : résultat de la vérification (manual = clic sur le bouton).
function sessionField({ name, message, url, site, title, desc, okText }, checked, onChange, { autoTest = false, brief = false, onResult = () => {} } = {}) {
  const status = h('div', { class: 'status' });
  const btn = h('button', { type: 'button', class: 'btn' }, `Vérifier ma session ${name}`);
  const test = async (manual = true) => {
    btn.disabled = true;
    status.className = 'status wait';
    status.textContent = `Lecture de ta bibliothèque ${name}…`;
    const res = await chrome.runtime.sendMessage({ type: message }).catch((e) => ({ ok: false, error: e.message }));
    btn.disabled = false;
    onResult(!!res?.ok, manual);
    if (res?.ok) {
      status.className = 'status ok';
      status.textContent = `✔ ${okText(res)}`;
    } else {
      status.className = 'status ko';
      status.replaceChildren(`✘ ${res?.error || 'erreur inconnue'} · `,
        h('a', { href: url, target: '_blank', rel: 'noopener' }, `ouvrir ${site} pour te connecter`));
    }
  };
  btn.addEventListener('click', () => test(true));
  btn.dataset.manual = 'true'; // la vérification n'est pas une réponse : seul son résultat compte
  const actions = h('div', { class: 'inline' }, btn, status);
  actions.hidden = !checked;
  if (autoTest && checked) setTimeout(() => test(false), 50);
  return h('div', { class: 'gog-field' },
    switchRow({ title, desc: brief ? null : desc, checked, onChange: (v) => { actions.hidden = !v; onChange(v); } }),
    actions,
  );
}

export const gogSessionField = (checked, onChange, opts) => sessionField({
  name: 'GOG',
  message: 'testGogSession',
  url: 'https://www.gog.com/',
  site: 'gog.com',
  title: 'Lire mes jeux GOG via ma session gog.com',
  desc: 'Aucun mot de passe : il suffit d’être connecté à gog.com dans ce navigateur. Les jeux GOG que tu possèdes sont masqués des promos et cochés « récupérés ».',
  okText: (res) => `${res.username ? `${res.username} : ` : ''}${res.count} jeux GOG trouvés`,
}, checked, onChange, opts);

export const steamSessionField = (checked, onChange, opts) => sessionField({
  name: 'Steam',
  message: 'testSteamSession',
  url: 'https://store.steampowered.com/login/',
  site: 'Steam',
  title: 'Lire mes jeux et ma liste de souhaits via ma session Steam',
  desc: 'Aucun mot de passe : il suffit d’être connecté à store.steampowered.com dans ce navigateur. Les jeux que tu possèdes sont masqués des promos et cochés « récupérés ».',
  okText: (res) => `${res.count} jeux et DLC trouvés · ${res.wishlistCount} en liste de souhaits`,
}, checked, onChange, opts);
