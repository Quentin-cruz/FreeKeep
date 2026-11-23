// Guidage à l'écran : une flèche qui glisse d'une catégorie à la suivante ; chacune s'ouvre quand elle arrive.
import { h } from '../ui/components.js';
import { visibleParts, seenKey } from './flow.js';

const ARROW = '<svg viewBox="0 0 76 56" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path class="draw" pathLength="1" d="M6 46 C 10 18, 34 8, 64 22"/><path class="draw tip" pathLength="1" d="M47 8 L 66 23 L 45 34"/></svg>';

export function arrow(className) {
  const el = h('span', { class: `arrow ${className}`, 'aria-hidden': 'true' });
  el.innerHTML = ARROW; // dessin fixe, aucune donnée extérieure
  return el;
}

// Construit les catégories d'une page. `onGo(partId)` : clic sur un titre ; `onTouch(partId)` : réponse modifiée ;
// `onDone(partId)` : la catégorie est validée (bouton OK, vérification réussie) ; `refresh()` : redessine.
export function buildParts(step, d, { onGo, onTouch, onDone, changed, refresh }) {
  const built = step.build ? step.build(d) : {};
  const rows = new Map();
  const root = h('div', { class: `guide${step.parts.length === 1 ? ' single' : ''}` });
  for (const part of step.parts) {
    const num = h('span', { class: 'part-num' });
    const head = h('button', { type: 'button', class: 'part-head', onclick: () => onGo(part.id) },
      num, h('span', { class: 'part-title' }, part.title, part.optional ? h('em', {}, 'facultatif') : null));
    const inner = h('div', { class: 'part-inner' },
      part.hint ? h('p', { class: 'part-hint' }, part.hint) : null,
      part.body ? part.body(d, { changed, refresh, done: () => onDone(part.id) }) : built.bodies?.[part.id]);
    const body = h('div', { class: 'part-body' }, inner);
    const el = h('section', { class: 'part', 'data-part': part.id }, head, body);
    inner.addEventListener('change', () => onTouch(part.id));
    inner.addEventListener('click', (e) => { if (e.target.closest('button:not([data-manual])')) onTouch(part.id); });
    rows.set(part.id, { part, el, head, body, num });
    root.append(el);
  }

  // Ce qui a été montré reste ouvert (rien ne bouge sous la souris) ; la suite n'est qu'un titre.
  // `canReach(id)` : catégorie accessible (celles d'avant sont remplies) ; sinon elle reste verrouillée.
  const update = (pos, ready, canReach = () => true) => {
    const shown = visibleParts(step, d);
    for (const { part, el, head, body, num } of rows.values()) {
      const i = shown.indexOf(part);
      const active = part.id === pos.part;
      const open = pos.seen.includes(seenKey(step, part));
      el.hidden = i < 0;
      el.classList.toggle('active', active);
      el.classList.toggle('open', open);
      el.classList.toggle('locked', i >= 0 && !active && !canReach(part.id));
      body.inert = !open;
      head.setAttribute('aria-expanded', String(open));
      num.textContent = open && (!active || ready) ? '✓' : String(i + 1);
    }
  };
  return { before: built.before, root, update, el: (id) => rows.get(id)?.el, head: (id) => rows.get(id)?.head };
}

// Flèche dans la marge de gauche, qui glisse jusqu'à la catégorie en cours.
export function createPointer(card) {
  const el = arrow('pointer');
  card.append(el);
  let target = null;
  const place = () => {
    if (!target?.isConnected) return;
    const top = target.getBoundingClientRect().top - card.getBoundingClientRect().top;
    el.style.transform = `translateY(${Math.round(top + 9)}px)`;
  };
  const watch = new ResizeObserver(place);
  watch.observe(card);
  return {
    at(node) {
      const moved = node !== target;
      target = node;
      el.classList.toggle('on', !!node);
      place();
      if (!node || !moved) return;
      el.classList.remove('redraw');
      void el.offsetWidth; // relance le tracé
      el.classList.add('redraw');
    },
  };
}
