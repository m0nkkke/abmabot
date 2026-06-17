const state = {
  config: null,
  token: null,
  profile: null,
  photos: [],
  events: [],
  mode: 'fixation',
  recentFixations: [],
  shopSelectionTouched: false,
  bonusLoaded: false,
  ksoScheduleDays: [],
  ksoScheduleRequests: [],
  ksoScheduleRequestsLoaded: false,
  ksoScheduleReviewRequestId: '',
  ksoScheduleReviewDays: [],
  ksoScheduleReviewShiftType: 'morning',
  ksoScheduleRequestFilter: 'submitted',
  ksoScheduleReadOnly: false,
  ksoScheduleSelectedDate: ''
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
const ksoScheduleCalendar = document.querySelector('#ksoScheduleCalendar');
const ksoScheduleDraftBtn = document.querySelector('#ksoScheduleDraftBtn');
const ksoScheduleApplyRangeBtn = document.querySelector('#ksoScheduleApplyRangeBtn');
const ksoScheduleRemoveTomorrowBtn = document.querySelector('#ksoScheduleRemoveTomorrowBtn');
const ksoScheduleApprovedPanel = document.querySelector('#ksoScheduleApprovedPanel');
const ksoScheduleRequests = document.querySelector('#ksoScheduleRequests');
const ksoScheduleReviewPanel = document.querySelector('#ksoScheduleReviewPanel');
const ksoScheduleTableWrap = document.querySelector('#ksoScheduleTableWrap');
const ksoScheduleTable = document.querySelector('#ksoScheduleTable');
const ksoScheduleTableRefreshBtn = document.querySelector('#ksoScheduleTableRefreshBtn');
const ksoDecisionModel = document.querySelector('#ksoDecisionModel');
const ksoDecisionStatus = document.querySelector('#ksoDecisionStatus');
const ksoDecisionPreviewForm = document.querySelector('#ksoDecisionPreviewForm');
const ksoDecisionPreview = document.querySelector('#ksoDecisionPreview');
const bonusMonthSelect = document.querySelector('#bonusMonthSelect');
const bonusRefreshBtn = document.querySelector('#bonusRefreshBtn');
const bonusTotal = document.querySelector('#bonusTotal');
const bonusList = document.querySelector('#bonusList');
const bonusStatus = document.querySelector('#bonusStatus');

function todayInputDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}

function tomorrowInputDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
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

function currentMonthInput() {
  return todayInputDate().slice(0, 7);
}

function daysInMonth(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue || ''));
  if (!match) {
    return 0;
  }

  return new Date(Number(match[1]), Number(match[2]), 0).getDate();
}

function buildMonthDate(monthValue, day) {
  return `${monthValue}-${String(day).padStart(2, '0')}`;
}

function normalizeHours(value, fallback = 10) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(24, parsed);
}

function setStatus(element, text, type = '') {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.className = `status ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function initAuthToken() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  const token = params.get('token')
    || hashParams.get('token')
    || params.get('WebAppStartParam')
    || hashParams.get('WebAppStartParam')
    || params.get('start_param')
    || hashParams.get('start_param')
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

async function waitForMaxWebAppData() {
  if (window.WebApp?.initData || window.WebApp?.initDataUnsafe?.start_param) {
    return;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (window.WebApp?.initData || window.WebApp?.initDataUnsafe?.start_param) {
      return;
    }
  }
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

function isCurrentUserReviewer() {
  return isCurrentUserAdmin() || state.config?.user?.role === 'operator';
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

function applyLatestFixationShopDefault() {
  if (state.shopSelectionTouched || state.mode !== 'fixation' || fixationForm.editFixationId.value) {
    return;
  }

  const latest = state.recentFixations[0]?.data || {};
  if (!latest.region || !latest.shop) {
    return;
  }

  const region = findRegionByName(latest.region);
  const shop = region?.shops?.find((item) => item.name === latest.shop);
  if (!shop) {
    return;
  }

  selectRegionShopByNames(latest.region, latest.shop);
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
  applyLatestFixationShopDefault();
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

function renderKsoScheduleConfirm() {
  if (!ksoScheduleForm || !ksoScheduleConfirm) {
    return;
  }

  if (isCurrentUserReviewer()) {
    const selectedDate = state.ksoScheduleSelectedDate;
    const workers = selectedDate ? getKsoScheduleDayWorkers(selectedDate) : [];
    const morningWorkers = workers.filter((worker) => normalizeShiftType(worker.shiftType) === 'morning');
    const lunchWorkers = workers.filter((worker) => normalizeShiftType(worker.shiftType) === 'lunch');
    const renderWorkerGroup = (title, group) => `
      <strong>${title}</strong>
      ${group.length ? group.map((worker) => `
        <span>${escapeHtml(worker.fio)} · ${worker.hours} ч.</span>
      `).join('') : '<span>Нет сотрудников</span>'}
    `;
    ksoScheduleConfirm.innerHTML = selectedDate ? `
      <strong>${dateInputToRu(selectedDate)} · ${weekdayShort(selectedDate)}</strong>
      ${renderWorkerGroup('Утро', morningWorkers)}
      ${renderWorkerGroup('Обед', lunchWorkers)}
    ` : '<strong>Выберите день, чтобы увидеть сотрудников и часы</strong>';
    return;
  }

  const selected = state.ksoScheduleDays.filter((day) => day.selected);
  const totalHours = selected.reduce((sum, day) => sum + normalizeHours(day.hours, 0), 0);
  const averageHours = selected.length ? (totalHours / selected.length).toFixed(1) : '0';
  const title = state.ksoScheduleReadOnly ? 'Утвержденный график' : 'Проверьте график';

  ksoScheduleConfirm.innerHTML = `
    <strong>${title}</strong>
    <span>Выбрано дней: ${selected.length}</span>
    <span>Итого часов: ${totalHours}</span>
    <span>Средняя смена: ${averageHours}</span>
  `;
}

function weekdayShort(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][date.getDay()];
}

function renderKsoScheduleCalendar() {
  if (!ksoScheduleCalendar || !ksoScheduleForm) {
    return;
  }

  ksoScheduleCalendar.innerHTML = '';
  state.ksoScheduleDays.forEach((day, index) => {
    const item = document.createElement('article');
    item.className = `schedule-day${day.selected ? ' active' : ''}${state.ksoScheduleSelectedDate === day.date ? ' selected' : ''}`;
    if (isCurrentUserReviewer()) {
      const workers = getKsoScheduleDayWorkers(day.date);
      const morningCount = workers.filter((worker) => normalizeShiftType(worker.shiftType) === 'morning').length;
      const lunchCount = workers.filter((worker) => normalizeShiftType(worker.shiftType) === 'lunch').length;
      item.innerHTML = `
        <label>
          <span>${day.day} · ${weekdayShort(day.date)}</span>
        </label>
        <div class="schedule-counts">
          <span>утро: ${morningCount}</span>
          <span>обед: ${lunchCount}</span>
          <span>всего: ${day.workingCount || workers.length || 0}</span>
          <span>отдыхают: ${day.restCount || 0}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        state.ksoScheduleSelectedDate = day.date;
        renderKsoScheduleCalendar();
        renderKsoScheduleConfirm();
      });
      ksoScheduleCalendar.append(item);
      return;
    }

    item.innerHTML = `
      <label>
        <input type="checkbox" ${day.selected ? 'checked' : ''} ${state.ksoScheduleReadOnly ? 'disabled' : ''}>
        <span>${day.day} · ${weekdayShort(day.date)}</span>
      </label>
      <input type="number" min="1" max="24" step="0.5" value="${day.selected ? day.hours || ksoScheduleForm.hours.value || 10 : ''}" ${day.selected && !state.ksoScheduleReadOnly ? '' : 'disabled'}>
      <select data-day-shift="${index}" ${day.selected && !state.ksoScheduleReadOnly ? '' : 'disabled'}>
        <option value="morning" ${normalizeShiftType(day.shiftType) === 'morning' ? 'selected' : ''}>Утренняя</option>
        <option value="lunch" ${normalizeShiftType(day.shiftType) === 'lunch' ? 'selected' : ''}>Обеденная</option>
      </select>
      <div class="schedule-counts">
        <span>работают: ${day.workingCount || 0}</span>
        <span>отдыхают: ${day.restCount || 0}</span>
      </div>
    `;

    const checkbox = item.querySelector('input[type="checkbox"]');
    const hoursInput = item.querySelector('input[type="number"]');
    const shiftSelect = item.querySelector('[data-day-shift]');
    checkbox.addEventListener('change', () => {
      if (state.ksoScheduleReadOnly) {
        return;
      }
      state.ksoScheduleDays[index].selected = checkbox.checked;
      if (checkbox.checked) {
        state.ksoScheduleDays[index].shiftType = normalizeShiftType(ksoScheduleForm.shiftType?.value);
      }
      if (checkbox.checked && ksoScheduleForm.applyHoursToAll.checked) {
        state.ksoScheduleDays[index].hours = normalizeHours(ksoScheduleForm.hours.value);
      }
      renderKsoScheduleCalendar();
      renderKsoScheduleConfirm();
    });
    hoursInput.addEventListener('input', () => {
      if (state.ksoScheduleReadOnly) {
        return;
      }
      state.ksoScheduleDays[index].hours = normalizeHours(hoursInput.value);
      renderKsoScheduleConfirm();
    });
    shiftSelect.addEventListener('change', () => {
      if (state.ksoScheduleReadOnly) {
        return;
      }
      state.ksoScheduleDays[index].shiftType = normalizeShiftType(shiftSelect.value);
      renderKsoScheduleConfirm();
    });
    ksoScheduleCalendar.append(item);
  });

  renderKsoScheduleConfirm();
}

function setKsoScheduleRange(startDate, endDate) {
  if (state.ksoScheduleReadOnly || isCurrentUserReviewer()) {
    return;
  }

  if (!startDate || !endDate) {
    return;
  }

  const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  state.ksoScheduleDays = state.ksoScheduleDays.map((day) => {
    if (day.date < from || day.date > to) {
      return day;
    }

    return {
      ...day,
      selected: true,
      hours: normalizeHours(ksoScheduleForm.hours.value),
      shiftType: normalizeShiftType(ksoScheduleForm.shiftType?.value)
    };
  });
  renderKsoScheduleCalendar();
}

function getKsoScheduleTemplateScope() {
  const month = ksoScheduleForm?.month.value || currentMonthInput();
  const totalDays = daysInMonth(month);
  const monthStart = buildMonthDate(month, 1);
  const monthEnd = buildMonthDate(month, totalDays);
  const startDate = ksoScheduleForm?.rangeStart.value || '';
  const endDate = ksoScheduleForm?.rangeEnd.value || '';

  if (!startDate || !endDate) {
    return { from: monthStart, to: monthEnd };
  }

  const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  return {
    from: from < monthStart ? monthStart : from,
    to: to > monthEnd ? monthEnd : to
  };
}

function applyKsoScheduleTemplate(template) {
  if (state.ksoScheduleReadOnly || isCurrentUserReviewer()) {
    return;
  }

  const hours = template === '2-2' ? 14 : 10;
  const scope = getKsoScheduleTemplateScope();
  if (template === 'clear') {
    state.ksoScheduleDays = state.ksoScheduleDays.map((day) => {
      if (day.date < scope.from || day.date > scope.to) {
        return day;
      }

      return { ...day, selected: false, hours, shiftType: normalizeShiftType(ksoScheduleForm.shiftType?.value) };
    });
    ksoScheduleForm.hours.value = 10;
    renderKsoScheduleCalendar();
    return;
  }

  ksoScheduleForm.hours.value = hours;
  let scopeIndex = -1;
  state.ksoScheduleDays = state.ksoScheduleDays.map((day) => {
    if (day.date < scope.from || day.date > scope.to) {
      return day;
    }

    scopeIndex += 1;
    let selected = false;
    if (template === '2-2') {
      selected = Math.floor(scopeIndex / 2) % 2 === 0;
    } else if (template === '5-2') {
      selected = new Date(`${day.date}T00:00:00`).getDay() >= 1 && new Date(`${day.date}T00:00:00`).getDay() <= 5;
    } else if (template === '6-1') {
      selected = new Date(`${day.date}T00:00:00`).getDay() !== 0;
    }

    return { ...day, selected, hours, shiftType: normalizeShiftType(ksoScheduleForm.shiftType?.value) };
  });
  renderKsoScheduleCalendar();
}

function getOwnKsoScheduleDraft() {
  const userId = String(state.config?.user?.userId || '');
  const month = ksoScheduleForm?.month.value || currentMonthInput();

  return (state.ksoScheduleRequests || [])
    .filter((request) => (
      request.status === 'draft'
      && request.month === month
      && request.requestType !== 'removal'
      && String(request.userId || '') === userId
    ))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
}

function applyKsoScheduleDraftToCalendar() {
  if (!state.ksoScheduleRequestsLoaded || !state.ksoScheduleDays.length || !ksoScheduleForm) {
    return;
  }

  if (!isCurrentUserReviewer()) {
    const approved = getKsoApprovedScheduleRequest(state.config?.user?.userId || '', ksoScheduleForm.month.value || currentMonthInput());
    if (approved) {
      const entriesByDate = new Map((approved.entries || []).map((entry) => [getKsoRequestEntryDate(entry), entry]));
      state.ksoScheduleReadOnly = true;
      ksoScheduleForm.requestId.value = '';
      if (ksoScheduleForm.shiftType) {
        ksoScheduleForm.shiftType.value = getRequestShiftType(approved);
      }
      state.ksoScheduleDays = state.ksoScheduleDays.map((day) => {
        const entry = entriesByDate.get(day.date);
        const hours = normalizeHours(entry?.hours, 0);
        return {
          ...day,
          selected: hours > 0,
          hours: hours > 0 ? hours : normalizeHours(ksoScheduleForm.hours.value),
          shiftType: normalizeShiftType(entry?.shiftType)
        };
      });
      renderKsoScheduleCalendar();
      updateKsoScheduleEmployeeControls();
      return;
    }
  }

  state.ksoScheduleReadOnly = false;
  const draft = getOwnKsoScheduleDraft();
  if (!draft) {
    ksoScheduleForm.requestId.value = '';
    updateKsoScheduleEmployeeControls();
    return;
  }

  const entriesByDate = new Map((draft.entries || []).map((entry) => [entry.isoDate || entry.date, entry]));
  if (ksoScheduleForm.shiftType) {
    ksoScheduleForm.shiftType.value = getRequestShiftType(draft);
  }
  state.ksoScheduleDays = state.ksoScheduleDays.map((day) => {
    const entry = entriesByDate.get(day.date);
    const hours = normalizeHours(entry?.hours, 0);
    return {
      ...day,
      selected: hours > 0,
      hours: hours > 0 ? hours : normalizeHours(ksoScheduleForm.hours.value),
      shiftType: normalizeShiftType(entry?.shiftType)
    };
  });
  ksoScheduleForm.requestId.value = draft.id || '';
  renderKsoScheduleCalendar();
  updateKsoScheduleEmployeeControls();
}

function setKsoScheduleLoading(isLoading) {
  if (!ksoScheduleForm) {
    return;
  }

  ksoScheduleForm.classList.toggle('schedule-loading', isLoading);
  if (isLoading) {
    setStatus(ksoScheduleForm.querySelector('.status'), 'Загружаю календарь...', '');
  }
}

function updateKsoScheduleEmployeeControls() {
  if (!ksoScheduleForm) {
    return;
  }

  const disabled = state.ksoScheduleReadOnly || isCurrentUserReviewer();
  ksoScheduleForm.querySelectorAll('[data-schedule-template]').forEach((button) => {
    button.disabled = disabled;
  });
  if (ksoScheduleApplyRangeBtn) {
    ksoScheduleApplyRangeBtn.disabled = disabled;
  }
  if (ksoScheduleDraftBtn) {
    ksoScheduleDraftBtn.disabled = disabled;
  }
  const submitButton = ksoScheduleForm.querySelector('.primary-btn[type="submit"]');
  if (submitButton) {
    submitButton.disabled = disabled;
  }
  ['shiftType', 'hours', 'applyHoursToAll', 'rangeStart', 'rangeEnd'].forEach((name) => {
    if (ksoScheduleForm[name]) {
      ksoScheduleForm[name].disabled = disabled;
    }
  });
}

async function loadKsoScheduleMonth() {
  if (!ksoScheduleForm) {
    return;
  }

  const month = ksoScheduleForm.month.value || currentMonthInput();
  const totalDays = daysInMonth(month);
  state.ksoScheduleSelectedDate = '';
  setKsoScheduleLoading(true);
  try {
    const result = await fetchMiniAppJson(`/api/miniapp/kso-schedule/month?${new URLSearchParams({ month }).toString()}`);
    const summaryByDate = new Map((result.summary?.days || []).map((day) => [day.date, day]));

    state.ksoScheduleDays = Array.from({ length: totalDays }, (_, index) => {
      const day = index + 1;
      const date = buildMonthDate(month, day);
      const summary = summaryByDate.get(date) || {};
      return {
        date,
        day,
        selected: false,
        hours: normalizeHours(ksoScheduleForm.hours.value),
        shiftType: normalizeShiftType(ksoScheduleForm.shiftType?.value),
        workingCount: summary.workingCount || 0,
        restCount: summary.restCount || 0
      };
    });
    renderKsoScheduleCalendar();
    applyKsoScheduleDraftToCalendar();
    updateKsoScheduleEmployeeControls();
    setStatus(ksoScheduleForm.querySelector('.status'), '', '');
  } finally {
    setKsoScheduleLoading(false);
  }
}

function statusText(status) {
  return {
    draft: 'Черновик',
    submitted: 'На согласовании',
    approved: 'Одобрено',
    rejected: 'Отклонено'
  }[status] || status;
}

function normalizeShiftType(value) {
  return value === 'lunch' ? 'lunch' : 'morning';
}

function shiftTypeText(value) {
  return normalizeShiftType(value) === 'lunch' ? 'Обеденная' : 'Утренняя';
}

function shiftTypeShortText(value) {
  return normalizeShiftType(value) === 'lunch' ? 'Обед' : 'Утро';
}

function getRequestShiftType(request) {
  const entry = (request?.entries || []).find((item) => normalizeHours(item.hours, 0) > 0);
  return normalizeShiftType(entry?.shiftType);
}

function getRequestShiftTypeSummary(request) {
  const used = new Set((request?.entries || [])
    .filter((entry) => normalizeHours(entry.hours, 0) > 0)
    .map((entry) => normalizeShiftType(entry.shiftType)));

  if (used.size > 1) {
    return 'Утро и обед';
  }

  return shiftTypeText([...used][0] || 'morning');
}

function requestTypeText(type) {
  return type === 'removal' ? 'Снятие смены' : 'График месяца';
}

function getKsoRequestEntryDate(entry) {
  return entry?.isoDate || entry?.date || '';
}

function getKsoApprovedScheduleRequest(userId, month) {
  return (state.ksoScheduleRequests || [])
    .filter((request) => (
      request.status === 'approved'
      && request.requestType !== 'removal'
      && request.month === month
      && String(request.userId || '') === String(userId || '')
    ))
    .sort((a, b) => String(b.reviewedAt || b.updatedAt || '').localeCompare(String(a.reviewedAt || a.updatedAt || '')))[0];
}

function getKsoRemovalDate(request) {
  return getKsoRequestEntryDate((request?.entries || [])[0]);
}

function getKsoScheduleDayWorkers(date) {
  const month = String(date || '').slice(0, 7);
  return (state.ksoScheduleRequests || [])
    .filter((request) => request.status === 'approved' && request.requestType !== 'removal' && request.month === month)
    .map((request) => {
      const entry = (request.entries || []).find((item) => getKsoRequestEntryDate(item) === date);
      const hours = normalizeHours(entry?.hours, 0);
      return hours > 0 ? { fio: request.fio, hours, shiftType: normalizeShiftType(entry?.shiftType) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.fio.localeCompare(right.fio, 'ru'));
}

function buildKsoScheduleReviewDays(request) {
  const totalDays = daysInMonth(request?.month);
  const sourceRequest = request?.requestType === 'removal'
    ? getKsoApprovedScheduleRequest(request.userId, request.month) || request
    : request;
  const removalDate = request?.requestType === 'removal' ? getKsoRemovalDate(request) : '';
  const entriesByDate = new Map((sourceRequest?.entries || []).map((entry) => [getKsoRequestEntryDate(entry), entry]));
  state.ksoScheduleReviewShiftType = getRequestShiftType(sourceRequest);

  return Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    const date = buildMonthDate(request.month, day);
    const entry = entriesByDate.get(date);
    const hours = normalizeHours(entry?.hours, 0);

    return {
      date,
      day,
      selected: hours > 0,
      hours: hours > 0 ? hours : 10,
      shiftType: normalizeShiftType(entry?.shiftType || state.ksoScheduleReviewShiftType),
      removalTarget: date === removalDate
    };
  });
}

function getSelectedKsoScheduleRequest() {
  return (state.ksoScheduleRequests || [])
    .find((request) => request.id === state.ksoScheduleReviewRequestId);
}

function renderKsoScheduleReviewPanel() {
  if (!ksoScheduleReviewPanel || !isCurrentUserReviewer()) {
    return;
  }

  const request = getSelectedKsoScheduleRequest();
  if (!request) {
    ksoScheduleReviewPanel.classList.add('hidden');
    ksoScheduleReviewPanel.innerHTML = '';
    return;
  }

  ksoScheduleReviewPanel.classList.remove('hidden');
  const selected = state.ksoScheduleReviewDays.filter((day) => day.selected);
  const totalHours = selected.reduce((sum, day) => sum + normalizeHours(day.hours, 0), 0);
  const canEdit = request.requestType !== 'removal' && ['submitted', 'approved'].includes(request.status);
  const calendar = state.ksoScheduleReviewDays.map((day, index) => `
    <article class="schedule-day${day.selected ? ' active' : ''}${day.removalTarget ? ' removal-target' : ''}">
      <label>
        <input type="checkbox" data-review-day="${index}" ${day.selected ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
        <span>${day.day} · ${weekdayShort(day.date)} · ${shiftTypeShortText(day.shiftType)}</span>
      </label>
      <input type="number" min="1" max="24" step="0.5" value="${day.hours}" data-review-hours="${index}" ${day.selected && canEdit ? '' : 'disabled'}>
      <select data-review-shift-day="${index}" ${day.selected && canEdit ? '' : 'disabled'}>
        <option value="morning" ${normalizeShiftType(day.shiftType) === 'morning' ? 'selected' : ''}>Утренняя</option>
        <option value="lunch" ${normalizeShiftType(day.shiftType) === 'lunch' ? 'selected' : ''}>Обеденная</option>
      </select>
      ${day.removalTarget ? '<strong class="schedule-marker">Снятие смены</strong>' : ''}
    </article>
  `).join('');

  ksoScheduleReviewPanel.innerHTML = `
    <section class="decision-card schedule-review-card">
      <h3>${escapeHtml(request.fio)} · ${escapeHtml(request.month)}</h3>
      <p>Тип: ${requestTypeText(request.requestType)}</p>
      <p>Статус: ${statusText(request.status)}</p>
      <label><span>Смена для выбранных дней</span><select data-review-shift ${canEdit ? '' : 'disabled'}>
        <option value="morning" ${state.ksoScheduleReviewShiftType === 'morning' ? 'selected' : ''}>Утренняя</option>
        <option value="lunch" ${state.ksoScheduleReviewShiftType === 'lunch' ? 'selected' : ''}>Обеденная</option>
      </select></label>
      <p>Выбрано дней: ${selected.length}, часов: ${totalHours}</p>
      <div class="schedule-month-grid schedule-review-grid">${calendar}</div>
      ${request.status === 'submitted' ? `
        <div class="two-cols">
          <button class="secondary-btn" type="button" data-review-action="rejected">Отклонить</button>
          <button class="primary-btn" type="button" data-review-action="approved">Сохранить в график</button>
        </div>
      ` : ''}
      ${request.status === 'approved' && request.requestType !== 'removal' ? `
        <div class="two-cols">
          <button class="secondary-btn" type="button" data-revoke-approved>Отозвать график</button>
          <button class="primary-btn" type="button" data-update-approved>Сохранить изменения</button>
        </div>
      ` : ''}
    </section>
  `;

  ksoScheduleReviewPanel.querySelectorAll('[data-review-day]').forEach((input) => {
    input.addEventListener('change', () => {
      const index = Number(input.dataset.reviewDay);
      state.ksoScheduleReviewDays[index].selected = input.checked;
      if (input.checked) {
        state.ksoScheduleReviewDays[index].shiftType = state.ksoScheduleReviewShiftType;
      }
      renderKsoScheduleReviewPanel();
    });
  });

  ksoScheduleReviewPanel.querySelectorAll('[data-review-hours]').forEach((input) => {
    input.addEventListener('change', () => {
      const index = Number(input.dataset.reviewHours);
      state.ksoScheduleReviewDays[index].hours = normalizeHours(input.value);
      renderKsoScheduleReviewPanel();
    });
  });

  ksoScheduleReviewPanel.querySelectorAll('[data-review-shift-day]').forEach((select) => {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.reviewShiftDay);
      state.ksoScheduleReviewDays[index].shiftType = normalizeShiftType(select.value);
      renderKsoScheduleReviewPanel();
    });
  });

  ksoScheduleReviewPanel.querySelector('[data-review-shift]')?.addEventListener('change', (event) => {
    state.ksoScheduleReviewShiftType = normalizeShiftType(event.target.value);
    state.ksoScheduleReviewDays = state.ksoScheduleReviewDays.map((day) => ({
      ...day,
      shiftType: state.ksoScheduleReviewShiftType
    }));
    renderKsoScheduleReviewPanel();
  });

  ksoScheduleReviewPanel.querySelectorAll('[data-review-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const status = ksoScheduleForm.querySelector('.status');
      try {
        const payload = {
          requestId: request.id,
          action: button.dataset.reviewAction,
          shiftType: state.ksoScheduleReviewShiftType
        };

        if (payload.action === 'approved' && request.requestType !== 'removal') {
          payload.entries = state.ksoScheduleReviewDays.map((day) => ({
            date: day.date,
            hours: day.selected ? normalizeHours(day.hours) : 0,
            shiftType: day.selected ? normalizeShiftType(day.shiftType) : ''
          }));
        }

        const result = await submitJson('/api/miniapp/kso-schedule/review', payload);
        setStatus(status, result.message, 'success');
        state.ksoScheduleReviewRequestId = '';
        state.ksoScheduleReviewDays = [];
        renderKsoScheduleReviewPanel();
        await loadKsoScheduleRequests();
        await loadKsoScheduleMonth();
      } catch (error) {
        setStatus(status, error.message, 'error');
      }
    });
  });
  ksoScheduleReviewPanel.querySelector('[data-update-approved]')?.addEventListener('click', async () => {
    const status = ksoScheduleForm.querySelector('.status');
    try {
      const result = await submitJson('/api/miniapp/kso-schedule/update-approved', {
        requestId: request.id,
        entries: state.ksoScheduleReviewDays.map((day) => ({
          date: day.date,
          hours: day.selected ? normalizeHours(day.hours) : 0,
          shiftType: day.selected ? normalizeShiftType(day.shiftType) : ''
        })),
        shiftType: state.ksoScheduleReviewShiftType
      });
      setStatus(status, result.message, 'success');
      state.ksoScheduleReviewRequestId = result.request?.id || request.id;
      state.ksoScheduleReviewDays = buildKsoScheduleReviewDays(result.request || request);
      await loadKsoScheduleRequests();
      await loadKsoScheduleMonth();
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  });
  ksoScheduleReviewPanel.querySelector('[data-revoke-approved]')?.addEventListener('click', async () => {
    const status = ksoScheduleForm.querySelector('.status');
    try {
      const result = await submitJson('/api/miniapp/kso-schedule/revoke-approved', {
        requestId: request.id
      });
      setStatus(status, result.message, 'success');
      state.ksoScheduleReviewRequestId = '';
      state.ksoScheduleReviewDays = [];
      renderKsoScheduleReviewPanel();
      await loadKsoScheduleRequests();
      await loadKsoScheduleMonth();
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  });
}

function openKsoScheduleReviewRequest(requestId) {
  const request = (state.ksoScheduleRequests || []).find((item) => item.id === requestId);
  if (!request || !isCurrentUserReviewer()) {
    return;
  }

  state.ksoScheduleReviewRequestId = request.id;
  state.ksoScheduleReviewDays = buildKsoScheduleReviewDays(request);
  renderKsoScheduleRequests(state.ksoScheduleRequests);
  renderKsoScheduleReviewPanel();
}

function renderKsoApprovedSchedulePanel() {
  if (!ksoScheduleApprovedPanel || !ksoScheduleForm) {
    return;
  }

  ksoScheduleApprovedPanel.classList.add('hidden');
  ksoScheduleApprovedPanel.innerHTML = '';
}

function renderKsoScheduleRequests(requests) {
  if (!ksoScheduleRequests) {
    return;
  }

  const filter = isCurrentUserReviewer() ? state.ksoScheduleRequestFilter : 'all';
  const filtered = (requests || []).filter((request) => {
    if (filter === 'all') {
      return true;
    }
    return request.status === filter;
  });
  const visible = filtered.slice(0, 24);
  const filterHtml = isCurrentUserReviewer() ? `
    <div class="segmented">
      <button class="segment-btn${filter === 'submitted' ? ' active' : ''}" type="button" data-schedule-filter="submitted">На согласовании</button>
      <button class="segment-btn${filter === 'approved' ? ' active' : ''}" type="button" data-schedule-filter="approved">Согласованные</button>
      <button class="segment-btn${filter === 'rejected' ? ' active' : ''}" type="button" data-schedule-filter="rejected">Отклоненные</button>
      <button class="segment-btn${filter === 'all' ? ' active' : ''}" type="button" data-schedule-filter="all">Все</button>
    </div>
  ` : '';
  if (!visible.length) {
    ksoScheduleRequests.innerHTML = `${filterHtml}<section class="decision-card"><h3>Заявок пока нет</h3></section>`;
    ksoScheduleRequests.querySelectorAll('[data-schedule-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.ksoScheduleRequestFilter = button.dataset.scheduleFilter;
        renderKsoScheduleRequests(state.ksoScheduleRequests);
      });
    });
    renderKsoApprovedSchedulePanel();
    return;
  }

  ksoScheduleRequests.innerHTML = `${filterHtml}${visible.map((request) => `
    <section class="decision-card${request.id === state.ksoScheduleReviewRequestId ? ' selected' : ''}" data-request-id="${request.id}">
      <h3>${escapeHtml(request.fio)} · ${escapeHtml(request.month)}</h3>
      <p>Тип: ${requestTypeText(request.requestType)}</p>
      <p>Статус: ${statusText(request.status)}</p>
      <p>Смены: ${getRequestShiftTypeSummary(request)}</p>
      <p>Дней: ${request.workDays}, часов: ${request.totalHours}</p>
      ${isCurrentUserReviewer() ? '<p class="muted">Нажмите, чтобы открыть календарь заявки</p>' : ''}
      ${isCurrentUserReviewer() && request.status === 'rejected' ? `
        <button class="secondary-btn" type="button" data-archive-request>Скрыть отклоненную заявку</button>
      ` : ''}
    </section>
  `).join('')}`;

  ksoScheduleRequests.querySelectorAll('[data-schedule-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.ksoScheduleRequestFilter = button.dataset.scheduleFilter;
      renderKsoScheduleRequests(state.ksoScheduleRequests);
    });
  });

  ksoScheduleRequests.querySelectorAll('[data-request-id]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-archive-request]')) {
        return;
      }

      openKsoScheduleReviewRequest(card.dataset.requestId);
    });
  });
  ksoScheduleRequests.querySelectorAll('[data-archive-request]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const card = button.closest('[data-request-id]');
      const status = ksoScheduleForm.querySelector('.status');
      try {
        const result = await submitJson('/api/miniapp/kso-schedule/archive', {
          requestId: card.dataset.requestId
        });
        setStatus(status, result.message, 'success');
        await loadKsoScheduleRequests();
      } catch (error) {
        setStatus(status, error.message, 'error');
      }
    });
  });
  renderKsoScheduleReviewPanel();
  renderKsoApprovedSchedulePanel();
}

async function loadKsoScheduleRequests() {
  if (!ksoScheduleRequests) {
    return;
  }

  const result = await fetchMiniAppJson('/api/miniapp/kso-schedule/requests');
  state.ksoScheduleRequests = result.requests || [];
  state.ksoScheduleRequestsLoaded = true;
  if (state.ksoScheduleReviewRequestId && !state.ksoScheduleRequests.some((request) => request.id === state.ksoScheduleReviewRequestId)) {
    state.ksoScheduleReviewRequestId = '';
    state.ksoScheduleReviewDays = [];
  }
  renderKsoScheduleRequests(state.ksoScheduleRequests);
  renderKsoScheduleCalendar();
  applyKsoScheduleDraftToCalendar();
  renderKsoApprovedSchedulePanel();
}

function renderKsoScheduleTable(table) {
  if (!ksoScheduleTable) {
    return;
  }

  if (!table?.rows?.length) {
    ksoScheduleTable.innerHTML = '<p class="status">Таблица графика пока пустая.</p>';
    return;
  }

  const dayHeaders = table.days.map((day) => `<th>${day}</th>`).join('');
  const rows = table.rows.map((row) => `
    <tr>
      <td>${row.fio}</td>
      ${table.days.map((day) => `<td>${row.days[String(day)] || ''}</td>`).join('')}
      <td>${row.total || ''}</td>
    </tr>
  `).join('');

  ksoScheduleTable.innerHTML = `
    <table class="schedule-table">
      <thead><tr><th>ФИО</th>${dayHeaders}<th>Итого</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadKsoScheduleTable() {
  if (!ksoScheduleTable || !isCurrentUserReviewer()) {
    return;
  }

  const month = ksoScheduleForm.month.value || currentMonthInput();
  const result = await fetchMiniAppJson(`/api/miniapp/kso-schedule/table?${new URLSearchParams({ month }).toString()}`);
  renderKsoScheduleTable(result.table);
}

async function saveKsoSchedule(statusMode = 'submitted') {
  const status = ksoScheduleForm.querySelector('.status');
  const button = ksoScheduleForm.querySelector('.primary-btn');
  const month = ksoScheduleForm.month.value;

  if (state.ksoScheduleReadOnly || isCurrentUserReviewer()) {
    setStatus(status, 'Утвержденный график нельзя редактировать. Можно запросить снятие завтрашней смены.', 'error');
    return;
  }

  setStatus(status, 'Сохраняю...', '');
  button.disabled = true;

  try {
    const result = await submitJson('/api/miniapp/kso-schedule/month', {
      requestId: ksoScheduleForm.requestId.value || '',
      month,
      status: statusMode,
      shiftType: normalizeShiftType(ksoScheduleForm.shiftType?.value),
      entries: state.ksoScheduleDays.map((day) => ({
        date: day.date,
        hours: day.selected ? normalizeHours(day.hours) : 0,
        shiftType: day.selected ? normalizeShiftType(day.shiftType) : ''
      }))
    });
    ksoScheduleForm.requestId.value = result.request?.id || '';
    await loadKsoScheduleMonth();
    await loadKsoScheduleRequests();
    setStatus(status, result.message || 'График сохранен.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function requestRemoveTomorrowShift() {
  const status = ksoScheduleForm.querySelector('.status');
  const tomorrow = tomorrowInputDate();

  try {
    const result = await submitJson('/api/miniapp/kso-schedule/month', {
      month: tomorrow.slice(0, 7),
      status: 'submitted',
      requestType: 'removal',
      entries: [{ date: tomorrow, hours: 0 }]
    });
    setStatus(status, result.message || 'Заявка на снятие смены отправлена.', 'success');
    ksoScheduleForm.month.value = tomorrow.slice(0, 7);
    await loadKsoScheduleMonth();
    await loadKsoScheduleRequests();
    renderKsoApprovedSchedulePanel();
    setStatus(status, result.message || 'Заявка на снятие смены отправлена.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

async function handleKsoScheduleSubmit(event) {
  event.preventDefault();
  await saveKsoSchedule('submitted');
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

function formatMoney(value) {
  const number = Number(value) || 0;
  return number.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function renderBonusSummary(bonus) {
  if (!bonusMonthSelect || !bonusTotal || !bonusList) {
    return;
  }

  const months = Array.isArray(bonus?.months) ? bonus.months : [];
  bonusMonthSelect.innerHTML = '';
  months.forEach((month) => {
    const option = document.createElement('option');
    option.value = month.value;
    option.textContent = month.label;
    option.selected = month.value === bonus.selectedMonth;
    bonusMonthSelect.append(option);
  });
  bonusMonthSelect.disabled = months.length === 0;

  const monthLabel = bonus?.selectedMonthLabel || 'выбранный месяц';
  bonusTotal.innerHTML = `
    <span>Премия за ${escapeHtml(monthLabel)}</span>
    <strong>${formatMoney(bonus?.totalBonus)} ₽</strong>
    <small>${Number(bonus?.rowsInMonth) || 0} фиксаций в месяце</small>
  `;

  const rows = Array.isArray(bonus?.recentFixations) ? bonus.recentFixations : [];
  if (rows.length === 0) {
    bonusList.innerHTML = '<section class="bonus-empty">Пока нет фиксаций для расчета премии.</section>';
    return;
  }

  bonusList.innerHTML = `
    <h3>Последние 10 фиксаций</h3>
    <div class="bonus-table" role="table" aria-label="Последние фиксации для премии">
      <div class="bonus-row bonus-head" role="row">
        <span role="columnheader">Дата</span>
        <span role="columnheader">Тип</span>
        <span role="columnheader">Сумма</span>
        <span role="columnheader">Премия</span>
      </div>
      ${rows.map((row) => `
        <div class="bonus-row" role="row">
          <span role="cell">
            <strong>${escapeHtml(row.date || '-')}</strong>
            <small>${escapeHtml(row.fixationId || '')}</small>
          </span>
          <span role="cell">${escapeHtml(row.type || '-')}</span>
          <span role="cell">${formatMoney(row.amount)}</span>
          <span role="cell"><strong>${formatMoney(row.bonus)} ₽</strong></span>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadBonusSummary(month = bonusMonthSelect?.value || '') {
  if (!bonusMonthSelect || !bonusTotal || !bonusList) {
    return;
  }

  setStatus(bonusStatus, 'Загружаю премии...', '');
  if (bonusRefreshBtn) {
    bonusRefreshBtn.disabled = true;
  }

  try {
    const params = new URLSearchParams();
    if (month) {
      params.set('month', month);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const result = await fetchMiniAppJson(`/api/miniapp/bonuses${suffix}`);
    renderBonusSummary(result.bonus);
    state.bonusLoaded = true;
    setStatus(bonusStatus, '', '');
  } catch (error) {
    setStatus(bonusStatus, error.message, 'error');
  } finally {
    if (bonusRefreshBtn) {
      bonusRefreshBtn.disabled = false;
    }
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
      if (button.dataset.tab === 'bonuses' && !state.bonusLoaded) {
        loadBonusSummary().catch(() => {});
      }
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
  await waitForMaxWebAppData();
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
  if (ksoScheduleForm?.month) {
    ksoScheduleForm.month.value = currentMonthInput();
  }
  ksoScheduleTableWrap?.classList.add('hidden');

  addEvent();
  renderPhotos();
  initTabs();
  initMenuReturn();
  loadRecentFixations().catch(() => {});
  if (isCurrentUserAdmin()) {
    loadKsoDecisionModel().catch(() => {});
  }
  loadKsoScheduleMonth().catch(() => {});
  loadKsoScheduleRequests().catch(() => {});

  fixationForm.regionId.addEventListener('change', () => {
    state.shopSelectionTouched = true;
    updateShopSelect();
    saveLastSelection();
  });
  fixationForm.shopId.addEventListener('change', () => {
    state.shopSelectionTouched = true;
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

  ksoScheduleForm?.month.addEventListener('change', () => {
    loadKsoScheduleMonth().catch((error) => {
      setStatus(ksoScheduleForm.querySelector('.status'), error.message, 'error');
    });
    renderKsoScheduleReviewPanel();
    renderKsoApprovedSchedulePanel();
  });
  ksoScheduleForm?.querySelectorAll('[data-schedule-template]').forEach((button) => {
    button.addEventListener('click', () => applyKsoScheduleTemplate(button.dataset.scheduleTemplate));
  });
  ksoScheduleApplyRangeBtn?.addEventListener('click', () => {
    setKsoScheduleRange(ksoScheduleForm.rangeStart.value, ksoScheduleForm.rangeEnd.value);
  });
  ksoScheduleForm?.hours.addEventListener('input', () => {
    if (state.ksoScheduleReadOnly || isCurrentUserReviewer()) {
      return;
    }

    if (ksoScheduleForm.applyHoursToAll.checked) {
      state.ksoScheduleDays = state.ksoScheduleDays.map((day) => (
        day.selected ? { ...day, hours: normalizeHours(ksoScheduleForm.hours.value) } : day
      ));
      renderKsoScheduleCalendar();
    }
  });
  ksoScheduleForm?.shiftType?.addEventListener('change', () => {
    if (state.ksoScheduleReadOnly || isCurrentUserReviewer()) {
      return;
    }

    const shiftType = normalizeShiftType(ksoScheduleForm.shiftType.value);
    state.ksoScheduleDays = state.ksoScheduleDays.map((day) => (
      day.selected ? { ...day, shiftType } : day
    ));
    renderKsoScheduleCalendar();
  });
  ksoScheduleForm?.applyHoursToAll.addEventListener('change', () => {
    if (state.ksoScheduleReadOnly || isCurrentUserReviewer()) {
      return;
    }

    if (ksoScheduleForm.applyHoursToAll.checked) {
      state.ksoScheduleDays = state.ksoScheduleDays.map((day) => (
        day.selected ? { ...day, hours: normalizeHours(ksoScheduleForm.hours.value) } : day
      ));
      renderKsoScheduleCalendar();
    }
  });
  ksoScheduleForm?.addEventListener('submit', handleKsoScheduleSubmit);
  ksoScheduleDraftBtn?.addEventListener('click', () => {
    saveKsoSchedule('draft').catch(() => {});
  });
  ksoScheduleRemoveTomorrowBtn?.addEventListener('click', () => {
    requestRemoveTomorrowShift().catch(() => {});
  });
  ksoScheduleTableRefreshBtn?.addEventListener('click', () => {
    loadKsoScheduleTable().catch((error) => {
      setStatus(ksoScheduleForm.querySelector('.status'), error.message, 'error');
    });
  });
  ksoDecisionPreviewForm?.addEventListener('submit', handleKsoDecisionPreviewSubmit);
  bonusMonthSelect?.addEventListener('change', () => {
    loadBonusSummary(bonusMonthSelect.value).catch(() => {});
  });
  bonusRefreshBtn?.addEventListener('click', () => {
    state.bonusLoaded = false;
    loadBonusSummary(bonusMonthSelect?.value || '').catch(() => {});
  });

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
