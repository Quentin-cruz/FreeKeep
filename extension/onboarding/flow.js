// Déroulé du tutoriel : des pages, et dans chaque page des questions posées une par une.
// Position = { step: id de la page, part: id de la question (ou null) }. Aucun accès à l'écran ici.

export const visibleSteps = (steps, d) => steps.filter((s) => !s.show || s.show(d));
export const visibleParts = (step, d) => (step?.parts || []).filter((p) => !p.when || p.when(d));

const enter = (step, d, last = false) => {
  const parts = visibleParts(step, d);
  return { step: step.id, part: parts.length ? parts[last ? parts.length - 1 : 0].id : null };
};

export const start = (steps, d) => enter(visibleSteps(steps, d)[0], d);

function locate(steps, d, pos) {
  const list = visibleSteps(steps, d);
  const i = Math.max(0, list.findIndex((s) => s.id === pos.step));
  const parts = visibleParts(list[i], d);
  return { list, i, step: list[i], parts, p: Math.max(0, parts.findIndex((x) => x.id === pos.part)) };
}

// Question suivante, sinon page suivante. Renvoie { pos }, { error, pos } ou { done: true }.
export function forward(steps, d, pos, { skipPage = false } = {}) {
  const { list, i, step, parts, p } = locate(steps, d, pos);
  if (!skipPage) {
    const part = parts[p];
    if (part?.valid && !part.valid(d)) return { error: part.invalidMsg, pos };
    if (p < parts.length - 1) return { pos: { step: step.id, part: parts[p + 1].id } };
    if (step.valid && !step.valid(d)) {
      const back = parts.find((x) => x.id === step.invalidPart) || parts[0];
      return { error: step.invalidMsg, pos: { step: step.id, part: back?.id ?? null } };
    }
  }
  return i < list.length - 1 ? { pos: enter(list[i + 1], d) } : { done: true };
}

// Question précédente, sinon dernière question de la page précédente. null = déjà au début.
export function backward(steps, d, pos) {
  const { list, i, step, parts, p } = locate(steps, d, pos);
  if (p > 0) return { step: step.id, part: parts[p - 1].id };
  return i > 0 ? enter(list[i - 1], d, true) : null;
}

export function progress(steps, d, pos) {
  const { list, i, parts, p } = locate(steps, d, pos);
  const inside = parts.length ? (p + 1) / parts.length : 1;
  return { page: i + 1, pages: list.length, lastPart: p >= parts.length - 1, ratio: (i + inside) / list.length };
}
