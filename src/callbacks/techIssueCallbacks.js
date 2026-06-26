const { getProfile, getSession, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { logError } = require('../logger');
const { sendMessage } = require('../maxClient');
const { createTechReport } = require('../services/reportService');
const { STATES } = require('../states');
const { todayMskPlus5 } = require('../validators');
const { cleanupMessages, deleteCallbackMessage, sendCleanupMessage } = require('../flows/cleanupFlow');
const {
  askTechReportDate,
  askTechReportText
} = require('../flows/techIssueFlow');
const { sendKeyboardMessage } = require('../flows/keyboardSession');

function repeatOrMenuAttachments(repeatPayload, repeatText) {
  return inlineKeyboard([
    [{ text: repeatText, type: 'callback', payload: repeatPayload }],
    [{ text: '← В меню', type: 'callback', payload: 'main_menu' }]
  ]);
}

async function handleTechIssueCallback(update, chatId, userId, session, payload, options = {}) {
  if (payload === 'main_tech_report' || payload === 'new_tech_report') {
    await options.startTechReportFlow(chatId, userId);
    return true;
  }

  if (payload === 'tech_report_date_today') {
    if (!session || session.state !== STATES.AWAIT_TECH_REPORT_DATE) {
      await askTechReportDate(chatId, userId, session?.data || {});
      return true;
    }

    let data = { ...session.data, date: todayMskPlus5() };
    await deleteCallbackMessage(update);
    data = await options.sendFormMessage(chatId, data, `Дата технической неполадки: ${data.date}`);
    await askTechReportText(chatId, userId, data);
    return true;
  }

  if (payload === 'tech_report_save') {
    const currentSession = getSession(userId);
    const profile = getProfile(userId);

    if (!profile || !currentSession || currentSession.state !== STATES.TECH_REPORT_CONFIRM) {
      await sendMessage(chatId, 'Данные для сохранения не найдены. Начнём заново.');
      await options.startFlow(chatId, userId);
      return true;
    }

    try {
      await sendCleanupMessage(chatId, userId, 'Сохраняю отчет по технической неполадке в Google Sheets, пожалуйста подождите...');
      await createTechReport({
        fio: profile.fio,
        date: currentSession.data.date,
        text: currentSession.data.techReportText
      });
      await cleanupMessages(userId);
      await deleteCallbackMessage(update);
      saveSession(userId, STATES.IDLE, {});
      await sendKeyboardMessage(
        chatId,
        userId,
        '✅ Отчет обработан: сохранен.',
        repeatOrMenuAttachments('new_tech_report', '+ Новый отчет ТН')
      );
    } catch (error) {
      logError('Не удалось сохранить отчет по технической неполадке в Google Sheets:', error);
      await sendMessage(chatId, 'Не удалось записать отчет по технической неполадке в Google Sheets. Попробуйте завершить ещё раз позже.');
    }
    return true;
  }

  return false;
}

module.exports = { handleTechIssueCallback };
