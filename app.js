const API = 'https://api.tcgdex.net/v2/en/cards/';
const SETS = { me04: 'Chaos Rising', me05: 'Pitch Black' };
const OWNED_KEY = 'pitch-black-me05-owned-v1';
const PRICE_KEY = 'pokemon-collection-cardmarket-prices-v1';
const CURRENCY_KEY = 'pokemon-collection-currency-v1';
const FINISH_NAMES = { normal: 'Normal', holofoil: 'Holo', 'reverse-holofoil': 'Reverse holo', 'holofoil-gamestop': 'GameStop stamped holo', 'holofoil-eb-games': 'EB Games stamped holo', 'holofoil-set-logo': 'Set logo stamped holo' };

const $ = (selector) => document.querySelector(selector);
const state = { cards: [], owned: new Set(), filter: 'all', series: 'all', search: '', rarity: 'all', sort: 'number', currency: 'AUD', fx: null, fetchedAt: null, priceUpdated: null, refreshing: false };
let toastTimer;

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function saveJSON(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function money(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: state.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value * (state.currency === 'AUD' ? state.fx.rate : 1));
}
function finishName(finish) { return FINISH_NAMES[finish] || finish.replaceAll('-', ' '); }
function marketPrice(detail) {
  const market = detail.pricing?.cardmarket;
  if (!market) return null;
  const candidates = detail.stamp?.length ? [market.avg, market['avg-holo']] : detail.type === 'normal' ? [market.avg, market['avg-holo']] : [market['avg-holo'], market.avg];
  return candidates.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0) ?? null;
}
function detailKey(detail) {
  const finish = { normal: 'normal', holo: 'holofoil', reverse: 'reverse-holofoil' }[detail.type];
  return finish ? finish + (detail.stamp?.length ? `-${detail.stamp.join('-')}` : '') : null;
}
function cardPrice(card, finish) {
  const value = card.prices?.[finish];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function variantKey(card, finish) { return `${card.id}:${finish}`; }
function seriesCards() { return state.series === 'all' ? state.cards : state.cards.filter((card) => card.setId === state.series); }
function dateTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'unavailable';
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
}
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3500);
}

function renderProgress() {
  const cards = seriesCards();
  const total = cards.reduce((sum, card) => sum + card.variants.length, 0);
  const valid = new Set(cards.flatMap((card) => card.variants.map((finish) => variantKey(card, finish))));
  const ownedCount = [...state.owned].filter((key) => valid.has(key)).length;
  const percentage = total ? Math.round(ownedCount / total * 100) : 0;
  const value = cards.reduce((sum, card) => sum + card.variants.reduce((subtotal, finish) => subtotal + (state.owned.has(variantKey(card, finish)) ? (cardPrice(card, finish) || 0) : 0), 0), 0);
  $('#progress-scope').textContent = state.series === 'all' ? 'ALL SETS' : SETS[state.series].toUpperCase();
  $('#owned-count').textContent = ownedCount;
  $('#progress-total').textContent = `/ ${total} finishes collected`;
  $('#progress-percent').textContent = `${percentage}%`;
  $('#progress-fill').style.width = `${percentage}%`;
  $('.progress-track').setAttribute('aria-valuemax', String(total));
  $('.progress-track').setAttribute('aria-valuenow', String(ownedCount));
  $('#remaining-count').textContent = total - ownedCount;
  $('#collection-value').textContent = money(value);
  $('#hero-card-count').textContent = `${state.cards.length} cards`;
  $('#hero-variant-count').textContent = `${state.cards.reduce((sum, card) => sum + card.variants.length, 0)} finishes`;
  $('#progress-message').textContent = ownedCount === total ? 'Collection complete.' : ownedCount ? `${total - ownedCount} finishes to go. Keep hunting.` : 'Your journey starts here.';
}

function visibleCards() {
  const query = state.search.trim().toLocaleLowerCase();
  const cards = state.cards.filter((card) => {
    if (state.series !== 'all' && card.setId !== state.series) return false;
    if (query && !`${card.name} ${card.number} ${SETS[card.setId]}`.toLocaleLowerCase().includes(query)) return false;
    if (state.rarity !== 'all' && card.rarity !== state.rarity) return false;
    const owned = card.variants.filter((finish) => state.owned.has(variantKey(card, finish))).length;
    if (state.filter === 'owned' && owned === 0) return false;
    if (state.filter === 'missing' && owned === card.variants.length) return false;
    return true;
  });
  if (state.sort === 'number') cards.sort((a, b) => a.setId.localeCompare(b.setId) || Number(a.number) - Number(b.number));
  if (state.sort === 'name') cards.sort((a, b) => a.name.localeCompare(b.name) || Number(a.number) - Number(b.number));
  if (state.sort.startsWith('price')) {
    const highest = (card) => Math.max(-1, ...card.variants.map((finish) => cardPrice(card, finish) ?? -1));
    cards.sort((a, b) => (state.sort === 'price-desc' ? highest(b) - highest(a) : highest(a) - highest(b)) || Number(a.number) - Number(b.number));
  }
  return cards;
}

function renderCards() {
  const cards = visibleCards();
  $('#result-count').textContent = `Showing ${cards.length} of ${seriesCards().length} cards`;
  $('#empty-state').hidden = cards.length > 0;
  $('#card-grid').innerHTML = cards.map((card) => {
    const number = escapeHTML(card.number);
    const name = escapeHTML(card.name);
    const image = card.image && card.image.startsWith('https://assets.tcgdex.net/') ? card.image : null;
    const imageMarkup = image ? `<img src="${escapeHTML(image)}" alt="${name} card" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'image-fallback',textContent:'Card image unavailable'}))">` : '<span class="image-fallback">Card image unavailable</span>';
    const finishMarkup = card.variants.map((finish) => {
      const key = variantKey(card, finish);
      const owned = state.owned.has(key);
      return `<button type="button" class="finish-button${owned ? ' owned' : ''}" data-key="${escapeHTML(key)}" aria-pressed="${owned}" aria-label="${owned ? 'Remove' : 'Mark'} ${name} ${escapeHTML(SETS[card.setId])} ${escapeHTML(finishName(finish))} ${owned ? 'from' : 'as owned in'} collection"><span class="finish-check" aria-hidden="true">${owned ? '✓' : ''}</span><span class="finish-name">${escapeHTML(finishName(finish))}</span><span class="finish-price">${money(cardPrice(card, finish))}</span></button>`;
    }).join('');
    const allPrice = card.variants.reduce((total, finish) => total + (cardPrice(card, finish) || 0), 0);
    return `<article class="card-tile"><div class="card-image-wrap"><span class="number-badge">${escapeHTML(card.setId.toUpperCase())} #${number}</span>${imageMarkup}</div><div class="card-info"><div class="card-set">${escapeHTML(SETS[card.setId])}</div><h3>${name}</h3><div class="rarity">${escapeHTML(card.rarity)}</div><div class="finish-list">${finishMarkup}</div><div class="card-total"><span>All finishes est.</span><strong>${money(allPrice)}</strong></div></div></article>`;
  }).join('');
}

function renderPriceStatus(message = '') {
  const status = state.priceUpdated ? `Cardmarket estimates updated ${dateTime(state.priceUpdated)}.` : 'Market price update time unavailable.';
  const fx = state.fx?.date ? ` AUD conversion uses the ${state.fx.date} EUR/AUD exchange rate.` : '';
  $('#price-status').textContent = `${message}${message ? ' ' : ''}${status}${fx}`;
  $('#price-asof').textContent = `${message}${message ? ' ' : ''}${status}${fx}`;
}
function render() { renderProgress(); renderCards(); renderPriceStatus(); }

function restorePrices() {
  const cache = readJSON(PRICE_KEY);
  if (!cache || !cache.cards || !cache.fetchedAt) return;
  if (new Date(cache.fetchedAt).getTime() < new Date(state.fetchedAt).getTime()) return;
  for (const card of state.cards) {
    const latest = cache.cards[card.id];
    if (!latest) continue;
    card.prices = latest.prices;
    card.priceUpdated = latest.priceUpdated;
  }
  if (cache.fx?.rate) state.fx = cache.fx;
  state.fetchedAt = cache.fetchedAt;
  state.priceUpdated = state.cards.map((card) => card.priceUpdated).filter(Boolean).sort().at(-1) || null;
}

async function refreshPrices(manual = false) {
  if (state.refreshing) return;
  state.refreshing = true;
  const button = $('#refresh-prices');
  button.disabled = true;
  button.textContent = '↻ Updating prices…';
  let next = 0;
  let success = 0;
  const updates = {};
  const worker = async () => {
    while (next < state.cards.length) {
      const card = state.cards[next++];
      try {
        const response = await fetch(`${API}${encodeURIComponent(card.id)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const details = data.variants_detailed || [];
        if (!details.length) continue;
        const prices = {};
        let updated = card.priceUpdated;
        for (const detail of details) {
          const finish = detailKey(detail);
          if (!card.variants.includes(finish)) continue;
          const value = marketPrice(detail);
          if (value !== null) prices[finish] = value;
          const timestamp = detail.pricing?.cardmarket?.updated;
          if (timestamp && (!updated || timestamp > updated)) updated = timestamp;
        }
        if (!Object.keys(prices).length) continue;
        updates[card.id] = { prices: { ...card.prices, ...prices }, priceUpdated: updated };
        success++;
      } catch { /* Keep the checked-in or cached price for this card. */ }
    }
  };
  try {
    const fxRequest = fetch('https://api.frankfurter.dev/v2/rate/eur/aud', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).catch(() => null);
    await Promise.all(Array.from({ length: 12 }, worker));
    const fx = await fxRequest;
    if (success) {
      for (const card of state.cards) {
        if (!updates[card.id]) continue;
        card.prices = updates[card.id].prices;
        card.priceUpdated = updates[card.id].priceUpdated;
      }
      if (fx?.rate > 0) state.fx = { rate: fx.rate, date: fx.date };
      state.fetchedAt = new Date().toISOString();
      state.priceUpdated = state.cards.map((card) => card.priceUpdated).filter(Boolean).sort().at(-1) || null;
      saveJSON(PRICE_KEY, { fetchedAt: state.fetchedAt, fx: state.fx, cards: Object.fromEntries(state.cards.map((card) => [card.id, { prices: card.prices, priceUpdated: card.priceUpdated }])) });
      render();
      renderPriceStatus(success === state.cards.length ? '' : `${state.cards.length - success} cards kept their previous price.`);
      if (manual) toast(success === state.cards.length ? 'Prices updated' : `Updated ${success} cards; previous prices kept for the rest`);
    } else {
      renderPriceStatus('Live refresh unavailable. Showing saved prices.');
      if (manual) toast('Live refresh unavailable; saved prices are still shown');
    }
  } finally {
    state.refreshing = false;
    button.disabled = false;
    button.textContent = '↻ Refresh prices';
  }
}

function bindEvents() {
  $('#card-grid').addEventListener('click', (event) => {
    const button = event.target.closest('.finish-button');
    if (!button) return;
    const key = button.dataset.key;
    if (state.owned.has(key)) state.owned.delete(key); else state.owned.add(key);
    if (!saveJSON(OWNED_KEY, [...state.owned])) toast('Browser storage is unavailable. Export your checklist before leaving.');
    const owned = state.owned.has(key);
    button.classList.toggle('owned', owned);
    button.setAttribute('aria-pressed', String(owned));
    button.querySelector('.finish-check').textContent = owned ? '✓' : '';
    button.setAttribute('aria-label', `${owned ? 'Remove' : 'Mark'} ${button.closest('.card-tile').querySelector('h3').textContent} ${button.querySelector('.finish-name').textContent} ${owned ? 'from' : 'as owned in'} collection`);
    renderProgress();
    if (state.filter !== 'all') renderCards();
  });
  $('#search').addEventListener('input', (event) => { state.search = event.target.value; renderCards(); });
  document.querySelectorAll('.filter-tab').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('.filter-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    renderCards();
  }));
  $('#series').addEventListener('change', (event) => { state.series = event.target.value; renderProgress(); renderCards(); });
  $('#rarity').addEventListener('change', (event) => { state.rarity = event.target.value; renderCards(); });
  $('#sort').addEventListener('change', (event) => { state.sort = event.target.value; renderCards(); });
  $('#currency').addEventListener('change', (event) => { state.currency = event.target.value; saveJSON(CURRENCY_KEY, state.currency); render(); });
  $('#refresh-prices').addEventListener('click', () => refreshPrices(true));
  $('#clear-filters').addEventListener('click', () => {
    state.filter = 'all'; state.series = 'all'; state.search = ''; state.rarity = 'all';
    $('#search').value = ''; $('#series').value = 'all'; $('#rarity').value = 'all';
    document.querySelectorAll('.filter-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.filter === 'all'));
    renderProgress();
    renderCards();
  });
  $('#export-collection').addEventListener('click', () => {
    const payload = { setIds: Object.keys(SETS), exportedAt: new Date().toISOString(), owned: [...state.owned].sort() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pokemon-card-collection.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Checklist exported');
  });
  $('#import-collection').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const legacy = data.setId === 'me05';
      const current = Array.isArray(data.setIds) && data.setIds.length > 0 && data.setIds.every((id) => id in SETS);
      if ((!legacy && !current) || !Array.isArray(data.owned)) throw new Error('Wrong checklist format');
      const valid = new Set(state.cards.flatMap((card) => card.variants.map((finish) => variantKey(card, finish))));
      const imported = data.owned.filter((key) => typeof key === 'string' && valid.has(key));
      state.owned = legacy ? new Set([...state.owned].filter((key) => !key.startsWith('me05-')).concat(imported)) : new Set(imported);
      saveJSON(OWNED_KEY, [...state.owned]);
      render();
      toast(`Imported ${state.owned.size} collected finishes`);
    } catch { toast('Could not read this checklist'); }
    event.target.value = '';
  });
}

async function start() {
  bindEvents();
  try {
    const response = await fetch('cards.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    if (snapshot.cards?.length !== 242 || snapshot.priceCurrency !== 'EUR' || Object.keys(SETS).some((id) => snapshot.cards.filter((card) => card.setId === id).length !== (id === 'me04' ? 122 : 120))) throw new Error('Incomplete card list');
    state.cards = snapshot.cards;
    state.fx = snapshot.fx;
    state.fetchedAt = snapshot.fetchedAt;
    state.priceUpdated = state.cards.map((card) => card.priceUpdated).filter(Boolean).sort().at(-1) || null;
    const saved = readJSON(OWNED_KEY);
    if (Array.isArray(saved)) state.owned = new Set(saved.filter((key) => typeof key === 'string'));
    if (readJSON(CURRENCY_KEY) === 'EUR') state.currency = 'EUR';
    $('#currency').value = state.currency;
    const rarities = [...new Set(state.cards.map((card) => card.rarity))].sort();
    $('#rarity').innerHTML += rarities.map((rarity) => `<option value="${escapeHTML(rarity)}">${escapeHTML(rarity)}</option>`).join('');
    restorePrices();
    render();
    if (Date.now() - new Date(state.fetchedAt).getTime() > 24 * 60 * 60 * 1000) refreshPrices();
  } catch {
    $('#result-count').textContent = 'Card list unavailable';
    $('#empty-state').hidden = false;
    $('#empty-state p').textContent = 'Please reload when you are online.';
    $('#price-status').textContent = 'Card and price data could not be loaded.';
  }
}
start();
