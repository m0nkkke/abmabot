const { saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { STATES } = require('../states');
const { sendCleanupMessage } = require('./cleanupFlow');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

async function askTextReportFio(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TEXT_REPORT_FIO, data);
  await sendCleanupMessage(chatId, userId, 'Введите ФИО для отчета:');
}

async function askTextReportDate(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TEXT_REPORT_DATE, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    'Укажите дату отчета. Нажмите «Сегодня» или введите дату в формате ДД.ММ.ГГГГ.',
    inlineKeyboard([
      [{ text: 'Сегодня', type: 'callback', payload: 'text_report_date_today' }]
    ])
  );
}

async function askTextReportText(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_TEXT_REPORT_TEXT, data);
  await sendCleanupMessage(chatId, userId, 'Введите текст отчета:');
}

function buildTextReportRow(data) {
  return [
    data.fio,
    data.date,
    data.reportText
  ];
}

module.exports = {
  askTextReportDate,
  askTextReportFio,
  askTextReportText,
  buildTextReportRow
};
