// FreeKeep — tutoriel de premier lancement (relançable depuis les réglages)
import { LEVELS, DEAL_SOURCES } from '../src/config.js';
import { getSettings, saveSettings, getDraft, saveDraft, clearDraft } from '../src/store.js';
import { h } from '../ui/components.js';
import { STEPS, allowed } from './steps.js';
import { originsFor, missingOrigins } from '../src/access.js';
import { start, resumeAt, forward, backward, follow, select, currentError, progress, visibleParts } from './flow.js';
import { arrow, buildParts, createPointer } from './guide.js';

const $ = (s) => document.querySelector(s);
// Quand la flèche passe à la suite :
const AFTER_ANSWER = 280;  // réponse unique (Oui / Non…) : juste le temps de la voir cochée
const AFTER_TOUCH = 1300;  // choix multiples : dès que tu t'arrêtes de cocher
const IDLE = 3500;         // rien touché : tout est déjà bien coché
const IDLE_ASK = 5000;     // rien répondu à une question : la réponse cochée est gardée

let draft = null;
let pos = null;
let view = null;      // page affichée : { step, guide }
let ready = false;    // la flèche montre le bouton
let finished = false;
let timer = null;
let delay = 0;
let idle = false;     // la flèche partirait d'elle-même, sans réponse donnée
let selfScroll = 0;   // jusqu'à quand la page défile d'elle-même
let base = null;      // réglages au départ, pour savoir si un brouillon est encore valable
const pointer = createPointer($('.ob-card'));
$('#btn-next').before(arrow('foot-arrow'));

const activeEl = () => view.guide?.el(pos.part);
const activePart = () => view.step.parts?.find((p) => p.id === pos.part);

function arm(ms, isIdle = false) {
  clearTimeout(timer);
  delay = ms;
  idle = isIdle;
  timer = setTimeout(moveOn, ms);
}

function disarm() {
  clearTimeout(timer);
  timer = null;
}

// La flèche glisse vers la catégorie suivante de la page ; tout est vu : elle montre le bouton.
function moveOn() {
  timer = null;
  if (document.hidden || activeEl()?.querySelector('.status.wait')) return arm(1000, idle);
  if (idle && activeEl()?.querySelector('details[open]')) return arm(1000, true); // tu lis une explication
  if (currentError(STEPS, draft, pos)) return; // il manque une réponse : elle reste là
  const to = follow(STEPS, draft, pos);
  if (to) go(to, { auto: true });
  else show(true);
}

// La flèche est soit devant une catégorie, soit devant le bouton : jamais les deux.
function show(onButton) {
  ready = onButton;
  document.body.classList.toggle('ready', ready);
  view.guide?.update(pos, ready);
  pointer.at(ready ? null : activeEl() || null);
  const p = progress(STEPS, draft, pos);
  $('#bar').style.width = `${Math.round(p.ratio * 100)}%`;
  $('#step-count').textContent = `${p.page} / ${p.pages}`;
  $('#btn-back').style.visibility = backward(STEPS, draft, pos) ? 'visible' : 'hidden';
  $('#btn-skip').hidden = !view.step.skippable;
  $('#btn-next').textContent = p.complete ? view.step.next || 'Continuer →' : 'Suite ↓';
  $('#btn-next').classList.toggle('primary', ready);
}

function showError(msg) {
  const warn = $('#invalid');
  warn.hidden = !msg;
  warn.textContent = msg ? `⚠ ${msg}` : '';
}

function touched(partId) {
  if (finished) return;
  pos = select(STEPS, draft, pos, partId);
  refreshAccess().then(() => { if (!finished) show(ready); });
  showError('');
  show(false);
  arm(activePart()?.ask ? AFTER_ANSWER : AFTER_TOUCH);
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
    onGo: (id) => { if (here()) go(select(STEPS, draft, pos, id)); },
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
  selfScroll = Date.now() + 1000;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function go(to, { error = '', auto = false } = {}) {
  disarm();
  const newPage = view?.step.id !== to.step;
  const again = newPage && !!pos && to.seen === pos.seen; // page déjà vue en entier : rien à remontrer
  pos = to;
  saveDraft({ draft, pos, base, at: Date.now() });
  if (newPage) drawPage();
  const part = activePart();
  show(!part || again);
  showError(error);
  if (!part || again) return;
  arm(part.ask ? IDLE_ASK : IDLE, true);
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
    selfScroll = Date.now() + 1000;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 330);
}

function next(opts) {
  const res = forward(STEPS, draft, pos, opts);
  if (res.done) return finish();
  // Accès aux sites : à demander dans le clic, sans attendre la réponse pour avancer.
  if (!res.error && res.pos.step !== pos.step) view.step.leave?.(draft)?.then(refreshAccess);
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
// Tant que tu t'occupes de la catégorie montrée (souris, clavier), la flèche attend.
for (const type of ['pointermove', 'keydown', 'input']) {
  $('#step').addEventListener(type, (e) => { if (timer && delay > AFTER_ANSWER && e.target.closest('.part.active')) arm(delay, idle); });
}
// … ou que tu fais défiler la page.
window.addEventListener('scroll', () => { if (timer && idle && Date.now() > selfScroll) arm(Math.max(delay, IDLE), true); }, { passive: true });

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
