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

async function askTextReportFio(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TEXT_REPORT_FIO, data);
  await sendCleanupMessage(
    chatId,
    userId,
    'Добро пожаловать! Введите ваше ФИО:',
    inlineKeyboard([[{ text: '← В меню', type: 'callback', payload: 'main_menu' }]])
  );
}

async function askTextReportDate(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TEXT_REPORT_DATE, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    'Укажите дату отчета. Нажмите «Сегодня» или введите дату в формате ДД.ММ.ГГГГ.',
    inlineKeyboard([
      [{ text: 'Сегодня', type: 'callback', payload: 'text_report_date_today' }],
      backButtonRow()
    ])
  );
}

async function askTextReportText(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TEXT_REPORT_TEXT, data);
  await sendCleanupMessage(
    chatId,
    userId,
    'Введите текст отчета:',
    inlineKeyboard([backButtonRow()])
  );
}

function buildTextReportRow(profile, data) {
  return [
    profile.fio,
    data.date,
    data.reportText
  ];
}

function buildTextReportSummary(profile, data) {
  return [
    'Проверьте отчет перед сохранением:',
    '',
    `ФИО: ${profile.fio}`,
    `Дата: ${data.date}`,
    '',
    data.reportText
  ].join('\n');
}

async function showTextReportConfirm(chatId, userId, data) {
  const profile = getProfile(userId);
  if (!profile) {
    return false;
  }

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.TEXT_REPORT_CONFIRM, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    buildTextReportSummary(profile, data),
    inlineKeyboard([
      [{ text: '✅ Сохранить', type: 'callback', payload: 'text_report_save' }],
      [{ text: '← Исправить', type: 'callback', payload: 'form_back' }],
      [{ text: '✏️ Начать заново', type: 'callback', payload: 'text_report_restart' }],
      menuButtonRow()
    ])
  );

  return true;
}

module.exports = {
  askTextReportDate,
  askTextReportFio,
  askTextReportText,
  buildTextReportRow,
  showTextReportConfirm
};
