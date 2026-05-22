const { EVENT_TYPES } = require('../constants');
const { getProfile, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { STATES } = require('../states');
const { sendCleanupMessage } = require('./cleanupFlow');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

function backButtonRow() {
  return [{ text: '← Назад', type: 'callback', payload: 'form_back' }];
}

function backKeyboard() {
  return inlineKeyboard([backButtonRow()]);
}

async function askDate(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_DATE, data);
    await sendKeyboardMessage(
        chatId,
        userId,
        'Укажите дату нарушения. Нажмите «Сегодня» или введите дату в формате ДД.ММ.ГГГГ.',
        inlineKeyboard([
            [{ text: 'Сегодня', type: 'callback', payload: 'date_today' }],
            backButtonRow()
        ])
    );
}

async function askItem(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_ITEM, data);
    await sendCleanupMessage(chatId, userId, 'Введите наименование товара:', backKeyboard());
}

async function askEventType(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_EVENT_TYPE, data);
    await sendKeyboardMessage(
        chatId,
        userId,
        'Выберите тип фиксации:',
        inlineKeyboard([
            [{ text: EVENT_TYPES.THEFT, type: 'callback', payload: 'event_type_theft' }],
            [{ text: EVENT_TYPES.MISSED_THEFT, type: 'callback', payload: 'event_type_missed_theft' }],
            [{ text: EVENT_TYPES.VIOLATION, type: 'callback', payload: 'event_type_violation' }],
            backButtonRow()
        ])
    );
}

async function askAmount(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_AMOUNT, data);
    await sendCleanupMessage(chatId, userId, `Введите сумму для типа «${data.eventType}» (руб):`, backKeyboard());
}

async function askPhoto(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_PHOTO, data);
    await sendCleanupMessage(chatId, userId, 'Отправьте фото фиксации одним сообщением.', backKeyboard());
}

async function askMissedReason(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_MISSED_REASON, data);
    await sendCleanupMessage(chatId, userId, 'Опишите причину упущенной кражи:', backKeyboard());
}

function buildSummary(profile, data) {
    const rows = [
        'Проверьте данные перед сохранением:',
        '',
        `ФИО: ${profile.fio}`,
        `Регион: ${data.region || 'Не указан'}`,
        `Магазин: ${data.shop || 'Не указан'}`,
        `Дата: ${data.date}`,
        `Наименование товара: ${data.item}`,
        `Тип фиксации: ${data.eventType}`,
        `Сумма: ${data.amount} руб.`
    ];

    if (data.eventType === EVENT_TYPES.MISSED_THEFT) {
        rows.push(`Причина упущенной кражи: ${data.missedReason}`);
    }

    return rows.join('\n');
}

async function showConfirm(chatId, userId, data) {
  const profile = getProfile(userId);
  if (!profile) {
    return false;
  }

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.CONFIRM, data);
  const attachments = inlineKeyboard([
    [
      { text: '✅ Сохранить', type: 'callback', payload: 'confirm_save' },
      { text: '✏️ Удалить и заново', type: 'callback', payload: 'restart_form' }
    ],
    [
      { text: '← Назад', type: 'callback', payload: 'form_back' }
    ]
  ]);

  if (data.photoAttachmentPayload) {
    attachments.unshift({
      type: 'image',
      payload: data.photoAttachmentPayload
    });
  }

    await sendKeyboardMessage(
        chatId,
        userId,
        buildSummary(profile, data),
        attachments
    );

    return true;
}

module.exports = {
    askAmount,
    askDate,
    askEventType,
    askItem,
    askPhoto,
    askMissedReason,
    buildSummary,
    showConfirm
};
