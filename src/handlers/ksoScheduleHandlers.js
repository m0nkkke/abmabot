const { deleteSession, getProfile, saveSession } = require('../db');
const { STATES } = require('../states');
const { deleteStoredKeyboard } = require('../flows/keyboardSession');
const { cleanupMessages } = require('../flows/cleanupFlow');
const {
  askKsoScheduleDate,
  askKsoScheduleStatus,
  showKsoScheduleConfirm
} = require('../flows/ksoScheduleFlow');
const {
  formatDisplayDate,
  isPastDate,
  parseInputDate,
  updateScheduleStatus
} = require('../ksoAssignment');
const { sendMessage } = require('../maxClient');

function parseKsoScheduleCommand(text) {
  const match = /^(работаю|выходной)\s+(\d{2}\.\d{2}(?:\.\d{4})?)$/i.exec(String(text || '').trim());
  if (!match) {
    return null;
  }

  const isoDate = parseInputDate(match[2]);
  if (!isoDate) {
    return null;
  }

  return {
    isoDate,
    status: match[1].toLowerCase() === 'работаю' ? 'Р' : 'В'
  };
}

function normalizeYes(text) {
  return ['да', 'д', 'yes', 'y'].includes(String(text || '').trim().toLowerCase());
}

async function handleKsoScheduleCommand(chatId, userId, command, options = {}) {
  const profile = getProfile(userId);
  if (!profile) {
    await options.startOnboarding(chatId, userId);
    return;
  }

  if (isPastDate(command.isoDate)) {
    saveSession(userId, STATES.AWAIT_KSO_SCHEDULE_CONFIRM, command);
    await sendMessage(
      chatId,
      `Дата ${formatDisplayDate(command.isoDate)} уже прошла. Напишите «да», чтобы подтвердить изменение графика.`
    );
    return;
  }

  await sendMessage(chatId, await updateScheduleStatus(userId, profile, command.isoDate, command.status));
}

async function handleKsoScheduleText(chatId, userId, session, text, options = {}) {
  const command = parseKsoScheduleCommand(text);
  if (command) {
    await handleKsoScheduleCommand(chatId, userId, command, options);
    return true;
  }

  if (String(text || '').trim().startsWith('/')) {
    return false;
  }

  if (!session) {
    return false;
  }

  switch (session.state) {
    case STATES.AWAIT_KSO_SCHEDULE_CONFIRM: {
      if (normalizeYes(text)) {
        const profile = getProfile(userId);
        if (!profile) {
          await options.startOnboarding(chatId, userId);
          return true;
        }

        deleteSession(userId);
        await sendMessage(
          chatId,
          await updateScheduleStatus(userId, profile, session.data.isoDate, session.data.status)
        );
        return true;
      }

      deleteSession(userId);
      await sendMessage(chatId, 'Изменение графика отменено.');
      return true;
    }

    case STATES.AWAIT_KSO_SCHEDULE_STATUS:
      await sendMessage(chatId, 'Выберите статус кнопкой: «Работаю» или «Выходной».');
      await askKsoScheduleStatus(chatId, userId, session.data);
      return true;

    case STATES.AWAIT_KSO_SCHEDULE_DATE: {
      const isoDate = parseInputDate(text);
      if (!isoDate) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Дата указана неверно. Введите дату в формате ДД.ММ или ДД.ММ.ГГГГ или нажмите «Сегодня».');
        await askKsoScheduleDate(chatId, userId, session.data);
        return true;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      let data = { ...session.data, isoDate };
      data = await options.sendFormMessage(chatId, data, `Дата графика КСО: ${formatDisplayDate(isoDate)}`);
      await showKsoScheduleConfirm(chatId, userId, data);
      return true;
    }

    case STATES.KSO_SCHEDULE_CONFIRM:
      await sendMessage(chatId, 'Нажмите «Сохранить», чтобы обновить график, или «Изменить», чтобы вернуться к дате.');
      return true;

    default:
      return false;
  }
}

module.exports = {
  handleKsoScheduleText,
  parseKsoScheduleCommand
};
