// Composants d'interface partagés par le tutoriel et la page de réglages.
import { STORES, PC_STORE_ORDER, LEVELS } from '../src/config.js';
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
export function genreChips(excluded, onChange) {
  const set = new Set(excluded);
  return h('div', { class: 'chips' },
    GENRES.map((g) => {
      const chip = h('button', { type: 'button', class: `chip${set.has(g.id) ? ' banned' : ''}` }, `${g.emoji} ${g.label}`);
      chip.addEventListener('click', () => {
        if (set.has(g.id)) set.delete(g.id);
        else set.add(g.id);
        chip.classList.toggle('banned', set.has(g.id));
        onChange([...set]);
      });
      return chip;
    }),
  );
}

export const KEYWORD_SUGGESTIONS = ['FIFA', 'EA Sports FC', 'Call of Duty', "Assassin's Creed", 'Battlefield', 'Les Sims', 'Farming Simulator', 'NBA 2K', 'Football Manager', 'Five Nights at Freddy'];

// Saisie de mots-clés (licences à bannir)
export function tagInput(values, onChange, suggestions = KEYWORD_SUGGESTIONS) {
  let list = [...values];
  const tags = h('div', { class: 'tags' });
  const input = h('input', { type: 'text', placeholder: 'Tape un nom de licence puis Entrée (ex. FIFA)', class: 'tag-input', autocomplete: 'off' });
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
    const left = suggestions.filter((s) => !list.some((x) => x.toLowerCase() === s.toLowerCase()));
    sugg.replaceChildren(...(left.length ? [h('span', { class: 'sugg-label' }, 'Suggestions :'), ...left.map((s) => h('button', { type: 'button', class: 'chip small', onclick: () => add(s) }, `+ ${s}`))] : []));
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
  return h('div', { class: 'tagbox' }, tags, sugg);
}

export function levelCards(value, onChange) {
  const wrap = h('div', { class: 'tgrid three' });
  const cards = Object.entries(LEVELS).map(([id, l]) => {
    const card = h('button', { type: 'button', class: `tcard radio${value === id ? ' on' : ''}` },
      h('span', { class: 'tcard-icon' }, l.emoji),
      h('span', { class: 'tcard-text' }, h('strong', {}, l.label), h('small', {}, l.desc)),
      h('span', { class: 'tcard-check' }, '✓'));
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('on'));
      card.classList.add('on');
      onChange(id);
    });
    return card;
  });
  wrap.append(...cards);
  return wrap;
}

// Champ « lien de profil Steam » + bouton de vérification
export function steamProfileField(value, onChange, { autoTest = false } = {}) {
  const input = h('input', { type: 'text', class: 'wide', placeholder: 'https://steamcommunity.com/id/ton-pseudo/', value: value || '', autocomplete: 'off', spellcheck: 'false' });
  const status = h('div', { class: 'status' });
  const btn = h('button', { type: 'button', class: 'btn' }, 'Vérifier');

  const test = async () => {
    const v = input.value.trim();
    onChange(v);
    if (!v) {
      status.className = 'status';
      status.textContent = '';
      return;
    }
    btn.disabled = true;
    status.className = 'status wait';
    status.textContent = 'Lecture de ton profil Steam…';
    const res = await chrome.runtime.sendMessage({ type: 'testSteamProfile', input: v }).catch((e) => ({ ok: false, error: e.message }));
    btn.disabled = false;
    if (res?.ok) {
      status.className = 'status ok';
      const wl = res.wishlistCount == null ? 'liste de souhaits non accessible' : `${res.wishlistCount} jeu${res.wishlistCount > 1 ? 'x' : ''} en liste de souhaits`;
      status.textContent = `✔ ${res.profileName ? `${res.profileName} : ` : ''}profil trouvé · ${wl}`;
    } else {
      status.className = 'status ko';
      status.textContent = `✘ ${res?.error || 'erreur inconnue'}`;
    }
  };
  btn.addEventListener('click', test);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') test(); });
  input.addEventListener('change', () => onChange(input.value.trim()));
  if (autoTest && value) setTimeout(test, 50);

  const help = h('details', { class: 'help' },
    h('summary', {}, 'À quoi sert ce lien ? Où le trouver ?'),
    h('ol', {},
      h('li', {}, 'Sur Steam, clique sur ton pseudo puis « Profil ». Copie l’adresse de la page (steamcommunity.com/id/… ou /profiles/…).'),
      h('li', {}, 'Ouvre ', h('a', { href: 'https://steamcommunity.com/my/edit/settings', target: '_blank', rel: 'noopener' }, 'tes paramètres de confidentialité Steam'), ' et mets « Mon profil » et « Liste de souhaits » sur Public.'),
    ),
    h('p', {}, 'Facultatif. Sans session Steam ouverte, il permet de lire ta liste de souhaits publique. Avec une session, il aide à reconnaître tes jeux dans les annonces Dealabs. Steam ne montre plus la liste des jeux possédés sans connexion.'),
  );
  return h('div', { class: 'steam-field' }, h('div', { class: 'inline' }, input, btn), status, help);
}

// Bibliothèque lue via la session du navigateur : interrupteur + vérification.
function sessionField({ name, message, url, site, title, desc, okText }, checked, onChange, { autoTest = false } = {}) {
  const status = h('div', { class: 'status' });
  const btn = h('button', { type: 'button', class: 'btn' }, `Vérifier ma session ${name}`);
  const test = async () => {
    btn.disabled = true;
    status.className = 'status wait';
    status.textContent = `Lecture de ta bibliothèque ${name}…`;
    const res = await chrome.runtime.sendMessage({ type: message }).catch((e) => ({ ok: false, error: e.message }));
    btn.disabled = false;
    if (res?.ok) {
      status.className = 'status ok';
      status.textContent = `✔ ${okText(res)}`;
    } else {
      status.className = 'status ko';
      status.replaceChildren(`✘ ${res?.error || 'erreur inconnue'} · `,
        h('a', { href: url, target: '_blank', rel: 'noopener' }, `ouvrir ${site} pour te connecter`));
    }
  };
  btn.addEventListener('click', test);
  const actions = h('div', { class: 'inline' }, btn, status);
  actions.hidden = !checked;
  if (autoTest && checked) setTimeout(test, 50);
  return h('div', { class: 'gog-field' },
    switchRow({ title, desc, checked, onChange: (v) => { actions.hidden = !v; onChange(v); } }),
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
