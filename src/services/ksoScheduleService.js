const { getProfile, isAllowedUser } = require('../db');
const {
  formatDisplayDate,
  parseInputDate,
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

module.exports = {
  createKsoScheduleStatus,
  normalizeScheduleStatus
};
