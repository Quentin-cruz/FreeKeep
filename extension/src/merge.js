// Fusionne les résultats des différentes sources et supprime les doublons.
import { normTitle, titlesMatch } from './util.js';

export function effectiveStatus(item, now = Date.now()) {
  if (item.status === 'upcoming' && item.start && item.start <= now) return 'active';
  return item.status;
}

// `lists` est ordonné par priorité : sources officielles d'abord, agrégateur ensuite.
export function mergeGames(lists, now = Date.now()) {
  const merged = [];

  for (const item of lists.flat()) {
    if (!item?.title || !item.store) continue;
    if (item.end && item.end <= now) continue;
    const norm = normTitle(item.title);
    if (!norm) continue;
    const key = `${item.store}:${norm}`;
    const status = effectiveStatus(item, now);

    const g = merged.find(
      (m) =>
        m.store === item.store &&
        ((m.appid && item.appid && m.appid === item.appid) || m._titles.some((t) => titlesMatch(t, item.title))),
    );

    if (!g) {
      merged.push({
        key,
        keys: [key],
        store: item.store,
        title: item.title,
        url: item.url,
        images: [...(item.images || [])],
        start: item.start ?? null,
        end: item.end ?? null,
        status,
        worth: item.worth ?? null,
        appid: item.appid ?? null,
        slug: item.slug ?? null,
        description: item.description || '',
        sources: [item.source],
        via: item.via || null,
        prime: !!item.prime,
        cloud: !!item.cloud,
        _titles: [item.title],
      });
      continue;
    }

    if (!g.keys.includes(key)) g.keys.push(key);
    if (!g._titles.includes(item.title)) g._titles.push(item.title);
    if (!g.sources.includes(item.source)) g.sources.push(item.source);
    for (const img of item.images || []) if (!g.images.includes(img)) g.images.push(img);
    if (g.end == null && item.end != null) g.end = item.end;
    if (g.start == null && item.start != null) g.start = item.start;
    if (!g.worth && item.worth) g.worth = item.worth;
    if (!g.appid && item.appid) g.appid = item.appid;
    if (!g.slug && item.slug) g.slug = item.slug;
    if (!g.description && item.description) g.description = item.description;
    if (!g.via && item.via) g.via = item.via;
    if (item.prime) g.prime = true;
    if (status === 'active' && g.status !== 'active') {
      g.status = 'active';
      if (item.end != null) g.end = item.end;
    }
  }

  return merged
    .map(({ _titles, ...g }) => g)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      if (a.status === 'upcoming') return (a.start ?? Infinity) - (b.start ?? Infinity);
      return (a.end ?? Infinity) - (b.end ?? Infinity);
    });
}
