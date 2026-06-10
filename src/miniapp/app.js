const state = {
  config: null,
  token: null,
  profile: null,
  photos: [],
  events: [],
  mode: 'fixation',
  recentFixations: []
};

const LAST_SELECTION_KEY = 'miniappLastSelection';

const fixationForm = document.querySelector('#fixationForm');
const eventsList = document.querySelector('#eventsList');
const eventTemplate = document.querySelector('#eventTemplate');
const photoDrop = document.querySelector('#photoDrop');
const photoGrid = document.querySelector('#photoGrid');
const photoCounter = document.querySelector('#photoCounter');
const fixationStatus = document.querySelector('#fixationStatus');
const menuReturnBtn = document.querySelector('#menuReturnBtn');
const summary = document.querySelector('#fixationSummary');
const startOnlineBtn = document.querySelector('#startOnlineBtn');
const newFixationBtn = document.querySelector('#newFixationBtn');
const cancelEditBtn = document.querySelector('#cancelEditBtn');
const ksoScheduleForm = document.querySelector('#ksoScheduleForm');
const ksoScheduleConfirm = document.querySelector('#ksoScheduleConfirm');
const ksoScheduleTodayBtn = document.querySelector('#ksoScheduleTodayBtn');
const ksoDecisionModel = document.querySelector('#ksoDecisionModel');
const ksoDecisionStatus = document.querySelector('#ksoDecisionStatus');
const ksoDecisionPreviewForm = document.querySelector('#ksoDecisionPreviewForm');
const ksoDecisionPreview = document.querySelector('#ksoDecisionPreview');

function todayInputDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}

function dateInputToRu(value) {
  const text = String(value || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    return `${iso[3]}.${iso[2]}.${iso[1]}`;
  }

  return text;
}

function ruDateToInput(value) {
  const text = String(value || '').trim();
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) {
    return `${ru[3]}-${ru[2]}-${ru[1]}`;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
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

function saveLastSelection() {
  try {
    localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({
      regionId: fixationForm.regionId.value,
      shopId: fixationForm.shopId.value
    }));
  } catch (error) {
    // localStorage can be disabled in some webviews.
  }
}

function applyLastSelectionDefaults() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(LAST_SELECTION_KEY) || 'null');
  } catch (error) {
    saved = null;
  }

  if (!saved?.regionId) {
    return;
  }

  const region = state.config.regions.find((item) => String(item.id) === String(saved.regionId));
  if (!region) {
    return;
  }

  fixationForm.regionId.value = String(region.id);
  updateShopSelect();

  if ((region.shops || []).some((shop) => String(shop.id) === String(saved.shopId))) {
    fixationForm.shopId.value = String(saved.shopId);
  }

  renderSummary();
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

async function addPhotoFiles(files) {
  const availableSlots = state.config.maxPhotos - state.photos.length;
  const imageFiles = [...files].filter((file) => file.type?.startsWith('image/')).slice(0, availableSlots);

  if (imageFiles.length === 0) {
    if (availableSlots <= 0) {
      setStatus(fixationStatus, 'Достигнут лимит фото для одной фиксации.', 'error');
    }
    return;
  }

  for (const file of imageFiles) {
    state.photos.push(await fileToDataUrl(file));
  }

  renderPhotos();
  renderSummary();
  setStatus(fixationStatus, imageFiles.length === 1 ? 'Фото добавлено.' : `Фото добавлены: ${imageFiles.length}.`, '');
}

function renderPhotoDropHint() {
  if (!photoDrop) {
    return;
  }

  photoDrop.innerHTML = '<strong>Вставить фото</strong><span>кликните сюда и нажмите Ctrl+V со скриншотом</span>';
}

async function addPhotoSource(src) {
  if (!src || state.photos.length >= state.config.maxPhotos) {
    return false;
  }

  if (src.startsWith('data:image/')) {
    state.photos.push(src);
    return true;
  }

  if (!src.startsWith('blob:')) {
    return false;
  }

  const response = await fetch(src);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    return false;
  }

  state.photos.push(await fileToDataUrl(new File([blob], `clipboard-${Date.now()}.png`, { type: blob.type || 'image/png' })));
  return true;
}

function waitForImageLoad(image) {
  if (image.complete && (image.currentSrc || image.src)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => resolve();
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    setTimeout(finish, 500);
  });
}

async function captureInsertedPhotosFromDrop() {
  const images = [...(photoDrop?.querySelectorAll('img') || [])];
  if (images.length === 0) {
    return false;
  }

  let added = 0;
  for (const image of images) {
    await waitForImageLoad(image);
    if (await addPhotoSource(image.currentSrc || image.src)) {
      added++;
    }
  }

  renderPhotoDropHint();
  renderPhotos();
  renderSummary();

  if (added > 0) {
    setStatus(fixationStatus, added === 1 ? 'Фото добавлено.' : `Фото добавлены: ${added}.`, '');
    return true;
  }

  setStatus(fixationStatus, 'Достигнут лимит фото для одной фиксации.', 'error');
  return false;
}

function scheduleDropPhotoCapture({ showError = false } = {}) {
  if (photoDrop?.dataset.capturing === 'true') {
    return;
  }

  if (photoDrop) {
    photoDrop.dataset.capturing = 'true';
  }

  const delays = [0, 50, 150, 350, 700];
  let resolved = false;

  delays.forEach((delay, index) => {
    setTimeout(async () => {
      if (resolved) {
        return;
      }

      if (await captureInsertedPhotosFromDrop()) {
        resolved = true;
        if (photoDrop) {
          delete photoDrop.dataset.capturing;
        }
        return;
      }

      if (showError && index === delays.length - 1) {
        renderPhotoDropHint();
        setStatus(fixationStatus, 'В буфере не найдено изображение.', 'error');
      }

      if (index === delays.length - 1 && photoDrop) {
        delete photoDrop.dataset.capturing;
      }
    }, delay);
  });
}

function getImageFilesFromPaste(event) {
  return [
    ...(event.clipboardData?.files || []),
    ...(event.clipboardData?.items || [])
      .filter((item) => item.type?.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean)
  ].filter((file) => file.type?.startsWith('image/'));
}

async function addPhotosFromClipboardApi() {
  if (!navigator.clipboard?.read) {
    return false;
  }

  try {
    const clipboardItems = await navigator.clipboard.read();
    const files = [];

    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        files.push(new File([blob], `clipboard-${Date.now()}.png`, { type: imageType }));
      }
    }

    if (files.length === 0) {
      return false;
    }

    await addPhotoFiles(files);
    return true;
  } catch (error) {
    return false;
  }
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
  const panel = document.getElementById(panelId);
  if (panel?.dataset.adminOnly === 'true' && !isCurrentUserAdmin()) {
    panelId = 'fixation';
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === panelId);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === panelId);
  });
}

function isCurrentUserAdmin() {
  return state.config?.user?.isAdmin === true || state.config?.user?.role === 'admin';
}

function applyAdminOnlyVisibility() {
  if (isCurrentUserAdmin()) {
    return;
  }

  document.querySelectorAll('[data-admin-only="true"]').forEach((element) => {
    element.classList.add('hidden');
    element.setAttribute('aria-hidden', 'true');
  });

  const activePanel = document.querySelector('.panel.active');
  if (activePanel?.dataset.adminOnly === 'true') {
    activatePanel('fixation');
  }
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
  newFixationBtn?.classList.toggle('hidden', !isEdit);
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
  const date = fixationForm.date.value || todayInputDate();

  fixationForm.reset();
  fixationForm.fio.value = fio;
  fixationForm.regionId.value = regionId;
  updateShopSelect();
  fixationForm.shopId.value = shopId;
  fixationForm.date.value = date;
  fixationForm.editFixationId.value = '';
  fixationForm.editOriginalRegion.value = '';
  saveLastSelection();
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
  saveLastSelection();
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
    const item = data.item || data.events?.find((event) => event.item)?.item || '';
    const isSelected = fixationForm.editFixationId.value && fixationForm.editFixationId.value === record.fixationId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `secondary-btn recent-btn${isSelected ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    button.textContent = [data.date, data.shop, item].filter(Boolean).join(' - ');
    button.addEventListener('click', () => {
      selectRegionShopByNames(data.region, data.shop);
      fixationForm.date.value = ruDateToInput(data.date) || todayInputDate();
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
      renderRecentFixations();
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
      date: dateInputToRu(fixationForm.date.value),
      events: state.events,
      photos: state.photos,
      onlineComment: fixationForm.onlineComment?.value || '',
      editFixationId: fixationForm.editFixationId.value || '',
      editOriginalRegion: fixationForm.editOriginalRegion.value || ''
    };

    const endpoint = state.mode === 'online' ? '/api/miniapp/online-thefts' : '/api/miniapp/fixations';
    const result = await submitJson(endpoint, payload);
    setStatus(fixationStatus, `Готово. Фиксация сохранена: строк ${result.rows}, фото ${result.photos}.`, 'success');
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
      date: dateInputToRu(form.date.value),
      text: form.text.value
    });
    form.reset();
    applyFioDefaults(form);
    form.date.value = todayInputDate();
    setStatus(status, 'Сохранено.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function getKsoScheduleStatusText(status) {
  return status === 'work' ? 'Работаю' : status === 'off' ? 'Выходной' : '';
}

function renderKsoScheduleConfirm() {
  if (!ksoScheduleForm || !ksoScheduleConfirm) {
    return;
  }

  const statusText = getKsoScheduleStatusText(ksoScheduleForm.status.value);
  const date = dateInputToRu(ksoScheduleForm.date.value);

  if (!statusText && !date) {
    ksoScheduleConfirm.classList.add('hidden');
    ksoScheduleConfirm.innerHTML = '';
    return;
  }

  ksoScheduleConfirm.classList.remove('hidden');
  ksoScheduleConfirm.innerHTML = `
    <strong>Проверьте перед сохранением</strong>
    <span>Статус: ${statusText || '-'}</span>
    <span>Дата: ${date || '-'}</span>
  `;
}

function setKsoScheduleStatus(status) {
  if (!ksoScheduleForm) {
    return;
  }

  ksoScheduleForm.status.value = status;
  ksoScheduleForm.querySelectorAll('[data-kso-status]').forEach((button) => {
    const active = button.dataset.ksoStatus === status;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderKsoScheduleConfirm();
}

async function handleKsoScheduleSubmit(event) {
  event.preventDefault();
  const status = ksoScheduleForm.querySelector('.status');
  const button = ksoScheduleForm.querySelector('.primary-btn');
  const selectedStatus = ksoScheduleForm.status.value;

  if (!selectedStatus) {
    setStatus(status, 'Выберите статус: Работаю или Выходной.', 'error');
    return;
  }

  setStatus(status, 'Сохраняю...', '');
  button.disabled = true;

  try {
    const result = await submitJson('/api/miniapp/kso-schedule', {
      status: selectedStatus,
      date: dateInputToRu(ksoScheduleForm.date.value)
    });
    setStatus(status, result.message || 'График сохранен.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function renderKsoDecisionModel(model) {
  if (!ksoDecisionModel || !model) {
    return;
  }

  const normRows = (model.employeeKpi?.norms || []).map((norm) => `
    <tr>
      <td>${norm.experience}</td>
      <td>${norm.kso}</td>
      <td>${norm.checkout}</td>
      <td>${norm.online}</td>
      <td>${norm.staff}</td>
    </tr>
  `).join('');
  const eventWeights = model.employeeKpi?.eventPointWeights || {};
  const employeeCoefficients = model.assignment?.employeeCoefficients || {};

  ksoDecisionModel.innerHTML = `
    <section class="decision-card">
      <h3>Сложность магазина</h3>
      <p>${model.storeComplexity?.formula || ''}</p>
      <p>Диапазон: ${model.storeComplexity?.min} - ${model.storeComplexity?.max}</p>
    </section>
    <section class="decision-card">
      <h3>Баллы событий</h3>
      <table>
        <tbody>
          <tr><th>КСО</th><td>${eventWeights.kso}</td></tr>
          <tr><th>Сторно</th><td>${eventWeights.checkout}</td></tr>
          <tr><th>Онлайн</th><td>${eventWeights.online}</td></tr>
          <tr><th>Персонал</th><td>${eventWeights.staff}</td></tr>
        </tbody>
      </table>
    </section>
    <section class="decision-card">
      <h3>Нормативы по стажу</h3>
      <table>
        <thead><tr><th>Стаж</th><th>КСО</th><th>Сторно</th><th>Онлайн</th><th>Персонал</th></tr></thead>
        <tbody>${normRows}</tbody>
      </table>
    </section>
    <section class="decision-card">
      <h3>Назначение</h3>
      <p>${model.assignment?.formula || ''}</p>
      <table>
        <tbody>
          <tr><th>Сильный</th><td>${employeeCoefficients.strong}</td></tr>
          <tr><th>Стандарт</th><td>${employeeCoefficients.standard}</td></tr>
          <tr><th>Новичок</th><td>${employeeCoefficients.trainee}</td></tr>
          <tr><th>Ограниченный</th><td>${employeeCoefficients.restricted}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

async function loadKsoDecisionModel() {
  if (!ksoDecisionModel) {
    return;
  }

  try {
    const result = await fetchMiniAppJson('/api/miniapp/kso-decision/model');
    renderKsoDecisionModel(result.model);
    setStatus(ksoDecisionStatus, '', '');
  } catch (error) {
    setStatus(ksoDecisionStatus, error.message, 'error');
  }
}

function renderKsoDecisionPreview(preview) {
  if (!ksoDecisionPreview || !preview) {
    return;
  }

  const assignmentRows = (preview.assignments || []).map((assignment) => {
    const employees = (assignment.employees || []).map((employee) => `
      <tr>
        <td>${employee.fio}</td>
        <td>${employee.level || '-'}</td>
        <td>${employee.rs}</td>
        <td>${employee.ps}</td>
        <td>${employee.assignedStoresCount || 1}</td>
        <td>${employee.hardStoresToday || 0}</td>
      </tr>
    `).join('');

    return `
      <section class="decision-card">
        <h3>${assignment.shop} · Ks ${assignment.ks}</h3>
        <table>
          <thead><tr><th>Сотрудник</th><th>Уровень</th><th>Rs</th><th>Ps</th><th>Маг.</th><th>Сложн.</th></tr></thead>
          <tbody>${employees}</tbody>
        </table>
      </section>
    `;
  }).join('');
  const reserve = (preview.reserve || []).map((employee) => `${employee.fio} (Ps ${employee.ps})`).join(', ') || 'нет';
  const warnings = (preview.warnings || []).map((warning) => `<li>${warning}</li>`).join('');

  ksoDecisionPreview.classList.remove('hidden');
  ksoDecisionPreview.innerHTML = `
    <section class="decision-card">
      <h3>Preview на ${preview.date}</h3>
      <p>Работает: ${preview.availableCount}</p>
      <p>Резерв: ${reserve}</p>
    </section>
    ${warnings ? `<section class="decision-card warning"><h3>Предупреждения</h3><ul>${warnings}</ul></section>` : ''}
    ${assignmentRows || '<section class="decision-card"><h3>Назначений нет</h3></section>'}
  `;
}

async function handleKsoDecisionPreviewSubmit(event) {
  event.preventDefault();
  const button = ksoDecisionPreviewForm.querySelector('.primary-btn');
  setStatus(ksoDecisionStatus, 'Считаю preview...', '');
  button.disabled = true;

  try {
    const params = new URLSearchParams({ date: dateInputToRu(ksoDecisionPreviewForm.date.value) });
    const result = await fetchMiniAppJson(`/api/miniapp/kso-decision/preview?${params.toString()}`);
    renderKsoDecisionPreview(result.preview);
    setStatus(ksoDecisionStatus, 'Preview рассчитан без записи в таблицу.', 'success');
  } catch (error) {
    setStatus(ksoDecisionStatus, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function initTabs() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.adminOnly === 'true' && !isCurrentUserAdmin()) {
        activatePanel('fixation');
        return;
      }

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
  applyAdminOnlyVisibility();

  fillSelect(fixationForm.regionId, state.config.regions, (region) => region.id, (region) => region.name);
  updateShopSelect();
  applyProfileDefaults();
  applyLastSelectionDefaults();
  fixationForm.date.value = todayInputDate();
  document.querySelectorAll('.simple-form [name="date"]').forEach((input) => {
    input.value = todayInputDate();
  });
  if (ksoDecisionPreviewForm?.date) {
    ksoDecisionPreviewForm.date.value = todayInputDate();
  }

  addEvent();
  renderPhotos();
  initTabs();
  initMenuReturn();
  loadRecentFixations().catch(() => {});
  if (isCurrentUserAdmin()) {
    loadKsoDecisionModel().catch(() => {});
  }

  fixationForm.regionId.addEventListener('change', () => {
    updateShopSelect();
    saveLastSelection();
  });
  fixationForm.shopId.addEventListener('change', () => {
    saveLastSelection();
    renderSummary();
  });
  document.querySelector('#addEventBtn').addEventListener('click', () => addEvent());
  startOnlineBtn?.addEventListener('click', () => {
    resetRecordForm('online');
    activatePanel('fixation');
  });
  newFixationBtn?.addEventListener('click', () => {
    resetRecordForm('fixation');
    setStatus(fixationStatus, 'Новая фиксация. Предыдущая запись не изменяется.', '');
  });
  cancelEditBtn?.addEventListener('click', () => {
    resetRecordForm('fixation');
    setStatus(fixationStatus, '', '');
  });
  fixationForm.addEventListener('submit', handleFixationSubmit);
  document.querySelectorAll('.simple-form[data-report-endpoint]').forEach((form) => {
    form.addEventListener('submit', handleSimpleReportSubmit);
  });

  ksoScheduleForm?.querySelectorAll('[data-kso-status]').forEach((button) => {
    button.addEventListener('click', () => setKsoScheduleStatus(button.dataset.ksoStatus));
  });
  ksoScheduleForm?.date.addEventListener('input', renderKsoScheduleConfirm);
  ksoScheduleTodayBtn?.addEventListener('click', () => {
    ksoScheduleForm.date.value = todayInputDate();
    renderKsoScheduleConfirm();
  });
  ksoScheduleForm?.addEventListener('submit', handleKsoScheduleSubmit);
  ksoDecisionPreviewForm?.addEventListener('submit', handleKsoDecisionPreviewSubmit);

  photoDrop?.addEventListener('click', (event) => {
    event.currentTarget.focus();
  });

  photoDrop?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.currentTarget.focus();
    }
  });

  photoDrop?.addEventListener('beforeinput', (event) => {
    if (event.inputType !== 'insertFromPaste') {
      event.preventDefault();
    }
  });

  photoDrop?.addEventListener('input', () => {
    scheduleDropPhotoCapture();
  });

  if (photoDrop) {
    const observer = new MutationObserver(() => {
      scheduleDropPhotoCapture();
    });
    observer.observe(photoDrop, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  document.addEventListener('paste', async (event) => {
    const files = getImageFilesFromPaste(event);
    if (files.length === 0) {
      if (photoDrop?.contains(event.target)) {
        scheduleDropPhotoCapture({ showError: true });
      }
      return;
    }

    event.preventDefault();
    await addPhotoFiles(files);
    renderPhotoDropHint();
  });

  document.addEventListener('keydown', async (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') {
      return;
    }

    const activeTag = document.activeElement?.tagName;
    if (
      document.activeElement !== photoDrop
      && (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable)
    ) {
      return;
    }

    if (await addPhotosFromClipboardApi()) {
      event.preventDefault();
      renderPhotoDropHint();
    }
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
