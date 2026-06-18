const { ROLES } = require('../constants');
const { logError } = require('../logger');
const {
  archiveKsoScheduleRequest,
  getProfile,
  getKsoScheduleRequest,
  getUserRole,
  isAllowedUser,
  listEmployees,
  listCatalogRegions,
  listKsoScheduleRequests,
  reviewKsoScheduleRequest,
  revokeApprovedKsoScheduleRequest,
  saveKsoScheduleRequest,
  updateEmployeeShop,
  updateApprovedKsoScheduleRequest
} = require('../db');
const { sendMessageToUser } = require('../maxClient');
const {
  formatDisplayDate,
  getScheduleMonthSummary,
  getScheduleMonthTable,
  parseInputDate,
  updateScheduleMonth,
  updateScheduleStatus
} = require('../ksoAssignment');

const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((userId) => userId.trim())
  .filter(Boolean);
const KSO_SCHEDULE_REVIEWER_IDS = (process.env.KSO_SCHEDULE_REVIEWER_IDS || '')
  .split(',')
  .map((userId) => userId.trim())
  .filter(Boolean);

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

function normalizeShiftType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (['morning', 'утро', 'утренняя'].includes(normalized)) {
    return 'morning';
  }

  if (['lunch', 'afternoon', 'day', 'обед', 'обеден', 'обеденная'].includes(normalized)) {
    return 'lunch';
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

function getMiniAppUserId(req) {
  return req?.miniAppUserId ? String(req.miniAppUserId) : '';
}

function isReviewer(userId) {
  if (ADMIN_USER_IDS.includes(String(userId)) || KSO_SCHEDULE_REVIEWER_IDS.includes(String(userId))) {
    return true;
  }

  const role = getUserRole(userId);
  return role === ROLES.OPERATOR || role === ROLES.ADMIN;
}

function assertReviewer(req) {
  const userId = getMiniAppUserId(req);
  if (!userId || !isReviewer(userId)) {
    throw createValidationError('Недостаточно прав для согласования графика', 403);
  }

  return userId;
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
  const fallbackShiftType = normalizeShiftType(data.shiftType) || 'morning';

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

    const entryShiftType = normalizeShiftType(entry.shiftType || fallbackShiftType);
    if (hours > 0 && !entryShiftType) {
      throw createValidationError('Выберите тип смены: утро или обед');
    }

    return {
      isoDate,
      hours: hours > 0 ? hours : '',
      shiftType: hours > 0 ? entryShiftType : ''
    };
  });
}

function normalizeRequestType(value) {
  const type = normalizeText(value);
  return type === 'removal' ? 'removal' : 'month';
}

function getReviewerIds() {
  const roleReviewers = listEmployees()
    .filter((employee) => employee.active === 1 && [ROLES.OPERATOR, ROLES.ADMIN].includes(employee.role))
    .map((employee) => String(employee.user_id));

  return [...new Set([...roleReviewers, ...ADMIN_USER_IDS, ...KSO_SCHEDULE_REVIEWER_IDS].filter(Boolean))];
}

function requestTypeLabel(type) {
  return type === 'removal' ? 'Снятие смены' : 'График месяца';
}

function entriesSignature(entries) {
  return JSON.stringify((entries || [])
    .map((entry) => ({
      isoDate: entry.isoDate || entry.date,
      hours: normalizeNumber(entry.hours),
      shiftType: normalizeShiftType(entry.shiftType) || ''
    }))
    .sort((left, right) => String(left.isoDate).localeCompare(String(right.isoDate))));
}

function scheduleWasEdited(before, after) {
  return entriesSignature(before) !== entriesSignature(after);
}

async function notifyScheduleReviewers(request) {
  if (!request || request.status !== 'submitted') {
    return;
  }

  const totalHours = request.entries.reduce((sum, entry) => sum + normalizeNumber(entry.hours), 0);
  const workDays = request.entries.filter((entry) => normalizeNumber(entry.hours) > 0).length;
  const text = [
    'Новая заявка на график работы',
    '',
    `Сотрудник: ${request.fio}`,
    `Месяц: ${request.month}`,
    `Тип: ${requestTypeLabel(request.requestType)}`,
    `Дней: ${workDays}`,
    `Часов: ${totalHours}`,
    '',
    'Откройте miniapp -> График работы'
  ].join('\n');

  await Promise.allSettled(getReviewerIds().map((reviewerId) => sendMessageToUser(reviewerId, text)));
}

async function notifyScheduleApplicant(request, action, wasEdited = false) {
  if (!request?.userId || request.userId === 'miniapp') {
    return;
  }

  const totalHours = request.entries.reduce((sum, entry) => sum + normalizeNumber(entry.hours), 0);
  const workDays = request.entries.filter((entry) => normalizeNumber(entry.hours) > 0).length;
  const isRemoval = request.requestType === 'removal';
  const title = action === 'revoked'
    ? 'Согласованный график отозван. Можно заполнить график заново.'
    : action === 'approved'
    ? isRemoval
      ? 'Заявка на снятие смены согласована.'
      : wasEdited
        ? 'График согласован с изменениями.'
        : 'График согласован.'
    : isRemoval
      ? 'Заявка на снятие смены отклонена.'
      : 'График отклонен.';
  const text = [
    title,
    '',
    `Месяц: ${request.month}`,
    `Тип: ${requestTypeLabel(request.requestType)}`,
    `Дней: ${workDays}`,
    `Часов: ${totalHours}`,
    '',
    action === 'approved'
      ? 'Откройте miniapp -> График работы, чтобы посмотреть утвержденный график.'
      : action === 'revoked'
        ? 'Откройте miniapp -> График работы, чтобы заполнить график заново.'
      : 'Откройте miniapp -> График работы, чтобы посмотреть статус заявки.'
  ].join('\n');

  await sendMessageToUser(request.userId, text).catch((error) => {
    logError('Не удалось отправить уведомление по графику КСО:', error);
  });
}

async function createKsoScheduleMonth(data, req) {
  const entries = normalizeScheduleEntries(data);
  const { userId, profile } = getMiniAppProfile(req, data);
  const region = normalizeText(data.region);
  if (userId && region) {
    updateEmployeeShop(userId, region, profile.shop || '');
    profile.region = region;
  }
  const status = normalizeText(data.status) === 'submitted' ? 'submitted' : 'draft';
  const request = saveKsoScheduleRequest({
    id: normalizeText(data.requestId) || null,
    userId: userId || 'miniapp',
    fio: profile.fio,
    month: parseMonth(data.month),
    requestType: normalizeRequestType(data.requestType),
    status,
    entries,
    comment: normalizeText(data.comment)
  });
  await notifyScheduleReviewers(request);

  return {
    request,
    message: status === 'submitted'
      ? 'График отправлен на согласование.'
      : 'Черновик графика сохранен.',
    totalHours: entries.reduce((sum, entry) => sum + normalizeNumber(entry.hours), 0)
  };
}

async function updateKsoScheduleRegion(data, req) {
  const { userId, profile } = getMiniAppProfile(req, data);
  const region = normalizeText(data.region);
  if (!region) {
    throw createValidationError('Выберите регион графика');
  }

  const exists = listCatalogRegions().some((item) => item.name === region);
  if (!exists) {
    throw createValidationError('Выбранный регион не найден в справочнике');
  }

  updateEmployeeShop(userId, region, profile.shop || '');

  return {
    profile: {
      ...profile,
      region
    },
    message: 'Регион графика сохранен.'
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

async function getKsoScheduleTable(data, req) {
  assertReviewer(req);
  const month = parseMonth(data.month);
  if (!month) {
    throw createValidationError('Укажите месяц в формате ГГГГ-ММ');
  }

  return {
    table: await getScheduleMonthTable(`${month}-01`)
  };
}

function serializeRequest(request) {
  if (!request) {
    return null;
  }

  const profile = request.userId ? getProfile(request.userId) : null;
  return {
    ...request,
    region: profile?.region || '',
    totalHours: request.entries.reduce((sum, entry) => sum + normalizeNumber(entry.hours), 0),
    workDays: request.entries.filter((entry) => normalizeNumber(entry.hours) > 0).length
  };
}

async function listKsoScheduleRequestItems(req) {
  const userId = getMiniAppUserId(req);
  if (!userId) {
    throw createValidationError('Откройте miniapp через MAX', 403);
  }

  const requests = isReviewer(userId)
    ? listKsoScheduleRequests({ limit: 100 })
    : listKsoScheduleRequests({ userId, limit: 50 });

  return {
    requests: requests.map(serializeRequest)
  };
}

async function approveKsoScheduleRequest(data, req) {
  const reviewerId = assertReviewer(req);
  const requestId = normalizeText(data.requestId);
  const action = normalizeText(data.action);

  if (!requestId || !['approved', 'rejected'].includes(action)) {
    throw createValidationError('Укажите заявку и действие согласования');
  }

  const existingRequest = getKsoScheduleRequest(requestId);
  let editedEntries = null;
  if (action === 'approved' && Array.isArray(data.entries)) {
    if (!existingRequest || existingRequest.status !== 'submitted') {
      throw createValidationError('Заявка не найдена или уже обработана', 404);
    }

    editedEntries = normalizeScheduleEntries({
      month: existingRequest.month,
      shiftType: data.shiftType,
      entries: data.entries
    });
  }

  const reviewed = reviewKsoScheduleRequest(requestId, action, reviewerId, normalizeText(data.comment), editedEntries);
  if (!reviewed) {
    throw createValidationError('Заявка не найдена или уже обработана', 404);
  }

  if (action === 'approved') {
    await updateScheduleMonth(reviewerId, { fio: reviewed.fio }, reviewed.entries);
  }
  await notifyScheduleApplicant(reviewed, action, editedEntries ? scheduleWasEdited(existingRequest?.entries, reviewed.entries) : false);

  return {
    request: serializeRequest(reviewed),
    message: action === 'approved' ? 'График одобрен и записан в таблицу.' : 'Заявка отклонена.'
  };
}

async function archiveRejectedKsoScheduleRequest(data, req) {
  assertReviewer(req);
  const requestId = normalizeText(data.requestId);
  if (!requestId) {
    throw createValidationError('Укажите заявку');
  }

  const archived = archiveKsoScheduleRequest(requestId);
  if (!archived) {
    throw createValidationError('Можно скрыть только завершенную заявку, которая еще не скрыта', 404);
  }

  return {
    message: 'Завершенная заявка скрыта.'
  };
}

async function updateApprovedKsoScheduleMonth(data, req) {
  const reviewerId = assertReviewer(req);
  const requestId = normalizeText(data.requestId);
  if (!requestId || !Array.isArray(data.entries)) {
    throw createValidationError('Укажите согласованный график и дни');
  }

  const existing = getKsoScheduleRequest(requestId);
  if (!existing || existing.status !== 'approved' || existing.requestType === 'removal') {
    throw createValidationError('Можно редактировать только согласованный график месяца', 404);
  }

  const entries = normalizeScheduleEntries({
    month: existing.month,
    shiftType: data.shiftType,
    entries: data.entries
  });
  const updated = updateApprovedKsoScheduleRequest(requestId, reviewerId, entries, normalizeText(data.comment));
  if (!updated) {
    throw createValidationError('Согласованный график не найден или уже недоступен', 404);
  }

  await updateScheduleMonth(reviewerId, { fio: updated.fio }, updated.entries);
  await notifyScheduleApplicant(updated, 'approved', scheduleWasEdited(existing.entries, updated.entries));

  return {
    request: serializeRequest(updated),
    message: 'Согласованный график обновлен, сотрудник уведомлен.'
  };
}

async function revokeApprovedKsoScheduleMonth(data, req) {
  const reviewerId = assertReviewer(req);
  const requestId = normalizeText(data.requestId);
  if (!requestId) {
    throw createValidationError('Укажите согласованный график');
  }

  const existing = getKsoScheduleRequest(requestId);
  if (!existing || existing.status !== 'approved' || existing.requestType !== 'month') {
    throw createValidationError('Можно отозвать только согласованный график месяца', 404);
  }

  const clearedEntries = existing.entries.map((entry) => ({
    ...entry,
    hours: '',
    shiftType: ''
  }));
  const revoked = revokeApprovedKsoScheduleRequest(requestId, reviewerId, normalizeText(data.comment));
  if (!revoked) {
    throw createValidationError('Согласованный график не найден или уже недоступен', 404);
  }

  await updateScheduleMonth(reviewerId, { fio: existing.fio }, clearedEntries);
  await notifyScheduleApplicant(revoked, 'revoked', false);

  return {
    request: serializeRequest(revoked),
    message: 'Согласованный график отозван, сотрудник может заполнить его заново.'
  };
}

module.exports = {
  approveKsoScheduleRequest,
  archiveRejectedKsoScheduleRequest,
  revokeApprovedKsoScheduleMonth,
  updateApprovedKsoScheduleMonth,
  createKsoScheduleMonth,
  updateKsoScheduleRegion,
  createKsoScheduleStatus,
  getKsoScheduleMonth,
  getKsoScheduleTable,
  listKsoScheduleRequestItems,
  normalizeScheduleStatus
};
