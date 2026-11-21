// FreeKeep — page de réglages
import { STORES, STORE_ORDER, ALARM_NAME } from '../src/config.js';
import { formatAgo } from '../src/util.js';
import { getSettings, saveSettings } from '../src/store.js';

const $ = (sel) => document.querySelector(sel);
const BOOLEANS = [
  'notifyNew', 'notifyLastDay', 'autoClick', 'steamOwnedSync', 'showUpcoming',
  'pcDeals', 'switchDeals', 'dealabs', 'dealabsOnlyHot', 'notifyDeals',
];
const SELECTS = ['intervalHours', 'pcMinDiscount', 'gemMinRating', 'gemMinDiscount', 'switchMinDiscount', 'dealMaxAgeDays'];
const TEXTS = ['ggdealsKey', 'departments'];

let settings = null;
let savedTimer = null;

function flashSaved() {
  const el = $('#saved');
  el.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.hidden = true), 1400);
}

async function save() {
  await saveSettings(settings);
  flashSaved();
}

function renderStores() {
  const box = $('#stores');
  box.replaceChildren();
  for (const id of STORE_ORDER) {
    const label = document.createElement('label');
    label.className = 'store';
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = STORES[id].color;
    const name = document.createElement('span');
    name.textContent = STORES[id].name;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'switch';
    input.checked = !!settings.stores[id];
    input.addEventListener('change', () => {
      settings.stores[id] = input.checked;
      save();
    });
    label.append(dot, name, input);
    box.append(label);
  }
}

(async () => {
  settings = await getSettings();
  renderStores();

  for (const key of BOOLEANS) {
    const input = $(`#${key}`);
    input.checked = !!settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      save();
    });
  }

  for (const key of SELECTS) {
    const input = $(`#${key}`);
    input.value = String(settings[key]);
    input.addEventListener('change', () => {
      settings[key] = Number(input.value);
      save();
    });
  }

  for (const key of TEXTS) {
    const input = $(`#${key}`);
    input.value = settings[key] || '';
    let t = null;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        settings[key] = input.value.trim();
        save();
      }, 600);
    });
  }

  $('#btn-test').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'testNotification' }));

  // Réinitialisation en deux clics (pas de boîte de dialogue native)
  const reset = $('#btn-reset');
  let armed = null;
  reset.addEventListener('click', async () => {
    if (!armed) {
      reset.textContent = 'Confirmer ?';
      reset.classList.add('confirm');
      armed = setTimeout(() => {
        armed = null;
        reset.textContent = 'Réinitialiser';
        reset.classList.remove('confirm');
      }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    reset.disabled = true;
    reset.textContent = 'Réinitialisation…';
    await chrome.runtime.sendMessage({ type: 'resetData' });
    reset.disabled = false;
    reset.classList.remove('confirm');
    reset.textContent = 'Réinitialiser';
    flashSaved();
  });
})();

// ---------------------------------------------------------------------------
// État des sources (vérifications réelles, en direct)
// ---------------------------------------------------------------------------
const SOURCE_INFO = {
  epic: ['Epic Games Store', 'Jeux offerts de la semaine (API officielle)'],
  steam: ['Steam', 'Jeux à -100 % + jeux déjà possédés'],
  gamerpower: ['GamerPower', 'Giveaways : GOG, Ubisoft, Alienware, Fanatical, Humble…'],
  cheapshark: ['CheapShark', 'Promos PC sur 30+ stores officiels'],
  eshop: ['eShop Nintendo', 'Promos Switch, prix et dates de fin officiels'],
  dealabs: ['Dealabs', 'Boîtes, sites de clés, erreurs de prix'],
  ggdeals: ['GG.deals', 'Prix des sites de clés (clé API)'],
};

function renderSources(meta) {
  const box = $('#sources');
  box.replaceChildren();
  const status = meta?.sources || {};
  for (const [id, [name, desc]] of Object.entries(SOURCE_INFO)) {
    const st = status[id];
    const row = document.createElement('div');
    row.className = 'src';
    const left = document.createElement('div');
    left.innerHTML = '<strong></strong><small></small>';
    left.querySelector('strong').textContent = name;
    left.querySelector('small').textContent = desc;
    const right = document.createElement('div');
    right.className = 'src-state';
    const pill = document.createElement('span');
    const detail = document.createElement('small');
    if (!st) {
      pill.className = 'state off';
      pill.textContent = id === 'ggdeals' && !settings?.ggdealsKey ? 'Pas de clé' : 'Désactivée';
    } else if (st.ok) {
      pill.className = 'state ok';
      pill.textContent = `✔ ${st.count} ${st.count > 1 ? 'résultats' : 'résultat'}`;
      detail.textContent = st.at ? `données ${formatAgo(st.at)}` : '';
    } else {
      pill.className = 'state ko';
      pill.textContent = '✘ Erreur';
      pill.title = st.error || '';
      detail.textContent = st.error || '';
    }
    right.append(pill, detail);
    row.append(left, right);
    box.append(row);
  }
}

async function renderNextCheck() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  const { meta } = await chrome.storage.local.get('meta');
  const last = meta?.lastRefresh ? `Dernière : ${formatAgo(meta.lastRefresh)}` : 'Aucune vérification pour l’instant';
  const next = alarm ? ` · Prochaine : ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(alarm.scheduledTime)}` : '';
  $('#next-check').textContent = last + next;
  renderSources(meta);
}

$('#btn-check').addEventListener('click', async () => {
  const btn = $('#btn-check');
  btn.disabled = true;
  btn.textContent = 'Vérification…';
  try {
    await chrome.runtime.sendMessage({ type: 'refresh', force: ['cheapshark', 'eshop', 'dealabs', 'ggdeals'] });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Vérifier maintenant';
    renderNextCheck();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.meta) renderNextCheck();
});
setTimeout(renderNextCheck, 50);
setInterval(renderNextCheck, 30 * 1000);
