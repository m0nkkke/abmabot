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

async function askTechReportDate(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TECH_REPORT_DATE, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    'Укажите дату технической неполадки. Нажмите «Сегодня» или введите дату в формате ДД.ММ.ГГГГ.',
    navigationKeyboard([[{ text: 'Сегодня', type: 'callback', payload: 'tech_report_date_today' }]])
  );
}

async function askTechReportText(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TECH_REPORT_TEXT, data);
  await sendCleanupMessage(
    chatId,
    userId,
    'Опишите техническую неполадку:',
    navigationKeyboard()
  );
}

function buildTechReportSummary(profile, data) {
  return [
    'Проверьте отчет по технической неполадке перед сохранением:',
    '',
    `ФИО: ${profile.fio}`,
    `Дата: ${data.date}`,
    '',
    data.techReportText
  ].join('\n');
}

async function showTechReportConfirm(chatId, userId, data) {
  const profile = getProfile(userId);
  if (!profile) {
    return false;
  }

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.TECH_REPORT_CONFIRM, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    buildTechReportSummary(profile, data),
    inlineKeyboard([
      [{ text: '✅ Завершить', type: 'callback', payload: 'tech_report_save' }],
      [{ text: '← Исправить', type: 'callback', payload: 'form_back' }],
      menuButtonRow()
    ])
  );

  return true;
}

function buildTechReportRow(profile, data) {
  return [
    profile.fio,
    data.date,
    data.techReportText
  ];
}

module.exports = {
  askTechReportDate,
  askTechReportText,
  buildTechReportRow,
  showTechReportConfirm
};
