const { randomUUID } = require('crypto');
const { EVENT_TYPES, MAX_PHOTOS_PER_RECORD, VIOLATION_TYPES } = require('../constants');
const { getCatalogShop, listRecentFixations, saveRecentFixation } = require('../db');
const { savePhotoDataUrl } = require('../photos');
const { appendOnlineTheftRow, appendRow, replaceFixationRows } = require('../sheets');
const { isValidDate, parseAmount } = require('../validators');

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeSheetsFormulaText(value) {
  return String(value || '').replace(/"/g, '""');
}

function buildPhotoPreviewFormula(photoUrl) {
  if (!photoUrl) {
    return '';
  }

  return `=IMAGE("${escapeSheetsFormulaText(photoUrl)}")`;
}

function formatEventTypeForSheet(event) {
  if (event.eventType === EVENT_TYPES.VIOLATION && event.violationType) {
    return `${event.eventType}: ${event.violationType}`;
  }

  return event.eventType;
}

function buildPhotoCells(photos) {
  const cells = [];
  const safePhotos = (Array.isArray(photos) ? photos : []).slice(0, MAX_PHOTOS_PER_RECORD);

  for (let index = 0; index < MAX_PHOTOS_PER_RECORD; index += 1) {
    const photo = safePhotos[index];
    cells.push(buildPhotoPreviewFormula(photo?.photoUrl));
    cells.push(photo?.photoUrl || '');
  }

  return cells;
}

function getPhotos(data) {
  if (Array.isArray(data.photos)) {
    return data.photos;
  }

  if (data.photoUrl) {
    return [{
      photoUrl: data.photoUrl,
      photoFileName: data.photoFileName,
      photoAttachmentPayload: data.photoAttachmentPayload
    }];
  }

  return [];
}

function getEvents(data) {
  if (Array.isArray(data.events) && data.events.length) {
    return data.events;
  }

  if (!data.eventType) {
    return [];
  }

  return [{
    item: data.item,
    eventType: data.eventType,
    violationType: data.violationType,
    amount: data.amount,
    missedReason: data.missedReason
  }];
}

function getShopOrThrow(shopId) {
  const shop = getCatalogShop(shopId);
  if (!shop) {
    throw createValidationError('Магазин не найден');
  }

  return shop;
}

function normalizeAmount(value) {
  return parseAmount(String(value ?? ''));
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : []).map((event) => ({
    item: normalizeText(event.item),
    eventType: normalizeText(event.eventType),
    violationType: normalizeText(event.violationType),
    amount: normalizeAmount(event.amount),
    missedReason: normalizeText(event.missedReason)
  }));
}

function validateEvents(events) {
  if (!events.length) {
    throw createValidationError('Добавьте хотя бы одну позицию фиксации');
  }

  events.forEach((event) => {
    if (!event.item) {
      throw createValidationError('У каждой позиции должно быть наименование товара');
    }

    if (!Object.values(EVENT_TYPES).includes(event.eventType)) {
      throw createValidationError('Некорректный тип фиксации');
    }

    if (event.eventType === EVENT_TYPES.VIOLATION && !Object.values(VIOLATION_TYPES).includes(event.violationType)) {
      throw createValidationError('Выберите вид нарушения');
    }

    if (event.amount === null) {
      throw createValidationError('Сумма должна быть числом');
    }

    if (event.eventType === EVENT_TYPES.MISSED_THEFT && !event.missedReason) {
      throw createValidationError('Для упущенной кражи укажите причину');
    }
  });
}

function buildFixationRow({ fio, shop, date, event, photos, fixationId }) {
  const recordId = randomUUID();

  return [
    fio,
    shop.region,
    shop.name,
    date,
    event.item,
    formatEventTypeForSheet(event),
    event.eventType === EVENT_TYPES.THEFT ? event.amount : '',
    event.eventType === EVENT_TYPES.MISSED_THEFT ? event.amount : '',
    event.eventType === EVENT_TYPES.VIOLATION ? event.amount : '',
    event.missedReason || '',
    ...buildPhotoCells(photos),
    fixationId,
    recordId
  ];
}

function buildRecentFixationData({ shop, date, events }) {
  return {
    region: shop.region || '',
    shop: shop.name || '',
    date: date || '',
    item: events[0]?.item || '',
    events: events.map((event) => ({
      item: event.item || '',
      eventType: event.eventType,
      violationType: event.violationType || '',
      amount: event.amount,
      missedReason: event.missedReason || ''
    }))
  };
}

function buildBotPhotoCells(data) {
  return buildPhotoCells(getPhotos(data));
}

function buildBotFixationRow(profile, data, event, fixationId, recordId) {
  return [
    profile.fio,
    data.region || '',
    data.shop || '',
    data.date,
    event.item || data.item || '',
    formatEventTypeForSheet(event),
    event.eventType === EVENT_TYPES.THEFT ? event.amount : '',
    event.eventType === EVENT_TYPES.MISSED_THEFT ? event.amount : '',
    event.eventType === EVENT_TYPES.VIOLATION ? event.amount : '',
    event.missedReason || '',
    ...buildBotPhotoCells(data),
    fixationId,
    recordId
  ];
}

function buildBotFixationRows(profile, data) {
  const fixationId = data.editFixationId || randomUUID();
  return getEvents(data).map((event) => {
    const recordId = randomUUID();
    return {
      event,
      fixationId,
      recordId,
      row: buildBotFixationRow(profile, data, event, fixationId, recordId)
    };
  });
}

function buildOnlineTheftRow(profile, data, event, fixationId, recordId) {
  const baseCells = [
    profile.fio,
    data.region || '',
    data.shop || '',
    data.date,
    event.item || data.item || '',
    formatEventTypeForSheet(event),
    event.eventType === EVENT_TYPES.THEFT ? event.amount : '',
    event.eventType === EVENT_TYPES.MISSED_THEFT ? event.amount : '',
    event.eventType === EVENT_TYPES.VIOLATION ? event.amount : '',
    event.missedReason || '',
    data.onlineComment || ''
  ];

  return [
    ...baseCells,
    ...buildBotPhotoCells(data),
    fixationId,
    recordId
  ];
}

function buildOnlineTheftRows(profile, data) {
  const fixationId = randomUUID();
  return getEvents(data).map((event) => {
    const recordId = randomUUID();
    return {
      event,
      fixationId,
      recordId,
      row: buildOnlineTheftRow(profile, data, event, fixationId, recordId)
    };
  });
}

async function saveBotFixation({ profile, data }) {
  const isOnlineTheft = data.reportKind === 'online';
  const rows = isOnlineTheft
    ? buildOnlineTheftRows(profile, data)
    : buildBotFixationRows(profile, data);

  if (!rows.length) {
    return { isOnlineTheft, rows };
  }

  if (isOnlineTheft) {
    for (const row of rows) {
      await appendOnlineTheftRow(row.row);
    }
  } else if (data.editFixationId) {
    await replaceFixationRows(
      data.editOriginalRegion || 'Без региона',
      data.region || 'Без региона',
      data.editFixationId,
      rows.map((row) => row.row)
    );
  } else {
    for (const row of rows) {
      await appendRow(data.region || 'Без региона', row.row);
    }
  }

  return { isOnlineTheft, rows };
}

async function savePhotos(photoDataUrls, userId) {
  const photos = Array.isArray(photoDataUrls) ? photoDataUrls.slice(0, MAX_PHOTOS_PER_RECORD) : [];
  const saved = [];

  for (const photoDataUrl of photos) {
    saved.push(await savePhotoDataUrl(photoDataUrl, userId));
  }

  return saved;
}

async function createFixation({ fio, date, shopId, events: rawEvents, photos: rawPhotos, userId, editFixationId, editOriginalRegion }) {
  const normalizedFio = normalizeText(fio);
  const normalizedDate = normalizeText(date);
  const shop = getShopOrThrow(shopId);
  const events = normalizeEvents(rawEvents);

  if (!normalizedFio) {
    throw createValidationError('Укажите ФИО');
  }

  if (!isValidDate(normalizedDate)) {
    throw createValidationError('Укажите дату в формате ДД.ММ.ГГГГ');
  }

  validateEvents(events);

  if (!Array.isArray(rawPhotos) || rawPhotos.length < 1) {
    throw createValidationError('Добавьте хотя бы одно фото');
  }

  const photos = await savePhotos(rawPhotos, userId || 'miniapp');
  const fixationId = editFixationId || randomUUID();
  const rows = [];

  for (const event of events) {
    rows.push(buildFixationRow({
      fio: normalizedFio,
      shop,
      date: normalizedDate,
      event,
      photos,
      fixationId
    }));
  }

  if (editFixationId) {
    await replaceFixationRows(
      editOriginalRegion || shop.region || 'Без региона',
      shop.region || 'Без региона',
      editFixationId,
      rows
    );
  } else {
    for (const row of rows) {
      await appendRow(shop.region || 'Без региона', row);
    }
  }

  if (userId) {
    saveRecentFixation(
      userId,
      fixationId,
      buildRecentFixationData({ shop, date: normalizedDate, events })
    );
  }

  return {
    fixationId,
    rows: events.length,
    photos: photos.length
  };
}

async function createOnlineTheft({ fio, date, shopId, events: rawEvents, photos: rawPhotos, onlineComment, userId }) {
  const normalizedFio = normalizeText(fio);
  const normalizedDate = normalizeText(date);
  const shop = getShopOrThrow(shopId);
  const events = normalizeEvents(rawEvents);
  const comment = normalizeText(onlineComment);

  if (!normalizedFio) {
    throw createValidationError('Укажите ФИО');
  }

  if (!isValidDate(normalizedDate)) {
    throw createValidationError('Укажите дату в формате ДД.ММ.ГГГГ');
  }

  validateEvents(events);

  if (events.some((event) => event.eventType === EVENT_TYPES.VIOLATION)) {
    throw createValidationError('Для онлайн-краж доступны только кража и упущенная кража');
  }

  if (!comment) {
    throw createValidationError('Укажите комментарий к онлайн-краже');
  }

  if (!Array.isArray(rawPhotos) || rawPhotos.length < 1) {
    throw createValidationError('Добавьте хотя бы одно фото');
  }

  const photos = await savePhotos(rawPhotos, userId || 'miniapp');
  const profile = { fio: normalizedFio };
  const rows = buildOnlineTheftRows(profile, {
    reportKind: 'online',
    region: shop.region || '',
    shop: shop.name || '',
    date: normalizedDate,
    events,
    photos,
    onlineComment: comment
  });

  for (const row of rows) {
    await appendOnlineTheftRow(row.row);
  }

  return {
    fixationId: rows[0]?.fixationId || null,
    rows: events.length,
    photos: photos.length
  };
}

function listMiniAppRecentFixations(userId, limit = 5) {
  if (!userId) {
    return [];
  }

  return listRecentFixations(userId, limit);
}

module.exports = {
  buildBotFixationRows,
  buildFixationRow,
  buildOnlineTheftRows,
  createFixation,
  createOnlineTheft,
  getEvents,
  getPhotos,
  listMiniAppRecentFixations,
  saveBotFixation,
  normalizeEvents
};
