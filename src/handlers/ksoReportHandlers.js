const { STATES } = require('../states');
const { isValidDate } = require('../validators');
const { sendMessage } = require('../maxClient');
const { deleteStoredKeyboard } = require('../flows/keyboardSession');
const { cleanupMessages } = require('../flows/cleanupFlow');
const {
  askKsoDate,
  askKsoText,
  showKsoConfirm
} = require('../flows/ksoFlow');

async function handleKsoReportText(chatId, userId, session, text, options = {}) {
  if (String(text || '').trim().startsWith('/')) {
    return false;
  }

  if (!session) {
    return false;
  }

  switch (session.state) {
    case STATES.AWAIT_KSO_DATE: {
      if (!isValidDate(text)) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Дата отписки КСО указана неверно. Введите дату в формате ДД.ММ.ГГГГ или нажмите «Сегодня».');
        await askKsoDate(chatId, userId, session.data);
        return true;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      let data = { ...session.data, date: text };
      data = await options.sendFormMessage(chatId, data, `Дата отписки КСО: ${text}`);
      await askKsoText(chatId, userId, data);
      return true;
    }

    case STATES.AWAIT_KSO_TEXT: {
      if (!text) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Введите текст отписки КСО:');
        await askKsoText(chatId, userId, session.data);
        return true;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      let data = { ...session.data, ksoText: text };
      data = await options.sendFormMessage(chatId, data, `Отписка КСО:\n${text}`);
      if (!(await showKsoConfirm(chatId, userId, data))) {
        await options.startOnboarding(chatId, userId);
      }
      return true;
    }

    case STATES.KSO_CONFIRM:
      await sendMessage(chatId, 'Нажмите «Завершить», чтобы сохранить отписку КСО, или «Исправить», чтобы вернуться назад.');
      return true;

    default:
      return false;
  }
}

module.exports = { handleKsoReportText };
