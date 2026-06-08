const state = {
  config: null,
  photos: [],
  events: []
};

const fixationForm = document.querySelector('#fixationForm');
const eventsList = document.querySelector('#eventsList');
const eventTemplate = document.querySelector('#eventTemplate');
const photoInput = document.querySelector('#photoInput');
const photoGrid = document.querySelector('#photoGrid');
const photoCounter = document.querySelector('#photoCounter');
const fixationStatus = document.querySelector('#fixationStatus');
const summary = document.querySelector('#fixationSummary');

function todayRu() {
  const now = new Date();
  return [
    String(now.getDate()).padStart(2, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    now.getFullYear()
  ].join('.');
}

function setStatus(element, text, type = '') {
  element.textContent = text;
  element.className = `status ${type}`.trim();
}

function fillSelect(select, items, getValue, getText) {
  select.innerHTML = '';
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = getValue(item);
    option.textContent = getText(item);
    select.append(option);
  });
}

function getSelectedRegion() {
  const regionId = Number(fixationForm.regionId.value);
  return state.config.regions.find((region) => region.id === regionId) || state.config.regions[0];
}

function updateShopSelect() {
  const region = getSelectedRegion();
  fillSelect(fixationForm.shopId, region?.shops || [], (shop) => shop.id, (shop) => shop.name);
  renderSummary();
}

function eventTypeEntries() {
  const types = state.config.eventTypes;
  return [types.THEFT, types.MISSED_THEFT, types.VIOLATION];
}

function violationTypeEntries() {
  const types = state.config.violationTypes;
  return [types.SHORTAGE, types.OVERCHARGE, types.BAG, types.CONTAINER, types.RESORT].filter(Boolean);
}

function addEvent(data = {}) {
  state.events.push({
    item: data.item || '',
    eventType: data.eventType || state.config.eventTypes.THEFT,
    violationType: data.violationType || state.config.violationTypes.SHORTAGE,
    amount: data.amount || '',
    missedReason: data.missedReason || ''
  });
  renderEvents();
}

function syncEventFromCard(card, index) {
  const event = state.events[index];
  event.item = card.querySelector('.event-item').value;
  event.eventType = card.querySelector('.event-type').value;
  event.violationType = card.querySelector('.violation-type').value;
  event.amount = card.querySelector('.event-amount').value;
  event.missedReason = card.querySelector('.event-missed').value;
}

function updateConditionalFields(card) {
  const type = card.querySelector('.event-type').value;
  card.querySelector('.violation-field').classList.toggle('hidden', type !== state.config.eventTypes.VIOLATION);
  card.querySelector('.missed-field').classList.toggle('hidden', type !== state.config.eventTypes.MISSED_THEFT);
}

function renderEvents() {
  eventsList.innerHTML = '';

  state.events.forEach((event, index) => {
    const fragment = eventTemplate.content.cloneNode(true);
    const card = fragment.querySelector('.event-card');
    card.querySelector('strong').textContent = `Позиция ${index + 1}`;
    card.querySelector('.event-item').value = event.item;
    card.querySelector('.event-amount').value = event.amount;
    card.querySelector('.event-missed').value = event.missedReason;

    fillSelect(card.querySelector('.event-type'), eventTypeEntries(), (type) => type, (type) => type);
    fillSelect(card.querySelector('.violation-type'), violationTypeEntries(), (type) => type, (type) => type);
    card.querySelector('.event-type').value = event.eventType;
    card.querySelector('.violation-type').value = event.violationType;

    card.querySelector('.remove-event').disabled = state.events.length === 1;
    card.querySelector('.remove-event').addEventListener('click', () => {
      state.events.splice(index, 1);
      renderEvents();
    });

    card.addEventListener('input', () => {
      syncEventFromCard(card, index);
      updateConditionalFields(card);
      renderSummary();
    });
    card.addEventListener('change', () => {
      syncEventFromCard(card, index);
      updateConditionalFields(card);
      renderSummary();
    });

    updateConditionalFields(card);
    eventsList.append(card);
  });

  renderSummary();
}

async function fileToDataUrl(file) {
  const image = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const maxWidth = 1400;
  const scale = Math.min(1, maxWidth / image.width);
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78);
}

function renderPhotos() {
  photoGrid.innerHTML = '';
  photoCounter.textContent = `${state.photos.length}/${state.config.maxPhotos}`;

  state.photos.forEach((photo, index) => {
    const item = document.createElement('div');
    item.className = 'photo-item';
    item.innerHTML = `<img alt="Фото ${index + 1}"><button type="button" title="Удалить">×</button>`;
    item.querySelector('img').src = photo;
    item.querySelector('button').addEventListener('click', () => {
      state.photos.splice(index, 1);
      renderPhotos();
      renderSummary();
    });
    photoGrid.append(item);
  });
}

function renderSummary() {
  const region = getSelectedRegion();
  const shop = region?.shops.find((item) => String(item.id) === String(fixationForm.shopId.value));
  const total = state.events.reduce((sum, event) => sum + (Number(String(event.amount).replace(',', '.')) || 0), 0);
  summary.innerHTML = `
    <dl>
      <div class="summary-row"><dt>Регион</dt><dd>${region?.name || '-'}</dd></div>
      <div class="summary-row"><dt>Магазин</dt><dd>${shop?.name || '-'}</dd></div>
      <div class="summary-row"><dt>Позиций</dt><dd>${state.events.length}</dd></div>
      <div class="summary-row"><dt>Фото</dt><dd>${state.photos.length}</dd></div>
      <div class="summary-row"><dt>Сумма</dt><dd>${total.toFixed(2)}</dd></div>
    </dl>
  `;
}

async function submitJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    throw new Error(result.error || 'Ошибка сохранения');
  }

  return result;
}

async function handleFixationSubmit(event) {
  event.preventDefault();
  setStatus(fixationStatus, 'Сохраняю...', '');
  fixationForm.querySelector('.primary-btn').disabled = true;

  try {
    const payload = {
      fio: fixationForm.fio.value,
      regionId: fixationForm.regionId.value,
      shopId: fixationForm.shopId.value,
      date: fixationForm.date.value,
      events: state.events,
      photos: state.photos
    };

    const result = await submitJson('/api/miniapp/fixations', payload);
    setStatus(fixationStatus, `Сохранено. Строк: ${result.rows}, фото: ${result.photos}.`, 'success');
    state.photos = [];
    state.events = [];
    addEvent();
    renderPhotos();
  } catch (error) {
    setStatus(fixationStatus, error.message, 'error');
  } finally {
    fixationForm.querySelector('.primary-btn').disabled = false;
  }
}

async function handleSimpleReportSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector('.status');
  const button = form.querySelector('.primary-btn');
  setStatus(status, 'Сохраняю...', '');
  button.disabled = true;

  try {
    await submitJson(form.dataset.reportEndpoint, {
      fio: form.fio.value,
      date: form.date.value,
      text: form.text.value
    });
    form.reset();
    form.date.value = todayRu();
    setStatus(status, 'Сохранено.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function initTabs() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
      button.classList.add('active');
      document.getElementById(button.dataset.tab).classList.add('active');
    });
  });
}

async function init() {
  const response = await fetch('/api/miniapp/config');
  state.config = await response.json();

  fillSelect(fixationForm.regionId, state.config.regions, (region) => region.id, (region) => region.name);
  updateShopSelect();
  fixationForm.date.value = todayRu();
  document.querySelectorAll('.simple-form [name="date"]').forEach((input) => {
    input.value = todayRu();
  });

  addEvent();
  renderPhotos();
  initTabs();

  fixationForm.regionId.addEventListener('change', updateShopSelect);
  fixationForm.shopId.addEventListener('change', renderSummary);
  document.querySelector('#addEventBtn').addEventListener('click', () => addEvent());
  fixationForm.addEventListener('submit', handleFixationSubmit);
  document.querySelectorAll('.simple-form').forEach((form) => {
    form.addEventListener('submit', handleSimpleReportSubmit);
  });

  photoInput.addEventListener('change', async () => {
    const files = [...photoInput.files].slice(0, state.config.maxPhotos - state.photos.length);
    for (const file of files) {
      state.photos.push(await fileToDataUrl(file));
    }
    photoInput.value = '';
    renderPhotos();
    renderSummary();
  });
}

init().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><p class="status error">${error.message}</p></main>`;
});
