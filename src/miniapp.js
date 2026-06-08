const { randomUUID } = require('crypto');
const express = require('express');
const { EVENT_TYPES, MAX_PHOTOS_PER_RECORD, VIOLATION_TYPES } = require('./constants');
const { getCatalogShop } = require('./db');
const {
  appendKsoReportRow,
  appendRow,
  appendTechReportRow,
  appendTextReportRow
} = require('./sheets');
const { savePhotoDataUrl } = require('./photos');
const { getRegions, getShopsByRegion } = require('./shops');

const router = express.Router();

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

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeAmount(value) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function validateDate(value) {
  return /^\d{2}\.\d{2}\.\d{4}$/.test(normalizeText(value));
}

function getShopOrThrow(shopId) {
  const shop = getCatalogShop(shopId);
  if (!shop) {
    const error = new Error('Магазин не найден');
    error.statusCode = 400;
    throw error;
  }

  return shop;
}

function getEventsOrThrow(body) {
  const events = Array.isArray(body.events) ? body.events : [];
  const normalized = events.map((event) => ({
    item: normalizeText(event.item),
    eventType: normalizeText(event.eventType),
    violationType: normalizeText(event.violationType),
    amount: normalizeAmount(event.amount),
    missedReason: normalizeText(event.missedReason)
  }));

  if (!normalized.length) {
    const error = new Error('Добавьте хотя бы одну позицию фиксации');
    error.statusCode = 400;
    throw error;
  }

  normalized.forEach((event) => {
    if (!event.item) {
      const error = new Error('У каждой позиции должно быть наименование товара');
      error.statusCode = 400;
      throw error;
    }

    if (!Object.values(EVENT_TYPES).includes(event.eventType)) {
      const error = new Error('Некорректный тип фиксации');
      error.statusCode = 400;
      throw error;
    }

    if (event.eventType === EVENT_TYPES.VIOLATION && !Object.values(VIOLATION_TYPES).includes(event.violationType)) {
      const error = new Error('Выберите вид нарушения');
      error.statusCode = 400;
      throw error;
    }

    if (event.amount === null) {
      const error = new Error('Сумма должна быть числом');
      error.statusCode = 400;
      throw error;
    }

    if (event.eventType === EVENT_TYPES.MISSED_THEFT && !event.missedReason) {
      const error = new Error('Для упущенной кражи укажите причину');
      error.statusCode = 400;
      throw error;
    }
  });

  return normalized;
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

async function savePhotos(photoDataUrls, userId) {
  const photos = Array.isArray(photoDataUrls) ? photoDataUrls.slice(0, MAX_PHOTOS_PER_RECORD) : [];
  const saved = [];

  for (const photoDataUrl of photos) {
    saved.push(await savePhotoDataUrl(photoDataUrl, userId));
  }

  return saved;
}

router.get('/config', (req, res) => {
  const regions = getRegions().map((region) => ({
    id: region.id,
    name: region.name,
    shops: getShopsByRegion(region.id).map((shop) => ({
      id: shop.id,
      name: shop.name,
      address: shop.address || ''
    }))
  }));

  res.json({
    regions,
    eventTypes: EVENT_TYPES,
    violationTypes: VIOLATION_TYPES,
    maxPhotos: MAX_PHOTOS_PER_RECORD
  });
});

router.post('/fixations', async (req, res, next) => {
  try {
    const fio = normalizeText(req.body.fio);
    const date = normalizeText(req.body.date);
    const shop = getShopOrThrow(req.body.shopId);
    const events = getEventsOrThrow(req.body);

    if (!fio) {
      const error = new Error('Укажите ФИО');
      error.statusCode = 400;
      throw error;
    }

    if (!validateDate(date)) {
      const error = new Error('Укажите дату в формате ДД.ММ.ГГГГ');
      error.statusCode = 400;
      throw error;
    }

    if (!Array.isArray(req.body.photos) || req.body.photos.length < 1) {
      const error = new Error('Добавьте хотя бы одно фото');
      error.statusCode = 400;
      throw error;
    }

    const photos = await savePhotos(req.body.photos, req.body.userId || 'miniapp');
    const fixationId = randomUUID();

    for (const event of events) {
      const row = buildFixationRow({ fio, shop, date, event, photos, fixationId });
      await appendRow(shop.region || 'Без региона', row);
    }

    res.json({ ok: true, fixationId, rows: events.length, photos: photos.length });
  } catch (error) {
    next(error);
  }
});

router.post('/text-report', async (req, res, next) => {
  try {
    const fio = normalizeText(req.body.fio);
    const date = normalizeText(req.body.date);
    const text = normalizeText(req.body.text);

    if (!fio || !validateDate(date) || !text) {
      const error = new Error('Заполните ФИО, дату и текст отчета');
      error.statusCode = 400;
      throw error;
    }

    await appendTextReportRow([fio, date, text]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/kso-report', async (req, res, next) => {
  try {
    const fio = normalizeText(req.body.fio);
    const date = normalizeText(req.body.date);
    const text = normalizeText(req.body.text);

    if (!fio || !validateDate(date) || !text) {
      const error = new Error('Заполните ФИО, дату и текст отписки КСО');
      error.statusCode = 400;
      throw error;
    }

    await appendKsoReportRow([fio, date, text]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/tech-report', async (req, res, next) => {
  try {
    const fio = normalizeText(req.body.fio);
    const date = normalizeText(req.body.date);
    const text = normalizeText(req.body.text);

    if (!fio || !validateDate(date) || !text) {
      const error = new Error('Заполните ФИО, дату и описание технической неполадки');
      error.statusCode = 400;
      throw error;
    }

    await appendTechReportRow([fio, date, text]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  console.error(`[${new Date().toISOString()}] Ошибка mini app API:`, error);
  res.status(error.statusCode || 500).json({
    ok: false,
    error: error.message || 'Ошибка mini app API'
  });
});

module.exports = { miniAppApiRouter: router };
