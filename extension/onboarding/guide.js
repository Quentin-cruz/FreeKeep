// Guidage à l'écran : une question ouverte à la fois, les autres repliées, et une flèche qui montre où regarder.
import { h } from '../ui/components.js';
import { visibleParts } from './flow.js';

const ARROW = '<svg viewBox="0 0 76 56" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path class="draw" pathLength="1" d="M6 46 C 10 18, 34 8, 64 22"/><path class="draw tip" pathLength="1" d="M47 8 L 66 23 L 45 34"/></svg>';

export function arrow(className) {
  const el = h('span', { class: `arrow ${className}`, 'aria-hidden': 'true' });
  el.innerHTML = ARROW; // dessin fixe, aucune donnée extérieure
  return el;
}

// Construit les questions d'une page. `onGo(partId)` : clic sur une question repliée ; `onTouch()` : réponse modifiée.
export function buildParts(step, d, ctx, { onGo, onTouch }) {
  const built = step.build ? step.build(d, ctx) : {};
  const rows = new Map();
  const root = h('div', { class: `guide${step.parts.length === 1 ? ' single' : ''}` });
  for (const part of step.parts) {
    const num = h('span', { class: 'part-num' });
    const sum = h('span', { class: 'part-sum' });
    const head = h('button', { type: 'button', class: 'part-head', onclick: () => onGo(part.id) },
      num, h('span', { class: 'part-title' }, part.title, part.optional ? h('em', {}, 'facultatif') : null), sum);
    const inner = h('div', { class: 'part-inner' },
      part.hint ? h('p', { class: 'part-hint' }, part.hint) : null,
      part.body ? part.body(d, ctx) : built.bodies?.[part.id]);
    const body = h('div', { class: 'part-body' }, inner);
    const el = h('section', { class: 'part', 'data-part': part.id }, head, body);
    inner.addEventListener('change', onTouch);
    inner.addEventListener('click', (e) => { if (e.target.closest('button')) onTouch(); });
    rows.set(part.id, { part, el, head, body, num, sum });
    root.append(el);
  }

  const update = (activeId) => {
    const shown = visibleParts(step, d);
    const at = shown.findIndex((p) => p.id === activeId);
    for (const { part, el, head, body, num, sum } of rows.values()) {
      const i = shown.indexOf(part);
      const active = i === at;
      el.hidden = i < 0;
      el.classList.toggle('active', active);
      el.classList.toggle('past', i >= 0 && i < at);
      el.classList.toggle('next', i > at);
      body.inert = !active;
      head.setAttribute('aria-expanded', String(active));
      num.textContent = i >= 0 && i < at ? '✓' : String(i + 1);
      sum.textContent = i >= 0 && i < at ? part.summary?.(d) || '' : '';
    }
  };
  return { before: built.before, root, update, el: (id) => rows.get(id)?.el, head: (id) => rows.get(id)?.head };
}

// Flèche dans la marge de gauche, qui glisse jusqu'à la question ouverte.
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
      target = node;
      el.classList.toggle('on', !!node);
      place();
      if (!node) return;
      el.classList.remove('redraw');
      void el.offsetWidth; // relance le tracé
      el.classList.add('redraw');
    },
  };
}
