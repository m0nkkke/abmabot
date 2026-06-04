const { sendMessage } = require('../maxClient');
const { STATES } = require('../states');
const { isValidDate } = require('../validators');
const { cleanupMessages } = require('../flows/cleanupFlow');
const { deleteStoredKeyboard } = require('../flows/keyboardSession');
const {
  askTechReportDate,
  askTechReportText,
  showTechReportConfirm
} = require('../flows/techIssueFlow');

async function handleTechIssueText(chatId, userId, session, text, options = {}) {
  if (String(text || '').trim().startsWith('/') || !session) {
    return false;
  }

  switch (session.state) {
    case STATES.AWAIT_TECH_REPORT_DATE: {
      if (!isValidDate(text)) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Дата технической неполадки указана неверно. Введите дату в формате ДД.ММ.ГГГГ или нажмите «Сегодня».');
        await askTechReportDate(chatId, userId, session.data);
        return true;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      let data = { ...session.data, date: text };
      data = await options.sendFormMessage(chatId, data, `Дата технической неполадки: ${text}`);
      await askTechReportText(chatId, userId, data);
      return true;
    }

    case STATES.AWAIT_TECH_REPORT_TEXT: {
      if (!text) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Опишите техническую неполадку:');
        await askTechReportText(chatId, userId, session.data);
        return true;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      let data = { ...session.data, techReportText: text };
      data = await options.sendFormMessage(chatId, data, `Техническая неполадка:\n${text}`);
      if (!(await showTechReportConfirm(chatId, userId, data))) {
        await options.startOnboarding(chatId, userId);
      }
      return true;
    }

    case STATES.TECH_REPORT_CONFIRM:
      await sendMessage(chatId, 'Нажмите «Завершить», чтобы сохранить отчет по технической неполадке, или «Исправить», чтобы вернуться назад.');
      return true;

    default:
      return false;
  }
}

module.exports = { handleTechIssueText };
