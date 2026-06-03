const { getProfile, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { STATES } = require('../states');
const { formatDisplayDate } = require('../ksoAssignment');
const { sendCleanupMessage } = require('./cleanupFlow');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

function backButtonRow() {
  return [{ text: '← Назад', type: 'callback', payload: 'form_back' }];
}

function menuButtonRow() {
  return [{ text: '← В меню', type: 'callback', payload: 'main_menu' }];
}

function statusLabel(status) {
  return status === 'Р' ? 'Работаю' : 'Выходной';
}

async function askKsoScheduleStatus(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_KSO_SCHEDULE_STATUS, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    'Выберите статус для графика КСО:',
    inlineKeyboard([
      [{ text: 'Работаю', type: 'callback', payload: 'kso_schedule_status_work' }],
      [{ text: 'Выходной', type: 'callback', payload: 'kso_schedule_status_off' }],
      menuButtonRow()
    ])
  );
}

async function askKsoScheduleDate(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_KSO_SCHEDULE_DATE, data);
  await sendCleanupMessage(
    chatId,
    userId,
    `Укажите дату для статуса «${statusLabel(data.status)}». Нажмите «Сегодня» или введите дату в формате ДД.ММ или ДД.ММ.ГГГГ.`,
    inlineKeyboard([
      [{ text: 'Сегодня', type: 'callback', payload: 'kso_schedule_date_today' }],
      backButtonRow(),
      menuButtonRow()
    ])
  );
}

function buildKsoScheduleSummary(profile, data) {
  return [
    'Проверьте изменение графика КСО:',
    '',
    `ФИО: ${profile.fio}`,
    `Дата: ${formatDisplayDate(data.isoDate)}`,
    `Статус: ${statusLabel(data.status)}`
  ].join('\n');
}

async function showKsoScheduleConfirm(chatId, userId, data) {
  const profile = getProfile(userId);
  if (!profile) {
    return false;
  }

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.KSO_SCHEDULE_CONFIRM, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    buildKsoScheduleSummary(profile, data),
    inlineKeyboard([
      [{ text: '✅ Сохранить', type: 'callback', payload: 'kso_schedule_save' }],
      [{ text: '← Изменить', type: 'callback', payload: 'form_back' }],
      menuButtonRow()
    ])
  );

  return true;
}

module.exports = {
  askKsoScheduleDate,
  askKsoScheduleStatus,
  showKsoScheduleConfirm,
  statusLabel
};
