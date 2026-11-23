// Déroulé du tutoriel : des pages, et dans chaque page des catégories montrées l'une après l'autre.
// Position = { step: id de la page, part: id de la catégorie (ou null),
//              seen: catégories déjà ouvertes, done: questions Oui / Non répondues ou confirmées }.
// Aucun accès à l'écran ici.

export const visibleSteps = (steps, d) => steps.filter((s) => !s.show || s.show(d));
export const visibleParts = (step, d) => (step?.parts || []).filter((p) => !p.when || p.when(d));
export const seenKey = (step, part) => `${step.id}/${part.id}`;

// Ancienne sauvegarde sans `done` : ce qui a été vu compte comme répondu.
const doneOf = (pos) => pos?.done ?? pos?.seen ?? [];

const at = (step, part, seen, done) => {
  if (!part) return { step: step.id, part: null, seen, done };
  const k = seenKey(step, part);
  return { step: step.id, part: part.id, seen: seen.includes(k) ? seen : [...seen, k], done };
};

/** Catégorie remplie : réponse valable, et pour une question, réponse donnée (ou confirmée par « Suite »). */
export const filled = (step, part, d, done) =>
  (!part.valid || part.valid(d)) && (!part.ask || part.optional || (part.key ? d[part.key] !== undefined : done.includes(seenKey(step, part))));

const ANSWER = 'Choisis une réponse.';
const unanswered = (step, part, d, done) => part.ask && !part.optional && !filled(step, { ...part, valid: null }, d, done);

const isOk = (step, part, d, seen, done) => seen.includes(seenKey(step, part)) && filled(step, part, d, done);

// Première catégorie de la page qui n'est pas encore ouverte et remplie (sinon la dernière).
const enter = (step, d, seen, done) => {
  const parts = visibleParts(step, d);
  return at(step, parts.find((p) => !isOk(step, p, d, seen, done)) || parts.at(-1), seen, done);
};

export const start = (steps, d) => enter(visibleSteps(steps, d)[0], d, [], []);

// Reprise d'un tutoriel quitté en route : même page, si elle existe encore.
export function resumeAt(steps, d, pos) {
  const step = visibleSteps(steps, d).find((s) => s.id === pos?.step);
  if (!step || !Array.isArray(pos.seen)) return start(steps, d);
  const done = doneOf(pos);
  const part = visibleParts(step, d).find((p) => p.id === pos.part);
  return part && reachable(steps, d, { ...pos, done }, part.id) ? at(step, part, pos.seen, done) : enter(step, d, pos.seen, done);
}

function locate(steps, d, pos) {
  const list = visibleSteps(steps, d);
  const i = Math.max(0, list.findIndex((s) => s.id === pos.step));
  const parts = visibleParts(list[i], d);
  return { list, i, step: list[i], parts, p: Math.max(0, parts.findIndex((x) => x.id === pos.part)), seen: pos.seen || [], done: doneOf(pos) };
}

/** Peut-on aller sur cette catégorie ? Seulement si toutes celles d'avant sont ouvertes et remplies. */
export function reachable(steps, d, pos, partId) {
  const { step, parts, seen, done } = locate(steps, d, pos);
  const j = parts.findIndex((x) => x.id === partId);
  return j >= 0 && parts.slice(0, j).every((x) => isOk(step, x, d, seen, done));
}

/** Première catégorie de la page à ouvrir ou à remplir, ou null. */
export function firstGap(steps, d, pos) {
  const { step, parts, seen, done } = locate(steps, d, pos);
  return parts.find((x) => !isOk(step, x, d, seen, done))?.id ?? null;
}

// Va sur une catégorie précise de la page (sans vérifier : voir `reachable`).
export function select(steps, d, pos, partId) {
  const { step, parts, seen, done } = locate(steps, d, pos);
  return at(step, parts.find((x) => x.id === partId) || parts[0], seen, done);
}

/** La question en cours a sa réponse (cliquée, ou confirmée avec « Suite »). */
export function answer(steps, d, pos) {
  const { step, parts, p, done } = locate(steps, d, pos);
  const part = parts[p];
  if (!part) return pos;
  const k = seenKey(step, part);
  return done.includes(k) ? { ...pos, done } : { ...pos, done: [...done, k] };
}

/** Réponse complète : la question a sa réponse, ou il n'y a plus rien à cocher. La flèche peut partir seule. */
export function complete(steps, d, pos) {
  const { step, parts, p, done } = locate(steps, d, pos);
  const part = parts[p];
  return !!part && filled(step, part, d, done) && (part.ask ? !part.optional : !!part.enough?.(d));
}

// Où la flèche doit aller ensuite dans la page : la prochaine catégorie à ouvrir ou à remplir.
// null = tout est rempli, il ne reste que le bouton.
export function follow(steps, d, pos) {
  const { step, parts, p, seen, done } = locate(steps, d, pos);
  const next = [...parts.slice(p + 1), ...parts.slice(0, p)].find((x) => !isOk(step, x, d, seen, done));
  return next ? at(step, next, seen, done) : null;
}

export function currentError(steps, d, pos) {
  const { step, parts, p, done } = locate(steps, d, pos);
  const part = parts[p];
  if (!part) return null;
  if (part.valid && !part.valid(d)) return part.invalidMsg;
  return part.key && unanswered(step, part, d, done) ? ANSWER : null;
}

// Le bouton : confirme la catégorie en cours, puis catégorie suivante, sinon page suivante.
// Renvoie { pos }, { error, pos } ou { done: true }.
export function forward(steps, d, pos, { skipPage = false } = {}) {
  if (!skipPage) {
    const error = currentError(steps, d, pos);
    if (error) return { error, pos };
    pos = answer(steps, d, pos);
    const to = follow(steps, d, pos);
    if (to) return { pos: to };
  }
  const { list, i, step, parts, seen, done } = locate(steps, d, pos);
  if (!skipPage) {
    const bad = parts.find((x) => (x.valid && !x.valid(d)) || (x.key && unanswered(step, x, d, done)));
    if (bad) return { error: bad.valid && !bad.valid(d) ? bad.invalidMsg : ANSWER, pos: at(step, bad, seen, done) };
    if (step.valid && !step.valid(d)) return { error: step.invalidMsg, pos: at(step, parts.find((x) => x.id === step.invalidPart) || parts[0], seen, done) };
  }
  return i < list.length - 1 ? { pos: enter(list[i + 1], d, seen, done) } : { done: true };
}

// Page précédente, telle qu'on l'a laissée. null = déjà au début.
export function backward(steps, d, pos) {
  const { list, i, seen, done } = locate(steps, d, pos);
  return i > 0 ? enter(list[i - 1], d, seen, done) : null;
}

export function progress(steps, d, pos) {
  const { list, i, step, parts, p, seen, done } = locate(steps, d, pos);
  const shown = parts.filter((x) => seen.includes(seenKey(step, x))).length;
  const inside = parts.length ? shown / parts.length : 1;
  const ok = (x) => isOk(step, x, d, seen, done);
  return {
    page: i + 1,
    pages: list.length,
    complete: parts.every(ok),
    // « Continuer » mène à la page suivante : tout est rempli, sauf peut-être la catégorie en cours
    last: parts.every((x, j) => j === p || ok(x)),
    ratio: (i + inside) / list.length,
  };
}
