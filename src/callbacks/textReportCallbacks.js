const { getProfile, getSession, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { logError } = require('../logger');
const { sendMessage } = require('../maxClient');
const { appendTextReportRow } = require('../sheets');
const { STATES } = require('../states');
const { todayMskPlus5 } = require('../validators');
const { cleanupMessages, deleteCallbackMessage, sendCleanupMessage } = require('../flows/cleanupFlow');
const {
  askTextReportDate,
  askTextReportText,
  buildTextReportRow
} = require('../flows/textReportFlow');
const { sendKeyboardMessage } = require('../flows/keyboardSession');

function repeatOrMenuAttachments(repeatPayload, repeatText) {
  return inlineKeyboard([
    [{ text: repeatText, type: 'callback', payload: repeatPayload }],
    [{ text: '← В меню', type: 'callback', payload: 'main_menu' }]
  ]);
}

async function handleTextReportCallback(update, chatId, userId, session, payload, options = {}) {
  if (payload === 'main_text_report' || payload === 'new_text_report') {
    await options.startTextReportFlow(chatId, userId);
    return true;
  }

  if (payload === 'text_report_date_today') {
    if (!session || session.state !== STATES.AWAIT_TEXT_REPORT_DATE) {
      await askTextReportDate(chatId, userId, session?.data || {});
      return true;
    }

    let data = { ...session.data, date: todayMskPlus5() };
    await deleteCallbackMessage(update);
    data = await options.sendFormMessage(chatId, data, `Дата отчета: ${data.date}`);
    await askTextReportText(chatId, userId, data);
    return true;
  }

  if (payload === 'text_report_restart') {
    await deleteCallbackMessage(update);
    await askTextReportDate(chatId, userId, {});
    return true;
  }

  if (payload === 'text_report_save') {
    const currentSession = getSession(userId);
    const profile = getProfile(userId);

    if (!profile || !currentSession || currentSession.state !== STATES.TEXT_REPORT_CONFIRM) {
      await sendMessage(chatId, 'Данные отчета для сохранения не найдены. Начнём заново.');
      await options.startFlow(chatId, userId);
      return true;
    }

    try {
      await sendCleanupMessage(chatId, userId, 'Сохраняю отчет в Google Sheets, пожалуйста подождите...');
      await appendTextReportRow(buildTextReportRow(profile, currentSession.data));
      await cleanupMessages(userId);
      await deleteCallbackMessage(update);
      saveSession(userId, STATES.IDLE, {});
      await sendKeyboardMessage(
        chatId,
        userId,
        '✅ Отчет сохранен.',
        repeatOrMenuAttachments('new_text_report', '+ Новый отчет')
      );
    } catch (error) {
      logError('Не удалось сохранить текстовый отчет в Google Sheets:', error);
      await sendMessage(chatId, 'Не удалось записать отчет в Google Sheets. Попробуйте сохранить ещё раз позже.');
    }
    return true;
  }

  return false;
}

module.exports = { handleTextReportCallback };
