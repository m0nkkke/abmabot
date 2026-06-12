const { getProfile, isAllowedUser } = require('../db');
const {
  formatDisplayDate,
  getScheduleMonthSummary,
  parseInputDate,
  updateScheduleMonth,
  updateScheduleStatus
} = require('../ksoAssignment');

function createValidationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIsoDate(value) {
  const text = normalizeText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return '';
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return '';
  }

  return text;
}

function parseMonth(value) {
  const text = normalizeText(value);
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) {
    return '';
  }

  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? text : '';
}

function normalizeScheduleStatus(value) {
  const normalized = normalizeText(value).toLowerCase();

  if (['work', 'working', 'r', 'р', 'работаю'].includes(normalized)) {
    return 'Р';
  }

  if (['off', 'dayoff', 'v', 'в', 'выходной'].includes(normalized)) {
    return 'В';
  }

  return '';
}

function getMiniAppProfile(req, data) {
  const userId = req?.miniAppUserId ? String(req.miniAppUserId) : '';

  if (userId) {
    if (!isAllowedUser(userId)) {
      throw createValidationError('Нет доступа к графику КСО', 403);
    }

    const profile = getProfile(userId);
    if (!profile?.fio) {
      throw createValidationError('Заполните профиль в боте перед записью графика КСО', 403);
    }

    return { userId, profile };
  }

  const fio = normalizeText(data.fio);
  if (!fio) {
    throw createValidationError('Откройте miniapp через MAX или укажите ФИО');
  }

  return {
    userId: '',
    profile: { fio }
  };
}

async function createKsoScheduleStatus(data, req) {
  const isoDate = parseInputDate(data.date);
  const status = normalizeScheduleStatus(data.status);

  if (!isoDate || !status) {
    throw createValidationError('Выберите статус и укажите дату в формате ДД.ММ или ДД.ММ.ГГГГ');
  }

  const { userId, profile } = getMiniAppProfile(req, data);
  const message = await updateScheduleStatus(userId || 'miniapp', profile, isoDate, status);

  return {
    message,
    date: formatDisplayDate(isoDate),
    status,
    statusText: status === 'Р' ? 'Работаю' : 'Выходной'
  };
}

function normalizeScheduleEntries(data) {
  const month = parseMonth(data.month);
  const entries = Array.isArray(data.entries) ? data.entries : [];

  if (!month || entries.length === 0) {
    throw createValidationError('Выберите месяц и хотя бы один день графика');
  }

  return entries.map((entry) => {
    const isoDate = parseIsoDate(entry.date);
    if (!isoDate || isoDate.slice(0, 7) !== month) {
      throw createValidationError('Все даты графика должны относиться к выбранному месяцу');
    }

    const hours = normalizeNumber(entry.hours);
    if (hours < 0 || hours > 24) {
      throw createValidationError('Количество часов должно быть от 0 до 24');
    }

    return {
      isoDate,
      hours: hours > 0 ? hours : ''
    };
  });
}

async function createKsoScheduleMonth(data, req) {
  const entries = normalizeScheduleEntries(data);
  const { userId, profile } = getMiniAppProfile(req, data);
  const message = await updateScheduleMonth(userId || 'miniapp', profile, entries);

  return {
    message,
    totalHours: entries.reduce((sum, entry) => sum + normalizeNumber(entry.hours), 0)
  };
}

async function getKsoScheduleMonth(data) {
  const month = parseMonth(data.month);
  if (!month) {
    throw createValidationError('Укажите месяц в формате ГГГГ-ММ');
  }

  return {
    summary: await getScheduleMonthSummary(`${month}-01`)
  };
}

module.exports = {
  createKsoScheduleMonth,
  createKsoScheduleStatus,
  getKsoScheduleMonth,
  normalizeScheduleStatus
};
