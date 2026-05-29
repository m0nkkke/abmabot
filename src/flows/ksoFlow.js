const { getProfile, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { STATES } = require('../states');
const { sendCleanupMessage } = require('./cleanupFlow');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

function backButtonRow() {
  return [{ text: '← Назад', type: 'callback', payload: 'form_back' }];
}

function menuButtonRow() {
  return [{ text: '← В меню', type: 'callback', payload: 'main_menu' }];
}

function navigationKeyboard(extraRows = []) {
  return inlineKeyboard([
    ...extraRows,
    backButtonRow(),
    menuButtonRow()
  ]);
}

async function askKsoDate(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_KSO_DATE, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    'Укажите дату отписки КСО. Нажмите «Сегодня» или введите дату в формате ДД.ММ.ГГГГ.',
    navigationKeyboard([[{ text: 'Сегодня', type: 'callback', payload: 'kso_date_today' }]])
  );
}

async function askKsoText(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_KSO_TEXT, data);
  await sendCleanupMessage(
    chatId,
    userId,
    'Введите текст отписки КСО:',
    navigationKeyboard()
  );
}

function buildKsoSummary(profile, data) {
  return [
    'Проверьте отписку КСО перед сохранением:',
    '',
    `ФИО: ${profile.fio}`,
    `Дата: ${data.date}`,
    '',
    data.ksoText
  ].join('\n');
}

async function showKsoConfirm(chatId, userId, data) {
  const profile = getProfile(userId);
  if (!profile) {
    return false;
  }

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.KSO_CONFIRM, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    buildKsoSummary(profile, data),
    inlineKeyboard([
      [{ text: '✅ Завершить', type: 'callback', payload: 'kso_save' }],
      [{ text: '← Исправить', type: 'callback', payload: 'form_back' }],
      menuButtonRow()
    ])
  );

  return true;
}

function buildKsoReportRow(profile, data) {
  return [
    profile.fio,
    data.date,
    data.ksoText
  ];
}

module.exports = {
  askKsoDate,
  askKsoText,
  buildKsoReportRow,
  showKsoConfirm
};
