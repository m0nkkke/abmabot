const state = {
  config: null,
  token: null,
  profile: null,
  photos: [],
  events: [],
  mode: 'fixation',
  recentFixations: []
};

const fixationForm = document.querySelector('#fixationForm');
const eventsList = document.querySelector('#eventsList');
const eventTemplate = document.querySelector('#eventTemplate');
const photoInput = document.querySelector('#photoInput');
const photoGrid = document.querySelector('#photoGrid');
const photoCounter = document.querySelector('#photoCounter');
const fixationStatus = document.querySelector('#fixationStatus');
const menuReturnBtn = document.querySelector('#menuReturnBtn');
const summary = document.querySelector('#fixationSummary');
const startOnlineBtn = document.querySelector('#startOnlineBtn');
const cancelEditBtn = document.querySelector('#cancelEditBtn');

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

function initAuthToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token')
    || params.get('WebAppStartParam')
    || getMaxStartParam()
    || sessionStorage.getItem('miniappToken')
    || '';

  if (token) {
    sessionStorage.setItem('miniappToken', token);
    state.token = token;
  }
}

function getMaxStartParam() {
  const startParam = window.WebApp?.initDataUnsafe?.start_param;
  if (!startParam) {
    return '';
  }

  if (typeof startParam === 'string') {
    return startParam;
  }

  return startParam.token || startParam.payload || '';
}

async function fetchMiniAppJson(url, options = {}) {
  const headers = new Headers(options.headers || {});

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }
  if (window.WebApp?.initData) {
    headers.set('X-Max-WebApp-Data', window.WebApp.initData);
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    throw new Error(result.error || 'Ошибка запроса');
  }

  return result;
}

function getProfileFio() {
  return state.profile?.fio || '';
}

function applyFioDefaults(scope = document) {
  const fio = getProfileFio();
  if (!fio) {
    return;
  }

  scope.querySelectorAll('[name="fio"]').forEach((input) => {
    input.value = fio;
    input.readOnly = true;
    input.classList.add('readonly-field');
  });
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

function applyProfileDefaults() {
  const profile = state.profile;
  if (!profile) {
    return;
  }

  applyFioDefaults();

  if (profile.regionId) {
    fixationForm.regionId.value = String(profile.regionId);
  }

  updateShopSelect();

  if (profile.shopId) {
    fixationForm.shopId.value = String(profile.shopId);
  }

  renderSummary();
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
  if (state.mode === 'online') {
    return [types.THEFT, types.MISSED_THEFT].filter(Boolean);
  }

  return [types.THEFT, types.MISSED_THEFT, types.VIOLATION];
}

function violationTypeEntries() {
  const types = state.config.violationTypes;
  return [types.SHORTAGE, types.OVERCHARGE, types.BAG, types.CONTAINER, types.RESORT, types.WRONG_BARCODE].filter(Boolean);
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

function activatePanel(panelId) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === panelId);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === panelId);
  });
}

function setRecordMode(mode) {
  state.mode = mode;
  fixationForm.mode.value = mode;

  const isOnline = mode === 'online';
  const isEdit = mode === 'edit';
  const onlineCommentField = fixationForm.querySelector('.online-comment-field');
  const submitButton = fixationForm.querySelector('.primary-btn');

  onlineCommentField?.classList.toggle('hidden', !isOnline);
  if (fixationForm.onlineComment) {
    fixationForm.onlineComment.required = isOnline;
    if (!isOnline) {
      fixationForm.onlineComment.value = '';
    }
  }

  cancelEditBtn?.classList.toggle('hidden', !isEdit);
  submitButton.textContent = isOnline
    ? 'Сохранить онлайн-кражу'
    : isEdit
      ? 'Сохранить изменение'
      : 'Сохранить фиксацию';

  state.events = state.events.map((item) => {
    if (isOnline && item.eventType === state.config.eventTypes.VIOLATION) {
      return { ...item, eventType: state.config.eventTypes.THEFT };
    }
    return item;
  });

  renderEvents();
  renderRecentFixations();
}

function resetRecordForm(mode = 'fixation') {
  const fio = fixationForm.fio.value;
  const regionId = fixationForm.regionId.value;
  const shopId = fixationForm.shopId.value;
  const date = fixationForm.date.value || todayRu();

  fixationForm.reset();
  fixationForm.fio.value = fio;
  fixationForm.regionId.value = regionId;
  updateShopSelect();
  fixationForm.shopId.value = shopId;
  fixationForm.date.value = date;
  fixationForm.editFixationId.value = '';
  fixationForm.editOriginalRegion.value = '';
  applyFioDefaults(fixationForm);

  state.photos = [];
  state.events = [];
  addEvent();
  renderPhotos();
  setRecordMode(mode);
}

function findRegionByName(name) {
  return state.config.regions.find((region) => region.name === name);
}

function selectRegionShopByNames(regionName, shopName) {
  const region = findRegionByName(regionName) || state.config.regions[0];
  if (region) {
    fixationForm.regionId.value = String(region.id);
    updateShopSelect();
    const shop = (region.shops || []).find((item) => item.name === shopName) || region.shops?.[0];
    if (shop) {
      fixationForm.shopId.value = String(shop.id);
    }
  }
  renderSummary();
}

function renderRecentFixations() {
  let container = document.querySelector('#recentFixations');
  if (!container) {
    container = document.createElement('div');
    container.id = 'recentFixations';
    container.className = 'recent-list';
    fixationStatus.before(container);
  }

  if (state.mode === 'online' || state.recentFixations.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<h3>Последние фиксации</h3>';
  state.recentFixations.forEach((record) => {
    const data = record.data || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn recent-btn';
    button.textContent = `${data.date || ''} - ${data.shop || ''}`;
    button.addEventListener('click', () => {
      selectRegionShopByNames(data.region, data.shop);
      fixationForm.date.value = data.date || todayRu();
      fixationForm.editFixationId.value = record.fixationId || '';
      fixationForm.editOriginalRegion.value = data.region || '';
      state.photos = [];
      state.events = Array.isArray(data.events) && data.events.length ? data.events : [];
      if (state.events.length === 0) {
        addEvent();
      } else {
        renderEvents();
      }
      renderPhotos();
      setRecordMode('edit');
      activatePanel('fixation');
      setStatus(fixationStatus, 'Загрузите фото заново и сохраните изменение.', '');
    });
    container.append(button);
  });
}

async function loadRecentFixations() {
  const result = await fetchMiniAppJson('/api/miniapp/fixations/recent');
  state.recentFixations = Array.isArray(result.fixations) ? result.fixations : [];
  renderRecentFixations();
}

async function submitJson(url, payload) {
  return fetchMiniAppJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
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
      photos: state.photos,
      onlineComment: fixationForm.onlineComment?.value || '',
      editFixationId: fixationForm.editFixationId.value || '',
      editOriginalRegion: fixationForm.editOriginalRegion.value || ''
    };

    const endpoint = state.mode === 'online' ? '/api/miniapp/online-thefts' : '/api/miniapp/fixations';
    const result = await submitJson(endpoint, payload);
    setStatus(fixationStatus, `Сохранено. Строк: ${result.rows}, фото: ${result.photos}.`, 'success');
    resetRecordForm(state.mode === 'online' ? 'online' : 'fixation');
    await loadRecentFixations();
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
    applyFioDefaults(form);
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
      if (button.dataset.tab === 'fixation' && state.mode === 'online') {
        resetRecordForm('fixation');
      }
      activatePanel(button.dataset.tab);
    });
  });
}

function initMenuReturn() {
  const handleReturn = () => {
    window.close();
    setTimeout(() => {
      menuReturnBtn.blur();
    }, 100);
  };

  menuReturnBtn?.addEventListener('click', handleReturn);
  window.WebApp?.BackButton?.show?.();
  window.WebApp?.BackButton?.onClick?.(handleReturn);
}

async function init() {
  initAuthToken();
  state.config = await fetchMiniAppJson('/api/miniapp/bootstrap');
  state.profile = state.config.user?.profile || null;

  fillSelect(fixationForm.regionId, state.config.regions, (region) => region.id, (region) => region.name);
  updateShopSelect();
  applyProfileDefaults();
  fixationForm.date.value = todayRu();
  document.querySelectorAll('.simple-form [name="date"]').forEach((input) => {
    input.value = todayRu();
  });

  addEvent();
  renderPhotos();
  initTabs();
  initMenuReturn();
  loadRecentFixations().catch(() => {});

  fixationForm.regionId.addEventListener('change', updateShopSelect);
  fixationForm.shopId.addEventListener('change', renderSummary);
  document.querySelector('#addEventBtn').addEventListener('click', () => addEvent());
  startOnlineBtn?.addEventListener('click', () => {
    resetRecordForm('online');
    activatePanel('fixation');
  });
  cancelEditBtn?.addEventListener('click', () => {
    resetRecordForm('fixation');
    setStatus(fixationStatus, '', '');
  });
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
  const needsBotLogin = /mini-app|бота/i.test(error.message || '');
  if (needsBotLogin) {
    sessionStorage.removeItem('miniappToken');
  }

  const title = needsBotLogin ? 'Нужен вход через бота' : 'Не удалось открыть mini-app';
  const message = error.message || 'Попробуйте открыть mini-app позже.';
  document.body.innerHTML = `
    <main class="app-shell auth-state">
      <section class="auth-panel">
        <h1>${title}</h1>
        <p class="status error">${message}</p>
      </section>
    </main>
  `;
});
