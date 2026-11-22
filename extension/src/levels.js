// Niveau d'exigence : les sources sont lues au plus large, puis triées ici.
// Changer de niveau est donc immédiat, et le tutoriel peut dire combien d'annonces chaque niveau donnerait.

// Seuils les plus larges qu'on puisse choisir (y compris dans les réglages avancés).
export const WIDEST = { level: 'wide', pcMinDiscount: 40, gemMinDiscount: 40, gemMinRating: 80, switchMinDiscount: 20 };

// Nombre de jeux vraiment appréciés pour qu'un bundle vaille le coup.
export const MIN_GOOD = { strict: 6, balanced: 3, wide: 2, custom: 3 };

const launcherMin = (s) => (s.level === 'strict' ? s.pcMinDiscount : Math.max(40, s.pcMinDiscount - 10));

/** Une offre CheapShark passe-t-elle les critères ? → { aaa, gem } ou null */
export function cheapSharkTier({ normal, meta, steam, count }, discount, platform, s) {
  if (normal >= 29 && discount >= s.pcMinDiscount && (meta >= 75 || (steam >= 80 && count >= 2000))) return { aaa: true, gem: false };
  if (normal >= 9.99 && steam >= s.gemMinRating && count >= 3000 && discount >= s.gemMinDiscount) return { aaa: false, gem: true };
  // Launchers moins fournis que Steam : critères un peu plus souples, toujours sur de bons jeux.
  if (s.level !== 'strict' && ['epic', 'ubisoft'].includes(platform) && normal >= 14.99 && discount >= launcherMin(s) && (meta >= 72 || (steam >= 75 && count >= 500))) return { aaa: false, gem: false };
  return null;
}

/** Garde ce qui correspond au niveau choisi. Les éléments sont modifiés : passer des copies. */
export function keepAtLevel(items, s) {
  return items.filter((d) => {
    if (d.flags?.wishlist) return true;
    const discount = d.discount ?? 0;
    switch (d.source) {
      case 'cheapshark': {
        if (!d.crit) return true;
        let best = null;
        for (const [platform, o] of Object.entries(d.offers || {})) {
          const tier = cheapSharkTier(d.crit, o.discount, platform, s);
          if (!tier) delete d.offers[platform];
          else best = best || tier;
        }
        if (!best) return false;
        Object.assign(d.flags, best);
        const top = Object.entries(d.offers).sort(([, a], [, b]) => a.price - b.price)[0];
        Object.assign(d, top[1], { platform: top[0] });
        return true;
      }
      case 'gog':
        return discount >= launcherMin(s) && (s.level !== 'strict' || (d.rating?.gog ?? 0) >= 4.5);
      case 'ea':
        return discount >= launcherMin(s);
      case 'eshop':
        return s.level === 'strict'
          ? (d.flags.nintendo ? discount >= 30 : discount >= s.switchMinDiscount && d.flags.popular)
          : discount >= (d.flags.nintendo ? 20 : s.switchMinDiscount);
      case 'switchkeys':
        return discount >= (d.flags.nintendo ? 20 : s.switchMinDiscount);
      case 'bundle':
        if (d.bundle?.average) return d.bundle.average >= { strict: 85, balanced: 75, wide: 70 }[s.level] || (s.level === 'custom' && d.bundle.average >= 75);
        return (d.bundle?.good ?? 0) >= (MIN_GOOD[s.level] ?? 3);
      case 'storebundle': // remise sur la valeur réelle du contenu
        return discount >= { strict: 85, balanced: 75, wide: 60 }[s.level] || (s.level === 'custom' && discount >= 75);
      default:
        return true;
    }
  });
}
