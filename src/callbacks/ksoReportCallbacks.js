const { getProfile, getSession, saveSession } = require('../db');
const { STATES } = require('../states');
const { todayMskPlus5 } = require('../validators');
const { createKsoReport } = require('../services/reportService');
const { inlineKeyboard } = require('../keyboards');
const { logError } = require('../logger');
const { sendMessage } = require('../maxClient');
const { sendKeyboardMessage } = require('../flows/keyboardSession');
const { cleanupMessages, deleteCallbackMessage, sendCleanupMessage } = require('../flows/cleanupFlow');
const {
  askKsoDate,
  askKsoText
} = require('../flows/ksoFlow');

function repeatOrMenuAttachments(repeatPayload, repeatText) {
  return inlineKeyboard([
    [{ text: repeatText, type: 'callback', payload: repeatPayload }],
    [{ text: '← В меню', type: 'callback', payload: 'main_menu' }]
  ]);
}

async function handleKsoReportCallback(update, chatId, userId, session, payload, options = {}) {
  if (payload === 'main_kso_report' || payload === 'new_kso_report') {
    await options.startKsoReportFlow(chatId, userId);
    return true;
  }

  if (payload === 'kso_date_today') {
    if (!session || session.state !== STATES.AWAIT_KSO_DATE) {
      await askKsoDate(chatId, userId, session?.data || {});
      return true;
    }

    let data = { ...session.data, date: todayMskPlus5() };
    await deleteCallbackMessage(update);
    data = await options.sendFormMessage(chatId, data, `Дата отписки КСО: ${data.date}`);
    await askKsoText(chatId, userId, data);
    return true;
  }

  if (payload === 'kso_save') {
    const currentSession = getSession(userId);
    const profile = getProfile(userId);

    if (!profile || !currentSession || currentSession.state !== STATES.KSO_CONFIRM) {
      await sendMessage(chatId, 'Данные для сохранения не найдены. Начнём заново.');
      await options.startFlow(chatId, userId);
      return true;
    }

    try {
      await sendCleanupMessage(chatId, userId, 'Сохраняю отписку КСО в Google Sheets, пожалуйста подождите...');
      await createKsoReport({
        fio: profile.fio,
        date: currentSession.data.date,
        text: currentSession.data.ksoText
      });
      await cleanupMessages(userId);
      await deleteCallbackMessage(update);
      saveSession(userId, STATES.IDLE, {});
      await sendKeyboardMessage(
        chatId,
        userId,
        '✅ Отчет КСО сохранен.',
        repeatOrMenuAttachments('new_kso_report', '+ Новый отчет КСО')
      );
    } catch (error) {
      logError('Не удалось сохранить отписку КСО в Google Sheets:', error);
      await sendMessage(chatId, 'Не удалось записать отписку КСО в Google Sheets. Попробуйте завершить ещё раз позже.');
    }
    return true;
  }

  return false;
}

module.exports = { handleKsoReportCallback };
