// Taux de change officiel de la Banque centrale européenne : CheapShark et GamerPower ne donnent que des dollars.
import { ENDPOINTS } from '../config.js';
import { fetchText } from '../util.js';

export const DEFAULT_USD_EUR = 0.88; // utilisé seulement si la BCE n'a jamais pu être lue

export function parseEcbRate(xml) {
  const usd = Number(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/i.exec(String(xml || ''))?.[1]);
  if (!(usd > 0.5 && usd < 2)) throw new Error('taux BCE illisible');
  return 1 / usd;
}

export async function fetchUsdToEur() {
  return parseEcbRate(await fetchText(ENDPOINTS.ecb));
}

export const toEur = (usd, rate) => (usd == null || Number.isNaN(usd) ? null : Math.round(usd * rate * 100) / 100);

// « $19.99 » → « ≈ 17,59 € »
export function worthInEur(worth, rate) {
  const m = /^\s*\$\s*(\d+(?:\.\d+)?)/.exec(String(worth || ''));
  if (!m) return worth;
  return `≈ ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(toEur(Number(m[1]), rate))}`;
}
