const { sendMessage } = require('../maxClient');
const { STATES } = require('../states');
const { isValidDate } = require('../validators');
const { cleanupMessages } = require('../flows/cleanupFlow');
const { deleteStoredKeyboard } = require('../flows/keyboardSession');
const {
  askTextReportDate,
  askTextReportFio,
  askTextReportText,
  showTextReportConfirm
} = require('../flows/textReportFlow');

async function handleTextReportText(chatId, userId, session, text, options = {}) {
  if (String(text || '').trim().startsWith('/') || !session) {
    return false;
  }

  switch (session.state) {
    case STATES.AWAIT_TEXT_REPORT_DATE: {
      if (!isValidDate(text)) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Дата отчета указана неверно. Введите дату в формате ДД.ММ.ГГГГ или нажмите «Сегодня».');
        await askTextReportDate(chatId, userId, session.data);
        return true;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      let data = { ...session.data, date: text };
      data = await options.sendFormMessage(chatId, data, `Дата отчета: ${text}`);
      await askTextReportText(chatId, userId, data);
      return true;
    }

    case STATES.AWAIT_TEXT_REPORT_TEXT: {
      if (!text) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Введите текст отчета:');
        await askTextReportText(chatId, userId, session.data);
        return true;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      let data = { ...session.data, reportText: text };
      data = await options.sendFormMessage(chatId, data, `Отчет:\n${text}`);
      if (!(await showTextReportConfirm(chatId, userId, data))) {
        await sendMessage(chatId, 'Профиль не найден. Введите ФИО ещё раз.');
        await askTextReportFio(chatId, userId, { continueToTextReport: true });
      }
      return true;
    }

    case STATES.TEXT_REPORT_CONFIRM:
      await sendMessage(chatId, 'Нажмите «Сохранить», чтобы записать отчет, или «Исправить», чтобы вернуться к тексту.');
      return true;

    default:
      return false;
  }
}

module.exports = { handleTextReportText };
