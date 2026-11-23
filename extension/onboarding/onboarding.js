// FreeKeep — tutoriel de premier lancement (relançable depuis les réglages)
import { LEVELS, DEAL_SOURCES } from '../src/config.js';
import { getSettings, saveSettings, getDraft, saveDraft, clearDraft } from '../src/store.js';
import { h } from '../ui/components.js';
import { STEPS, allowed } from './steps.js';
import { originsFor, missingOrigins } from '../src/access.js';
import { start, resumeAt, forward, backward, follow, select, answer, complete, reachable, firstGap, currentError, progress, visibleParts, seenKey } from './flow.js';
import { arrow, buildParts, createPointer } from './guide.js';

const $ = (s) => document.querySelector(s);
// La flèche ne part jamais sur un minuteur. Elle passe à la suite quand :
//  - la réponse est complète (Oui / Non cliqué, ou plus rien à cocher) : juste le temps de la voir cochée ;
//  - le curseur descend sur la catégorie suivante, ou sur le bouton ;
//  - tu cliques « Suite » ou appuies sur Entrée.
// Une catégorie ne s'ouvre que si celles d'avant sont remplies.
// La flèche ne remonte jamais : modifier une réponse plus haut la laisse où elle est.
const AFTER_ANSWER = 280;
const HOVER = 120; // le curseur ne fait que passer : on n'y va pas

let draft = null;
let pos = null;
let view = null;      // page affichée : { step, guide }
let ready = false;    // la flèche montre le bouton
let finished = false;
let timer = null;
let hoverTimer = null;
let base = null;      // réglages au départ, pour savoir si un brouillon est encore valable
const pointer = createPointer($('.ob-card'));
$('#btn-next').before(arrow('foot-arrow'));

const activeEl = () => view.guide?.el(pos.part);
const activePart = () => view.step.parts?.find((p) => p.id === pos.part);

function arm(ms) {
  clearTimeout(timer);
  timer = setTimeout(moveOn, ms);
}

function disarm() {
  clearTimeout(timer);
  timer = null;
}

// La flèche glisse vers la catégorie suivante de la page ; tout est vu : elle montre le bouton.
function moveOn() {
  timer = null;
  if (activeEl()?.querySelector('.status.wait')) return arm(1000); // vérification en cours
  if (currentError(STEPS, draft, pos)) return; // il manque une réponse : elle reste là
  const to = follow(STEPS, draft, pos);
  if (to) go(to, { auto: true });
  else show(true);
}

// La flèche est soit devant une catégorie, soit devant le bouton : jamais les deux.
function show(onButton) {
  ready = onButton;
  document.body.classList.toggle('ready', ready);
  view.guide?.update(pos, ready, (id) => reachable(STEPS, draft, pos, id));
  pointer.at(ready ? null : activeEl() || null);
  const p = progress(STEPS, draft, pos);
  $('#bar').style.width = `${Math.round(p.ratio * 100)}%`;
  $('#step-count').textContent = `${p.page} / ${p.pages}`;
  $('#btn-back').style.visibility = backward(STEPS, draft, pos) ? 'visible' : 'hidden';
  $('#btn-skip').hidden = !view.step.skippable;
  $('#btn-next').textContent = p.complete || p.last ? view.step.next || 'Continuer →' : 'Suite ↓';
  $('#btn-next').classList.toggle('primary', ready);
}

function showError(msg) {
  const warn = $('#invalid');
  warn.hidden = !msg;
  warn.textContent = msg ? `⚠ ${msg}` : '';
}

// Rang d'une catégorie dans la page, et « plus bas que la flèche »
const rank = (id) => visibleParts(view.step, draft).findIndex((p) => p.id === id);
const below = (id) => !ready && rank(id) > rank(pos.part);

// Catégories apparues au-dessus de la flèche (réponse modifiée plus haut) : elles s'ouvrent sur place,
// avec la réponse affichée, et la flèche ne remonte pas les chercher.
function openAbove(p) {
  const shown = visibleParts(view.step, draft);
  const limit = ready ? shown.length : rank(p.part);
  const keys = shown.slice(0, limit).map((x) => seenKey(view.step, x));
  return { ...p, seen: [...new Set([...p.seen, ...keys])], done: [...new Set([...(p.done || []), ...keys])] };
}

function touched(partId) {
  if (finished) return;
  if (partId === pos.part && !ready) {
    if (activePart()?.ask) pos = answer(STEPS, draft, pos);
  } else if (below(partId)) {
    pos = select(STEPS, draft, pos, partId);
    if (activePart()?.ask) pos = answer(STEPS, draft, pos);
  } else {
    // Plus haut que la flèche : la réponse compte, la flèche reste
    const there = select(STEPS, draft, pos, partId);
    const marked = view.step.parts.find((p) => p.id === partId)?.ask ? answer(STEPS, draft, there) : there;
    pos = openAbove({ ...pos, seen: marked.seen, done: marked.done });
    saveDraft({ draft, pos, base, at: Date.now() });
    refreshAccess().then(() => { if (!finished) show(ready); });
    showError('');
    show(ready);
    return;
  }
  pos = openAbove(pos);
  saveDraft({ draft, pos, base, at: Date.now() });
  refreshAccess().then(() => { if (!finished) show(ready); });
  showError('');
  show(false);
  if (complete(STEPS, draft, pos)) arm(AFTER_ANSWER);
  else disarm();
}

// Il faut d'abord finir une catégorie : elle se secoue, la flèche ne bouge pas.
function nudge(partId = firstGap(STEPS, draft, pos) || pos.part) {
  const el = view.guide?.el(partId);
  if (!el) return;
  el.classList.remove('nudge');
  void el.offsetWidth;
  el.classList.add('nudge');
}

// Le curseur passe sur une catégorie : la flèche le suit, sans jamais sauter une catégorie à remplir.
function pointTo(partId) {
  if (finished || !view.guide || !view.step.parts.some((p) => p.id === partId)) return;
  if (!below(partId)) return; // plus haut : la flèche ne remonte pas
  // Verrouillée : le curseur « interdit » suffit, rien ne bouge
  if (!reachable(STEPS, draft, pos, partId)) return false;
  go(select(STEPS, draft, pos, partId), { hover: true });
}

// … ou sur le bouton : seulement quand toute la page est remplie.
function pointToButton() {
  if (finished || ready || !view.guide) return;
  if (currentError(STEPS, draft, pos)) return nudge();
  const p = progress(STEPS, draft, pos);
  if (!p.complete) return nudge();
  disarm();
  show(true);
}

// Sites autorisés avec les choix en cours
async function refreshAccess() {
  const missing = await missingOrigins(draft);
  allowed.clear();
  for (const o of originsFor(draft)) if (!missing.includes(o)) allowed.add(o);
}

// La catégorie en cours a pu disparaître (plus rien à autoriser) : on repart de la dernière affichée.
function settled() {
  const shown = visibleParts(view.step, draft);
  if (!shown.some((p) => p.id === pos.part)) pos = { ...pos, part: shown.at(-1).id };
  moveOn();
}

function drawPage() {
  const step = STEPS.find((s) => s.id === pos.step);
  const here = () => pos.step === step.id;
  const guide = step.parts ? buildParts(step, draft, {
    onGo: (id) => {
      if (!here() || !below(id)) return; // plus haut : déjà ouverte, la flèche reste
      if (reachable(STEPS, draft, pos, id)) go(select(STEPS, draft, pos, id));
      else nudge();
    },
    onTouch: (id) => { if (here()) touched(id); },
    changed: async () => { await refreshAccess(); if (here()) settled(); },
  }) : null;
  view = { step, guide };
  const box = $('#step');
  box.replaceChildren(...[
    step.title ? h('h1', {}, step.title) : null,
    guide ? [guide.before, guide.root] : step.render(draft),
  ].flat(Infinity).filter(Boolean));
  document.body.dataset.step = step.id;
  box.classList.remove('enter');
  void box.offsetWidth; // relance l'animation d'entrée
  box.classList.add('enter');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function go(to, { error = '', auto = false, hover = false } = {}) {
  disarm();
  const newPage = view?.step.id !== to.step;
  const again = newPage && !!pos && to.seen === pos.seen; // page déjà vue en entier : rien à remontrer
  pos = to;
  saveDraft({ draft, pos, base, at: Date.now() });
  if (newPage) drawPage();
  const part = activePart();
  show(!part || again);
  showError(error);
  if (!part || again || hover) return; // au survol : ni focus, ni défilement, le curseur y est déjà
  const el = activeEl();
  // Le focus suit la flèche : Entrée continue, et un lecteur d'écran lit la question.
  // Jamais pendant une saisie : on ne coupe pas quelqu'un qui tape.
  if (!auto || !document.activeElement?.matches('input[type="text"], textarea, select')) {
    (el.querySelector('[data-autofocus]') || view.guide.head(pos.part)).focus({ preventScroll: true });
  }
  // L'ouverture change la hauteur : on attend la fin du mouvement pour cadrer.
  if (newPage) return;
  setTimeout(() => {
    if (!el.classList.contains('active')) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 330);
}

function next(opts) {
  const res = forward(STEPS, draft, pos, opts);
  if (res.done) return finish();
  // Accès aux sites : à demander dans le clic, sans attendre la réponse pour avancer.
  if (!res.error && res.pos.step !== pos.step) view.step.leave?.(draft)?.then(refreshAccess);
  // Problème plus haut dans la page : la catégorie se secoue avec le message, la flèche ne remonte pas
  if (res.pos.step === pos.step && res.pos.part !== pos.part && !below(res.pos.part)) {
    showError(res.error || `Termine d’abord « ${view.step.parts.find((p) => p.id === res.pos.part)?.title || 'cette catégorie'} ».`);
    return nudge(res.pos.part);
  }
  go(res.pos, { error: res.error });
}

async function finish() {
  const btn = $('#btn-next');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  finished = true;
  disarm();
  document.body.classList.remove('ready');
  btn.classList.add('primary');
  draft.onboarded = true;
  try {
    await saveSettings(draft);
  } catch (e) {
    finished = false;
    btn.disabled = false;
    show(true);
    showError(`Réglages non enregistrés : ${e.message}`);
    return;
  }
  await clearDraft();
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
  document.body.classList.add('saved');
  const box = document.querySelector('.done-box');
  if (box) box.prepend(h('p', { style: 'font-weight:700;color:var(--accent);margin-bottom:6px' }, '✔ Configuration enregistrée. FreeKeep<3 lance sa première vérification.'));
}

$('#btn-next').addEventListener('click', () => { if (!finished) next(); });
$('#btn-skip').addEventListener('click', () => next({ skipPage: true }));
$('#btn-back').addEventListener('click', () => { const to = backward(STEPS, draft, pos); if (to) go(to); });
document.addEventListener('keydown', (e) => {
  if (finished || e.key !== 'Enter') return;
  // Sur le titre de la catégorie en cours, Entrée continue ; ailleurs, les champs et boutons gardent leur rôle.
  if (e.target.matches('.part.active > .part-head')) {
    e.preventDefault();
    next();
  } else if (!['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(e.target.tagName)) next();
});
// La flèche suit le curseur d'une catégorie à l'autre, et jusqu'au bouton.
// Seulement quand la souris bouge vraiment et entre dans une autre zone : une page qui change ou défile
// sous une souris immobile ne déplace rien, et bouger dans la catégorie qu'on vient de quitter non plus.
let under = null;
document.addEventListener('pointermove', (e) => {
  if (!e.movementX && !e.movementY) return;
  const zone = e.target.closest('#btn-next') ? 'button' : e.target.closest('#step .part')?.dataset.part || null;
  if (zone === under) return;
  under = zone;
  clearTimeout(hoverTimer);
  if (zone === 'button') hoverTimer = setTimeout(pointToButton, HOVER);
  // Catégorie verrouillée : on réessaiera au prochain mouvement (elle a pu s'ouvrir entre-temps)
  else if (zone) hoverTimer = setTimeout(() => { if (pointTo(zone) === false) under = null; }, HOVER);
});

(async () => {
  const settings = await getSettings();
  base = JSON.stringify(settings);
  // Tutoriel quitté en route : on reprend où tu en étais, sauf si les réglages ont changé depuis.
  const saved = await getDraft();
  const resume = saved?.base === base && saved.draft ? saved : null;
  draft = structuredClone(resume?.draft || settings);
  if (!LEVELS[draft.level]) draft.level = 'balanced';
  draft.excludedGenres = [...(draft.excludedGenres || [])];
  draft.bannedKeywords = [...(draft.bannedKeywords || [])];
  await refreshAccess();
  go(resume ? resumeAt(STEPS, draft, resume.pos) : start(STEPS, draft));
})();
