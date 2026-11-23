// FreeKeep — script injecté sur les pages des stores.
// 1. Détecte si le jeu est déjà dans ta bibliothèque -> le marque « récupéré ».
// 2. Si l'onglet a été ouvert via « Récupérer » (et que le clic auto est activé),
//    clique sur le bouton de récupération. Ne touche jamais aux captchas ni à un achat payant.
(() => {
  if (window.__freekeepLoaded) return;
  window.__freekeepLoaded = true;

  const host = location.hostname;
  const STORE = /epicgames\.com$/.test(host) ? 'epic'
    : /steampowered\.com$/.test(host) ? 'steam'
    : /gog\.com$/.test(host) ? 'gog'
    : /ubisoft\.com$/.test(host) ? 'ubisoft'
    : /\.itch\.io$/.test(host) ? 'itch'
    : /^freebies\.indiegala\.com$/.test(host) ? 'indiegala'
    : null;
  if (!STORE) return;

  const TOP = window.top === window;
  const IS_EPIC_CHECKOUT = STORE === 'epic' && /purchase/i.test(location.href);
  if (!TOP && !IS_EPIC_CHECKOUT) return;
  if (STORE === 'epic' && TOP && !/\/(p|bundles)\/|free-games|purchase/i.test(location.href)) return;

  // Textes reconnus (normalisés : minuscules, sans accents ni ponctuation).
  const TEXT = {
    epic: {
      claim: ['obtenir', 'get', 'obtenir gratuitement', 'get for free'],
      order: ['passer commande', 'place order'],
      owned: ['dans la bibliotheque', 'in library', 'possede', 'owned'],
      success: ['merci pour votre commande', 'merci pour ta commande', 'thanks for your order', 'thank you for your order'],
    },
    steam: {
      claim: ['ajouter a votre compte', 'ajouter au compte', 'add to account', 'add to library', 'ajouter a la bibliotheque', 'ajouter a votre bibliotheque'],
      owned: [],
      success: ['a ete ajoute a votre compte', 'has been added to your account', 'now available in your steam library', 'est maintenant disponible dans votre bibliotheque steam'],
      ownedText: ['deja dans votre bibliotheque steam', 'already in your steam library'],
    },
    gog: {
      claim: ['add to library', 'ajouter a la bibliotheque', 'ajouter a ma bibliotheque', 'ajouter a votre bibliotheque', 'get it free', 'obtenir gratuitement', 'recuperer gratuitement'],
      owned: ['in library', 'dans la bibliotheque', 'dans ta bibliotheque', 'owned', 'possede'],
      success: ['added to your library', 'has been added to your library', 'a ete ajoute a votre bibliotheque', 'ajoute a votre bibliotheque', 'ajoute a ta bibliotheque'],
    },
    ubisoft: {
      claim: ['get it for free', 'get for free', 'obtenir gratuitement', 'obtenez le gratuitement', 'recuperer gratuitement', 'telecharger gratuitement', 'free download'],
      owned: ['owned', 'possede', 'deja possede', 'in your library', 'dans votre bibliotheque'],
      success: ['added to your library', 'is now in your library', 'ajoute a votre bibliotheque', 'est maintenant dans votre bibliotheque', 'thank you for your order', 'merci pour votre commande'],
    },
    // itch.io : « Download or claim » → « No thanks, just take me to the downloads » → « Claim ». Jamais le bouton d'achat.
    itch: {
      claim: ['download or claim', 'no thanks just take me to the downloads', 'claim', 'claim game'],
      owned: [],
      success: ['you own this game', 'you claimed this', 'you ve claimed this', 'this game has been claimed'],
    },
    indiegala: {
      claim: ['add to your library'],
      owned: ['in your library', 'already in your library'],
      success: ['product added to your library', 'added to your library', 'already in your library'],
    },
  }[STORE];

  const norm = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const labelOf = (el) => el.innerText || el.value || el.getAttribute('aria-label') || '';

  const isVisible = (el) => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  };
  const isEnabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true';

  const CLICKABLE = 'button, a, [role="button"], input[type="submit"], input[type="button"]';

  function findByText(list) {
    if (!list?.length) return null;
    if (STORE === 'epic') {
      const cta = document.querySelector('[data-testid="purchase-cta-button"]');
      if (cta && list.includes(norm(labelOf(cta))) && isVisible(cta) && isEnabled(cta)) return cta;
    }
    for (const el of document.querySelectorAll(CLICKABLE)) {
      const t = norm(labelOf(el));
      if (t && t.length < 60 && list.includes(t) && isVisible(el) && isEnabled(el)) return el;
    }
    return null;
  }

  const bodyText = () => norm(document.body?.innerText || '');

  function isOwned(linked) {
    if (STORE === 'steam') {
      const box = document.querySelector('.game_area_already_owned');
      if (box && isVisible(box)) return true;
    }
    if (findByText(TEXT.owned)) return true;
    if (!linked) return false; // les phrases ci-dessous ne comptent que pour l'onglet ouvert par FreeKeep<3
    const text = bodyText();
    return [...TEXT.success, ...(TEXT.ownedText || [])].some((p) => text.includes(p));
  }

  // Sécurité checkout Epic : on ne clique « Passer commande » que si le total est à 0.
  function orderIsFree() {
    const text = bodyText();
    const re = /(?:^|\s)(sous\s|sub)?total\b[^0-9]{0,30}?(\d+)\s(\d{2})\b/g;
    let m;
    let found = false;
    while ((m = re.exec(text))) {
      if (m[1]) continue; // sous-total : ignoré
      found = true;
      if (Number(m[2]) > 0 || Number(m[3]) > 0) return false;
    }
    if (found) return true;
    return /(?:^|\s)total\b[^0-9]{0,20}(gratuit|free)\b/.test(text);
  }

  function press(el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
  }

  // ---------- Toast (page principale uniquement) ----------
  let toastHost = null;
  function toast(message, kind = 'info', sticky = false) {
    if (!TOP) return;
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
      const root = toastHost.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          .t{font:500 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eaef;background:#14171d;
             border:1px solid #2a2f3a;border-left:3px solid var(--c,#60a5fa);border-radius:10px;padding:12px 34px 12px 14px;
             max-width:340px;box-shadow:0 12px 32px rgba(0,0,0,.45);position:relative;animation:in .25s ease-out}
          .b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--c,#60a5fa);margin-bottom:3px;font-weight:700}
          button{position:absolute;top:6px;right:8px;background:none;border:0;color:#8b919e;font-size:16px;cursor:pointer;padding:2px 4px}
          button:hover{color:#fff}
          @keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        </style>
        <div class="t"><span class="b">FreeKeep&lt;3</span><span class="m"></span><button title="Fermer">×</button></div>`;
      root.querySelector('button').addEventListener('click', () => toastHost.remove());
      document.documentElement.appendChild(toastHost);
    }
    if (!toastHost.isConnected) document.documentElement.appendChild(toastHost);
    const root = toastHost.shadowRoot;
    const colors = { info: '#60a5fa', ok: '#34d399', warn: '#fbbf24' };
    root.querySelector('.t').style.setProperty('--c', colors[kind] || colors.info);
    root.querySelector('.m').textContent = message;
    clearTimeout(toast.timer);
    if (!sticky) toast.timer = setTimeout(() => toastHost?.remove(), 9000);
  }

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  // ---------- Boucle principale ----------
  let onOwned = null;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'freekeep:owned' && TOP) onOwned?.(msg.title);
  });

  async function main() {
    const info = await send({ type: 'claim:hello', url: location.href, title: document.title, top: TOP });
    if (!info?.game) return;
    const { linked, autoClick, owned, game } = info;
    const page = location.pathname;

    if (owned) {
      if (linked) toast(`${game.title} est déjà marqué comme récupéré.`, 'ok');
      return;
    }

    let done = false;
    let clickedClaim = false;
    let clickedOrder = false;
    let warnedManual = false;
    const started = Date.now();
    const maxDuration = linked ? 4 * 60 * 1000 : 20 * 1000;

    const finish = (msg) => {
      done = true;
      clearInterval(timer);
      toast(msg, 'ok');
    };

    onOwned = (title) => { if (!done) finish(`${title} est dans ta bibliothèque. Marqué comme récupéré ✓`); };

    if (linked && TOP && !autoClick) {
      toast(`Clique sur le bouton de récupération pour ajouter ${game.title}. FreeKeep<3 détectera l'ajout.`, 'info', true);
    }

    const tick = async () => {
      if (done) return;
      // Le site a changé de page sans recharger : on repart de zéro, c'est peut-être un autre jeu.
      if (location.pathname !== page) {
        done = true;
        clearInterval(timer);
        toastHost?.remove();
        main();
        return;
      }
      if (Date.now() - started > maxDuration) return clearInterval(timer);

      if (isOwned(linked)) {
        done = true;
        clearInterval(timer);
        await send({ type: 'claim:owned', key: game.key });
        toast(`${game.title} est dans ta bibliothèque. Marqué comme récupéré ✓`, 'ok');
        return;
      }
      if (!linked || !autoClick) return;

      if (TOP && !clickedClaim) {
        const btn = findByText(TEXT.claim);
        if (btn) {
          clickedClaim = true;
          const label = labelOf(btn).trim();
          press(btn);
          toast(`J'ai cliqué sur « ${label} ». Si un captcha ou une confirmation s'affiche, termine-la toi-même.`, 'info', true);
        } else if (!warnedManual && Date.now() - started > 15000) {
          warnedManual = true;
          toast(`Bouton introuvable automatiquement : clique toi-même pour récupérer ${game.title}. FreeKeep<3 détectera l'ajout.`, 'warn', true);
        }
      }

      if (STORE === 'epic' && IS_EPIC_CHECKOUT && !clickedOrder) {
        const order = findByText(TEXT.order);
        if (order && orderIsFree()) {
          clickedOrder = true;
          press(order);
        }
      }
    };

    const timer = setInterval(tick, 1200);
    tick();
  }

  main();
})();
