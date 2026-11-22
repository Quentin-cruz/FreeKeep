// FreeKeep — tutoriel de premier lancement (relançable depuis les réglages)
import { LEVELS, DEAL_SOURCES } from '../src/config.js';
import { getSettings, saveSettings } from '../src/store.js';
import { h } from '../ui/components.js';
import { STEPS } from './steps.js';
import { start, forward, backward, progress } from './flow.js';
import { arrow, buildParts, createPointer } from './guide.js';

const $ = (s) => document.querySelector(s);
const AUTO_DELAY = 280;    // laisse voir la réponse cochée avant de passer à la suite
const NUDGE_DELAY = 4500;  // sans action (tout est déjà bien coché), la flèche montre le bouton

let draft = null;
let pos = null;
let view = null;      // page affichée : { step, guide }
let finished = false;
let autoTimer = null;
let nudgeTimer = null;
const pointer = createPointer($('.ob-card'));
$('#btn-next').before(arrow('foot-arrow'));

const stepOf = (id) => STEPS.find((s) => s.id === id);

// La flèche est soit devant la question, soit devant le bouton : jamais les deux.
function nudge(on) {
  clearTimeout(nudgeTimer);
  $('.ob-foot').classList.toggle('ready', on);
  const part = view.guide?.el(pos.part);
  pointer.at(on || !part ? null : part);
  if (!on && part) nudgeTimer = setTimeout(() => nudge(true), NUDGE_DELAY);
}

function showError(msg) {
  const warn = $('#invalid');
  warn.hidden = !msg;
  warn.textContent = msg ? `⚠ ${msg}` : '';
}

function updateChrome() {
  const p = progress(STEPS, draft, pos);
  $('#bar').style.width = `${Math.round(p.ratio * 100)}%`;
  $('#step-count').textContent = `${p.page} / ${p.pages}`;
  $('#btn-back').style.visibility = backward(STEPS, draft, pos) ? 'visible' : 'hidden';
  $('#btn-skip').hidden = !view.step.skippable;
  $('#btn-next').textContent = p.lastPart ? view.step.next || 'Suivant →' : 'Continuer ↓';
}

function touched() {
  if (finished) return;
  showError('');
  view.guide.update(pos.part);
  updateChrome();
  const part = view.step.parts.find((p) => p.id === pos.part);
  nudge(!part?.valid || part.valid(draft));
}

function drawPage() {
  const step = stepOf(pos.step);
  const ctx = {
    advance: () => {
      clearTimeout(autoTimer);
      const from = pos;
      autoTimer = setTimeout(() => { if (pos === from) next(); }, AUTO_DELAY);
    },
  };
  const guide = step.parts ? buildParts(step, draft, ctx, { onGo: (part) => go({ step: step.id, part }), onTouch: () => { if (pos.step === step.id) touched(); } }) : null;
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

function go(to, { error = '' } = {}) {
  clearTimeout(autoTimer);
  const newPage = view?.step.id !== to.step;
  pos = to;
  if (newPage) drawPage();
  view.guide?.update(pos.part);
  updateChrome();
  showError(error);
  nudge(!!view.step.nudge);
  const el = view.guide?.el(pos.part);
  if (!el) return;
  // Le focus suit la question : Entrée continue, et un lecteur d'écran lit la question.
  (el.querySelector('[data-autofocus]') || view.guide.head(pos.part)).focus({ preventScroll: true });
  // Les réponses repliées changent la hauteur : on attend la fin du mouvement pour cadrer.
  if (!newPage) setTimeout(() => { if (el.classList.contains('active')) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 330);
}

function next(opts) {
  const res = forward(STEPS, draft, pos, opts);
  if (res.done) return finish();
  go(res.pos, { error: res.error });
}

async function finish() {
  const btn = $('#btn-next');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  finished = true;
  nudge(false);
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
  document.body.classList.add('saved');
  const box = document.querySelector('.done-box');
  if (box) box.prepend(h('p', { style: 'font-weight:700;color:var(--accent);margin-bottom:6px' }, '✔ Configuration enregistrée. FreeKeep<3 lance sa première vérification.'));
}

$('#btn-next').addEventListener('click', () => { if (!finished) next(); });
$('#btn-skip').addEventListener('click', () => next({ skipPage: true }));
$('#btn-back').addEventListener('click', () => { const to = backward(STEPS, draft, pos); if (to) go(to); });
document.addEventListener('keydown', (e) => {
  if (finished || e.key !== 'Enter') return;
  const el = document.activeElement;
  // Sur le titre de la question ouverte, Entrée continue ; ailleurs, les boutons gardent leur rôle.
  if (el?.matches('.part.active > .part-head')) {
    e.preventDefault();
    next();
  } else if (!['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(el?.tagName)) next();
});

(async () => {
  draft = structuredClone(await getSettings());
  if (!LEVELS[draft.level]) draft.level = 'balanced';
  draft.excludedGenres = [...(draft.excludedGenres || [])];
  draft.bannedKeywords = [...(draft.bannedKeywords || [])];
  go(start(STEPS, draft));
})();
