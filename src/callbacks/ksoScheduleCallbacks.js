const { getProfile, deleteSession } = require('../db');
const { STATES } = require('../states');
const { todayMskPlus5 } = require('../validators');
const { deleteCallbackMessage } = require('../flows/cleanupFlow');
const {
  askKsoScheduleDate,
  askKsoScheduleStatus,
  showKsoScheduleConfirm
} = require('../flows/ksoScheduleFlow');
const {
  formatDisplayDate,
  parseInputDate,
  updateScheduleStatus
} = require('../ksoAssignment');
const { sendMessage } = require('../maxClient');

async function handleKsoScheduleCallback(update, chatId, userId, session, payload, options = {}) {
  if (payload === 'main_kso_schedule') {
    await options.startKsoScheduleFlow(chatId, userId);
    return true;
  }

  if (payload === 'kso_schedule_status_work' || payload === 'kso_schedule_status_off') {
    if (!session || session.state !== STATES.AWAIT_KSO_SCHEDULE_STATUS) {
      await askKsoScheduleStatus(chatId, userId, session?.data || {});
      return true;
    }

    const status = payload === 'kso_schedule_status_work' ? 'Р' : 'В';
    await deleteCallbackMessage(update);
    const data = await options.sendFormMessage(
      chatId,
      { ...session.data, status },
      `Статус графика КСО: ${status === 'Р' ? 'Работаю' : 'Выходной'}`
    );
    await askKsoScheduleDate(chatId, userId, data);
    return true;
  }

  if (payload === 'kso_schedule_date_today') {
    if (!session || session.state !== STATES.AWAIT_KSO_SCHEDULE_DATE) {
      await askKsoScheduleDate(chatId, userId, session?.data || {});
      return true;
    }

    const isoDate = parseInputDate(todayMskPlus5());
    await deleteCallbackMessage(update);
    const data = await options.sendFormMessage(
      chatId,
      { ...session.data, isoDate },
      `Дата графика КСО: ${formatDisplayDate(isoDate)}`
    );
    await showKsoScheduleConfirm(chatId, userId, data);
    return true;
  }

  if (payload === 'kso_schedule_save') {
    if (!session || session.state !== STATES.KSO_SCHEDULE_CONFIRM) {
      await askKsoScheduleStatus(chatId, userId, {});
      return true;
    }

    const profile = getProfile(userId);
    if (!profile) {
      await options.startOnboarding(chatId, userId);
      return true;
    }

    await deleteCallbackMessage(update);
    deleteSession(userId);
    await sendMessage(chatId, await updateScheduleStatus(userId, profile, session.data.isoDate, session.data.status));
    await options.showMainMenu(chatId, userId);
    return true;
  }

  return false;
}

module.exports = { handleKsoScheduleCallback };
