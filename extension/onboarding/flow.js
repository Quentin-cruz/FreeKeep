// Déroulé du tutoriel : des pages, et dans chaque page des catégories montrées l'une après l'autre.
// Position = { step: id de la page, part: id de la catégorie (ou null), seen: catégories déjà montrées }.
// Aucun accès à l'écran ici.

export const visibleSteps = (steps, d) => steps.filter((s) => !s.show || s.show(d));
export const visibleParts = (step, d) => (step?.parts || []).filter((p) => !p.when || p.when(d));
export const seenKey = (step, part) => `${step.id}/${part.id}`;

const at = (step, part, seen) => {
  if (!part) return { step: step.id, part: null, seen };
  const k = seenKey(step, part);
  return { step: step.id, part: part.id, seen: seen.includes(k) ? seen : [...seen, k] };
};

const enter = (step, d, seen) => {
  const parts = visibleParts(step, d);
  return at(step, parts.find((p) => !seen.includes(seenKey(step, p))) || parts.at(-1), seen);
};

export const start = (steps, d) => enter(visibleSteps(steps, d)[0], d, []);

// Reprise d'un tutoriel quitté en route : même page, si elle existe encore.
export function resumeAt(steps, d, pos) {
  const step = visibleSteps(steps, d).find((s) => s.id === pos?.step);
  if (!step || !Array.isArray(pos.seen)) return start(steps, d);
  const part = visibleParts(step, d).find((p) => p.id === pos.part);
  return part ? at(step, part, pos.seen) : enter(step, d, pos.seen);
}

function locate(steps, d, pos) {
  const list = visibleSteps(steps, d);
  const i = Math.max(0, list.findIndex((s) => s.id === pos.step));
  const parts = visibleParts(list[i], d);
  return { list, i, step: list[i], parts, p: Math.max(0, parts.findIndex((x) => x.id === pos.part)), seen: pos.seen || [] };
}

// Va sur une catégorie précise de la page.
export function select(steps, d, pos, partId) {
  const { step, parts, seen } = locate(steps, d, pos);
  return at(step, parts.find((x) => x.id === partId) || parts[0], seen);
}

// Où la flèche doit aller ensuite dans la page : la prochaine catégorie pas encore montrée
// (sinon une sautée plus haut). null = tout est vu, il ne reste que le bouton.
export function follow(steps, d, pos) {
  const { step, parts, p, seen } = locate(steps, d, pos);
  const next = [...parts.slice(p + 1), ...parts.slice(0, p)].find((x) => !seen.includes(seenKey(step, x)));
  return next ? at(step, next, seen) : null;
}

export function currentError(steps, d, pos) {
  const { parts, p } = locate(steps, d, pos);
  return parts[p]?.valid && !parts[p].valid(d) ? parts[p].invalidMsg : null;
}

// Le bouton : catégorie suivante, sinon page suivante. Renvoie { pos }, { error, pos } ou { done: true }.
export function forward(steps, d, pos, { skipPage = false } = {}) {
  const { list, i, step, parts, seen } = locate(steps, d, pos);
  if (!skipPage) {
    const error = currentError(steps, d, pos);
    if (error) return { error, pos };
    const to = follow(steps, d, pos);
    if (to) return { pos: to };
    const bad = parts.find((x) => x.valid && !x.valid(d));
    if (bad) return { error: bad.invalidMsg, pos: at(step, bad, seen) };
    if (step.valid && !step.valid(d)) return { error: step.invalidMsg, pos: at(step, parts.find((x) => x.id === step.invalidPart) || parts[0], seen) };
  }
  return i < list.length - 1 ? { pos: enter(list[i + 1], d, seen) } : { done: true };
}

// Page précédente, telle qu'on l'a laissée. null = déjà au début.
export function backward(steps, d, pos) {
  const { list, i, seen } = locate(steps, d, pos);
  return i > 0 ? enter(list[i - 1], d, seen) : null;
}

export function progress(steps, d, pos) {
  const { list, i, step, parts, seen } = locate(steps, d, pos);
  const done = parts.filter((x) => seen.includes(seenKey(step, x))).length;
  const inside = parts.length ? done / parts.length : 1;
  return { page: i + 1, pages: list.length, complete: done === parts.length, ratio: (i + inside) / list.length };
}
