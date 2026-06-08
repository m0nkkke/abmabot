const { EVENT_TYPES, MAX_PHOTOS_PER_RECORD, VIOLATION_TYPES } = require('../constants');
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
    const eventTypeButtons = [
        [{ text: EVENT_TYPES.THEFT, type: 'callback', payload: 'event_type_theft' }],
        [{ text: EVENT_TYPES.MISSED_THEFT, type: 'callback', payload: 'event_type_missed_theft' }]
    ];
    if (data.reportKind !== 'online') {
        eventTypeButtons.push([{ text: EVENT_TYPES.VIOLATION, type: 'callback', payload: 'event_type_violation' }]);
    }
    eventTypeButtons.push(backButtonRow());

    await sendKeyboardMessage(
        chatId,
        userId,
        data.reportKind === 'online' ? 'Выберите тип кражи:' : 'Выберите тип фиксации:',
        inlineKeyboard(eventTypeButtons)
    );
}

async function askAmount(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_AMOUNT, data);
    const eventLabel = data.violationType ? `${data.eventType}: ${data.violationType}` : data.eventType;
    await sendCleanupMessage(chatId, userId, `Введите сумму для типа «${eventLabel}» (руб):`, backKeyboard());
}

async function askViolationType(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_VIOLATION_TYPE, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    'Выберите вид нарушения:',
    inlineKeyboard([
      [{ text: VIOLATION_TYPES.SHORTAGE, type: 'callback', payload: 'violation_type_shortage' }],
      [{ text: VIOLATION_TYPES.OVERCHARGE, type: 'callback', payload: 'violation_type_overcharge' }],
      [{ text: VIOLATION_TYPES.BAG, type: 'callback', payload: 'violation_type_bag' }],
      [{ text: VIOLATION_TYPES.CONTAINER, type: 'callback', payload: 'violation_type_container' }],
      [{ text: VIOLATION_TYPES.RESORT, type: 'callback', payload: 'violation_type_resort' }],
      [{ text: VIOLATION_TYPES.WRONG_BARCODE, type: 'callback', payload: 'violation_type_wrong_barcode' }],
      backButtonRow()
    ])
  );
}

async function askPhoto(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_PHOTO, data);
    const photoCount = Array.isArray(data.photos) ? data.photos.length : 0;
    const buttons = [];

    if (photoCount > 0) {
      buttons.push([{ text: 'Готово', type: 'callback', payload: 'photo_done' }]);
    }
    buttons.push(backButtonRow());

    await sendCleanupMessage(
      chatId,
      userId,
      `Отправьте фото фиксации. Можно загрузить от 1 до ${MAX_PHOTOS_PER_RECORD} фото по одному сообщению.\nПолучено: ${photoCount}/${MAX_PHOTOS_PER_RECORD}.`,
      inlineKeyboard(buttons)
    );
}

async function askMissedReason(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_MISSED_REASON, data);
    await sendCleanupMessage(chatId, userId, 'Опишите причину упущенной кражи:', backKeyboard());
}

async function askOnlineComment(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_ONLINE_COMMENT, data);
    await sendCleanupMessage(chatId, userId, 'Введите комментарий по онлайн-краже:', backKeyboard());
}

async function askCheckAction(chatId, userId, data = {}) {
    saveSession(userId, STATES.AWAIT_CHECK_ACTION, data);
    const addEventRows = data.reportKind === 'online'
        ? [
            [{ text: '+ Кража', type: 'callback', payload: 'check_add_theft' }],
            [{ text: '+ Упущенная кража', type: 'callback', payload: 'check_add_missed_theft' }]
        ]
        : [
            [{ text: '+ Упущенная кража', type: 'callback', payload: 'check_add_missed_theft' }],
            [{ text: '+ Нарушение', type: 'callback', payload: 'check_add_violation' }]
        ];
    await sendCleanupMessage(
      chatId,
      userId,
      `${formatEventRows(data).join('\n')}\n\nДобавить еще событие в этот чек?`,
      inlineKeyboard([
        ...addEventRows,
        [{ text: data.reportKind === 'online' ? 'Перейти к комментарию' : 'Перейти к фото', type: 'callback', payload: 'check_finish' }],
        backButtonRow()
      ])
    );
}

function formatEventRows(data) {
    const events = Array.isArray(data.events) && data.events.length
      ? data.events
      : [{
        item: data.item,
        eventType: data.eventType,
        violationType: data.violationType,
        amount: data.amount,
        missedReason: data.missedReason
      }].filter((event) => event.eventType);

    if (!events.length) {
      return ['Добавлено: пока нет событий'];
    }

    return [
      'Добавлено:',
      ...events.map((event, index) => {
        const eventLabel = event.violationType ? `${event.eventType}: ${event.violationType}` : event.eventType;
        const reason = event.missedReason ? `, причина: ${event.missedReason}` : '';
        const item = event.item || data.item || 'Не указан';
        return `${index + 1}. ${item}: ${eventLabel}, сумма: ${event.amount} руб.${reason}`;
      })
    ];
}

function buildSummary(profile, data) {
    const rows = [
        'Проверьте данные перед сохранением:',
        '',
        `ФИО: ${profile.fio}`,
        `Регион: ${data.region || 'Не указан'}`,
        `Магазин: ${data.shop || 'Не указан'}`,
        `Дата: ${data.date}`,
        data.reportKind === 'online' ? `Комментарий: ${data.onlineComment || 'Не указан'}` : '',
        `Фото: ${Array.isArray(data.photos) ? data.photos.length : 0}`,
        '',
        ...formatEventRows(data)
    ].filter((row) => row !== '');

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

  const photoAttachments = (Array.isArray(data.photos) ? data.photos : [])
    .filter((photo) => photo.photoAttachmentPayload)
    .map((photo) => ({
      type: 'image',
      payload: photo.photoAttachmentPayload
    }));
  attachments.unshift(...photoAttachments);

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
    askCheckAction,
    askMissedReason,
    askOnlineComment,
    askViolationType,
    buildSummary,
    showConfirm
};
