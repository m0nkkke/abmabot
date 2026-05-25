const { STATES } = require('./states');
const { EVENT_TYPES, VIOLATION_TYPES } = require('./constants');
const {
  grantAccessByPassword,
  hasConfiguredPasswords,
  handleAdminCommand,
  isAdmin
} = require('./access');
const { inlineKeyboard } = require('./keyboards');
const { log, logError } = require('./logger');
const { buildHelpText } = require('./messages');
const { sendMessage } = require('./maxClient');
const {
  getChatId,
  getPayload,
  getText,
  getUserId,
  isHelpRequest,
  isIdRequest
} = require('./updateUtils');
const { isValidDate, parseAmount, todayMskPlus5 } = require('./validators');
const {
  getProfile,
  saveProfile,
  deleteProfile,
  getSession,
  saveSession,
  deleteSession,
  deleteUserLocalData,
  updateEmployeeShop,
  isAllowedUser
} = require('./db');
const { appendRow } = require('./sheets');
const {
  acceptConsent,
  askConsent,
  buildPrivacyText,
  declineConsent,
  hasValidConsent
} = require('./flows/consentFlow');
const {
  deleteStoredKeyboard,
  removeCallbackKeyboard,
  sendKeyboardMessage,
  sendPersistentKeyboardMessage
} = require('./flows/keyboardSession');
const {
  cleanupMessages,
  deleteCallbackMessage,
  sendCleanupMessage
} = require('./flows/cleanupFlow');
const {
  getRegionByPayload,
  getShopByPayload,
  showRegionPage,
  showShopPage
} = require('./flows/profileFlow');
const {
  askAmount,
  askDate,
  askEventType,
  askItem,
  askMissedReason,
  askPhoto,
  askViolationType,
  showConfirm
} = require('./flows/reportFlow');
const { savePhotoFromUpdate } = require('./photos');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || (GOOGLE_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit` : '');

function escapeSheetsFormulaText(value) {
  return String(value || '').replace(/"/g, '""');
}

function buildPhotoPreviewFormula(photoUrl) {
  if (!photoUrl) {
    return '';
  }

  return `=IMAGE("${escapeSheetsFormulaText(photoUrl)}")`;
}

function formatEventTypeForSheet(data) {
  if (data.eventType === EVENT_TYPES.VIOLATION && data.violationType) {
    return `${data.eventType}: ${data.violationType}`;
  }

  return data.eventType;
}

function buildSheetRow(profile, data) {
  return [
    profile.fio,
    data.region || '',
    data.shop || '',
    data.date,
    data.item,
    formatEventTypeForSheet(data),
    data.eventType === EVENT_TYPES.THEFT ? data.amount : '',
    data.eventType === EVENT_TYPES.MISSED_THEFT ? data.amount : '',
    data.eventType === EVENT_TYPES.VIOLATION ? data.amount : '',
    data.missedReason || '',
    buildPhotoPreviewFormula(data.photoUrl),
    data.photoUrl || ''
  ];
}

function buildSavedSummary(profile, data) {
  const rows = [
    '✅ Данные сохранены!',
    '',
    `ФИО: ${profile.fio}`,
    `Регион: ${data.region || 'Не указан'}`,
    `Магазин: ${data.shop || 'Не указан'}`,
    `Дата: ${data.date}`,
    `Наименование товара: ${data.item}`,
    `Тип фиксации: ${data.eventType}`,
    ...(data.violationType ? [`Вид нарушения: ${data.violationType}`] : []),
    `Сумма: ${data.amount} руб.`
  ];

  if (data.eventType === EVENT_TYPES.MISSED_THEFT) {
    rows.push(`Причина упущенной кражи: ${data.missedReason}`);
  }

  return rows.join('\n');
}

function buildSavedSummaryAttachments(data) {
  const attachments = inlineKeyboard([
    [{ text: '+ Новая запись', type: 'callback', payload: 'new_record' }]
  ]);

  if (data.photoAttachmentPayload) {
    attachments.unshift({
      type: 'image',
      payload: data.photoAttachmentPayload
    });
  }

  return attachments;
}

async function sendUserId(chatId, userId) {
  await sendMessage(chatId, `Ваш MAX user_id: ${userId}\nПередайте этот ID администратору для добавления доступа.`);
}

async function askAccessPassword(chatId, userId) {
  saveSession(userId, STATES.AWAIT_ACCESS_PASSWORD, {});
  await sendCleanupMessage(chatId, userId, 'Введите пароль доступа, который выдал администратор.');
}

async function startOnboarding(chatId, userId) {
  if (!hasValidConsent(userId)) {
    await askConsent(chatId, userId);
    return;
  }

  saveSession(userId, STATES.AWAIT_FIO, {});
  await sendCleanupMessage(chatId, userId, 'Добро пожаловать! Введите ваше ФИО:');
}

async function startFlow(chatId, userId) {
  if (!hasValidConsent(userId)) {
    await askConsent(chatId, userId);
    return;
  }

  const profile = getProfile(userId);
  if (!profile) {
    await startOnboarding(chatId, userId);
    return;
  }

  await showRegionPage(chatId, userId, {});
}

function omitFormFields(data, fields) {
  const nextData = { ...(data || {}) };
  fields.forEach((field) => {
    delete nextData[field];
  });
  return nextData;
}

async function handleFormBack(chatId, userId, session) {
  if (!session) {
    await startFlow(chatId, userId);
    return;
  }

  await cleanupMessages(userId);

  switch (session.state) {
    case STATES.AWAIT_SHOP_PAGE:
      await showRegionPage(chatId, userId, omitFormFields(session.data, ['region', 'shop']));
      return;

    case STATES.AWAIT_ADMIN_SHOP_PAGE:
      await showRegionPage(chatId, userId, omitFormFields(session.data, ['region', 'shop']));
      return;

    case STATES.AWAIT_DATE:
      await showShopPage(
        chatId,
        userId,
        session.data.shopPage || 0,
        omitFormFields(session.data, ['shop', 'date'])
      );
      return;

    case STATES.AWAIT_ITEM:
      await askDate(chatId, userId, omitFormFields(session.data, ['date', 'item']));
      return;

    case STATES.AWAIT_EVENT_TYPE:
      await askItem(chatId, userId, omitFormFields(session.data, ['item', 'eventType', 'violationType', 'amount']));
      return;

    case STATES.AWAIT_VIOLATION_TYPE:
      await askEventType(chatId, userId, omitFormFields(session.data, ['eventType', 'violationType', 'amount']));
      return;

    case STATES.AWAIT_AMOUNT:
      if (session.data.eventType === EVENT_TYPES.VIOLATION) {
        await askViolationType(chatId, userId, omitFormFields(session.data, ['violationType', 'amount']));
        return;
      }

      await askEventType(chatId, userId, omitFormFields(session.data, ['eventType', 'violationType', 'amount']));
      return;

    case STATES.AWAIT_PHOTO:
      await askAmount(
        chatId,
        userId,
        omitFormFields(session.data, ['amount', 'photoUrl', 'photoFileName', 'photoAttachmentPayload', 'missedReason'])
      );
      return;

    case STATES.AWAIT_MISSED_REASON:
      await askPhoto(chatId, userId, omitFormFields(session.data, ['missedReason']));
      return;

    case STATES.CONFIRM:
      if (session.data.eventType === EVENT_TYPES.MISSED_THEFT) {
        await askMissedReason(chatId, userId, omitFormFields(session.data, ['missedReason']));
        return;
      }

      await askPhoto(
        chatId,
        userId,
        omitFormFields(session.data, ['photoUrl', 'photoFileName', 'photoAttachmentPayload'])
      );
      return;

    default:
      await sendMessage(chatId, 'Назад вернуться нельзя на этом шаге.');
  }
}

async function handleProfileReset(chatId, userId) {
  deleteProfile(userId);
  deleteSession(userId);
  await sendMessage(chatId, 'Профиль удалён. Давайте заполним его заново.');
  await startOnboarding(chatId, userId);
}

async function handleRevoke(chatId, userId) {
  deleteUserLocalData(userId);
  await sendMessage(
    chatId,
    'Согласие отозвано. Локальный профиль, сессия и отметка согласия удалены из бота. Ранее сохранённые записи в Google Sheets обрабатываются оператором по внутреннему регламенту.'
  );
}

async function handleCallback(update, chatId, userId, session) {
  const payload = getPayload(update);

  if (payload === 'change_profile') {
    await handleProfileReset(chatId, userId);
    return;
  }

  if (payload === 'consent_accept') {
    await deleteCallbackMessage(update);
    await acceptConsent(chatId, userId);
    await startFlow(chatId, userId);
    return;
  }

  if (payload === 'consent_decline') {
    await deleteCallbackMessage(update);
    await declineConsent(chatId, userId);
    return;
  }

  if (payload.startsWith('shop_page_')) {
    const page = Number(payload.replace('shop_page_', ''));
    await deleteCallbackMessage(update);
    await showShopPage(chatId, userId, page, session?.data || {});
    return;
  }

  if (payload === 'form_back') {
    await handleFormBack(chatId, userId, session);
    return;
  }

  if (payload.startsWith('region_')) {
    const region = getRegionByPayload(payload);

    if (!region) {
      await sendMessage(chatId, 'Не удалось выбрать регион. Попробуйте ещё раз.');
      await showRegionPage(chatId, userId, session?.data || {});
      return;
    }

    await deleteCallbackMessage(update);
    await sendMessage(chatId, `Регион: ${region}`);
    await showShopPage(chatId, userId, 0, { ...(session?.data || {}), region });
    return;
  }

  if (payload.startsWith('shop_')) {
    const selectedShop = getShopByPayload(payload);
    const shopText = selectedShop?.shopText || '';
    const region = session?.data?.region || selectedShop?.region || '';

    if (session?.data?.adminEditUserId) {
      if (!shopText) {
        await sendMessage(chatId, 'Не удалось выбрать магазин.');
        return;
      }

      const updated = updateEmployeeShop(session.data.adminEditUserId, region, shopText);
      await deleteCallbackMessage(update);
      saveSession(userId, STATES.IDLE, {});
      await sendMessage(
        chatId,
        updated
          ? `Магазин пользователя ${session.data.adminEditUserId} обновлён: ${region}, ${shopText}`
          : `У пользователя ${session.data.adminEditUserId} ещё нет профиля. Попросите сотрудника пройти первичную настройку профиля.`
      );
      return;
    }

    if (!shopText || !region) {
      await sendMessage(chatId, 'Не удалось выбрать магазин. Выберите регион ещё раз.');
      await showRegionPage(chatId, userId, session?.data || {});
      return;
    }

    await deleteCallbackMessage(update);
    const data = { ...(session?.data || {}), region, shop: shopText };
    if (session?.data?.fio && !getProfile(userId)) {
      saveProfile(userId, session.data.fio);
    }
    await sendMessage(chatId, `Магазин: ${shopText}`);
    await askDate(chatId, userId, data);
    return;
  }

  if (payload === 'date_today' || payload === 'date_now') {
    if (!session || session.state !== STATES.AWAIT_DATE) {
      await askDate(chatId, userId, session?.data || {});
      return;
    }

    const data = { ...session.data, date: todayMskPlus5() };
    await deleteCallbackMessage(update);
    await sendMessage(chatId, `Дата: ${data.date}`);
    await askItem(chatId, userId, data);
    return;
  }

  if (payload.startsWith('event_type_')) {
    if (!session || session.state !== STATES.AWAIT_EVENT_TYPE) {
      await askEventType(chatId, userId, session?.data || {});
      return;
    }

    const eventTypeByPayload = {
      event_type_theft: EVENT_TYPES.THEFT,
      event_type_missed_theft: EVENT_TYPES.MISSED_THEFT,
      event_type_violation: EVENT_TYPES.VIOLATION
    };
    const eventType = eventTypeByPayload[payload];

    if (!eventType) {
      await askEventType(chatId, userId, session.data);
      return;
    }

    await deleteCallbackMessage(update);
    await sendMessage(chatId, `Тип фиксации: ${eventType}`);
    if (eventType === EVENT_TYPES.VIOLATION) {
      await askViolationType(chatId, userId, { ...session.data, eventType });
      return;
    }

    await askAmount(chatId, userId, { ...session.data, eventType });
    return;
  }

  if (payload.startsWith('violation_type_')) {
    if (!session || session.state !== STATES.AWAIT_VIOLATION_TYPE) {
      await askViolationType(chatId, userId, session?.data || {});
      return;
    }

    const violationTypeByPayload = {
      violation_type_shortage: VIOLATION_TYPES.SHORTAGE,
      violation_type_overcharge: VIOLATION_TYPES.OVERCHARGE,
      violation_type_bag: VIOLATION_TYPES.BAG,
      violation_type_container: VIOLATION_TYPES.CONTAINER
    };
    const violationType = violationTypeByPayload[payload];

    if (!violationType) {
      await askViolationType(chatId, userId, session.data);
      return;
    }

    await deleteCallbackMessage(update);
    await sendMessage(chatId, `Вид нарушения: ${violationType}`);
    await askAmount(chatId, userId, { ...session.data, violationType });
    return;
  }

  if (payload === 'restart_form') {
    await deleteCallbackMessage(update);
    await showRegionPage(chatId, userId, {});
    return;
  }

  if (payload === 'new_record') {
    await showRegionPage(chatId, userId, {});
    return;
  }

  if (payload === 'confirm_save') {
    const currentSession = getSession(userId);
    const profile = getProfile(userId);

    if (!profile || !currentSession || currentSession.state !== STATES.CONFIRM) {
      await sendMessage(chatId, 'Данные для сохранения не найдены. Начнём заново.');
      await startFlow(chatId, userId);
      return;
    }

    try {
      await sendCleanupMessage(chatId, userId, 'Сохраняю данные в Google Sheets, пожалуйста подождите...');

      await appendRow(currentSession.data.region || 'Без региона', buildSheetRow(profile, currentSession.data));

      await cleanupMessages(userId);
      await deleteCallbackMessage(update);
      saveSession(userId, STATES.IDLE, {});
      await sendPersistentKeyboardMessage(
        chatId,
        buildSavedSummary(profile, currentSession.data),
        buildSavedSummaryAttachments(currentSession.data)
      );
    } catch (error) {
      logError('Не удалось сохранить данные в Google Sheets:', error);
      await sendMessage(chatId, 'Не удалось записать данные в Google Sheets. Попробуйте подтвердить ещё раз позже.');
    }
    return;
  }

  await sendMessage(chatId, 'Неизвестная команда. Нажмите /start, чтобы начать.');
}

async function handleText(update, chatId, userId, session) {
  const text = getText(update);

  if (text === '/start') {
    await startFlow(chatId, userId);
    return;
  }

  if (text === '/profile') {
    await handleProfileReset(chatId, userId);
    return;
  }

  if (await handleAdminCommand(chatId, userId, text, GOOGLE_SHEET_URL)) {
    return;
  }

  if (text === '/privacy') {
    await sendMessage(chatId, buildPrivacyText());
    return;
  }

  if (text === '/help') {
    await sendMessage(chatId, buildHelpText());
    return;
  }

  if (text === '/revoke') {
    await handleRevoke(chatId, userId);
    return;
  }

  if (!session) {
    await startFlow(chatId, userId);
    return;
  }

  switch (session.state) {
    case STATES.AWAIT_ACCESS_PASSWORD: {
      const role = grantAccessByPassword(userId, text);
      if (!role) {
        await cleanupMessages(userId);
        await askAccessPassword(chatId, userId);
        return;
      }

      await cleanupMessages(userId);
      await startFlow(chatId, userId);
      return;
    }

    case STATES.AWAIT_CONSENT:
      await askConsent(chatId, userId);
      return;

    case STATES.AWAIT_FIO: {
      if (!text) {
        await sendMessage(chatId, 'Введите ваше ФИО текстом:');
        return;
      }

      await cleanupMessages(userId);
      await sendMessage(chatId, `ФИО: ${text}`);
      saveProfile(userId, text);
      await showRegionPage(chatId, userId, {});
      return;
    }

    case STATES.AWAIT_DATE: {
      if (!isValidDate(text)) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Дата указана неверно. Введите дату в формате ДД.ММ.ГГГГ или нажмите «Сегодня».');
        await askDate(chatId, userId, session.data);
        return;
      }

      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      const data = { ...session.data, date: text };
      await sendMessage(chatId, `Дата: ${text}`);
      await askItem(chatId, userId, data);
      return;
    }

    case STATES.AWAIT_ITEM: {
      if (!text) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Введите наименование товара:');
        await askItem(chatId, userId, session.data);
        return;
      }

      await cleanupMessages(userId);
      const data = { ...session.data, item: text };
      await sendMessage(chatId, `Наименование товара: ${text}`);
      await askEventType(chatId, userId, data);
      return;
    }

    case STATES.AWAIT_EVENT_TYPE:
      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      await askEventType(chatId, userId, session.data);
      return;

    case STATES.AWAIT_VIOLATION_TYPE:
      await deleteStoredKeyboard(userId);
      await cleanupMessages(userId);
      await askViolationType(chatId, userId, session.data);
      return;

    case STATES.AWAIT_AMOUNT: {
      const amount = parseAmount(text);
      if (amount === null) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Введите сумму числом, например 349.90:');
        await askAmount(chatId, userId, session.data);
        return;
      }

      await cleanupMessages(userId);
      const data = { ...session.data, amount };
      await sendMessage(chatId, `Сумма: ${amount} руб.`);
      await askPhoto(chatId, userId, data);
      return;
    }

    case STATES.AWAIT_PHOTO: {
      let photo;
      try {
        photo = await savePhotoFromUpdate(update, userId);
      } catch (error) {
        logError('Не удалось сохранить фото:', error);
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Не удалось обработать фото. Попробуйте отправить изображение ещё раз.');
        await askPhoto(chatId, userId, session.data);
        return;
      }

      if (!photo) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Отправьте фото изображением, а не текстом или файлом другого типа.');
        await askPhoto(chatId, userId, session.data);
        return;
      }

      const data = {
        ...session.data,
        photoUrl: photo.url,
        photoFileName: photo.fileName,
        photoAttachmentPayload: photo.messageImagePayload
      };

      await cleanupMessages(userId);
      await sendMessage(chatId, 'Фото: получено');

      if (data.eventType === EVENT_TYPES.MISSED_THEFT) {
        await askMissedReason(chatId, userId, data);
        return;
      }

      if (!(await showConfirm(chatId, userId, data))) {
        await startOnboarding(chatId, userId);
      }
      return;
    }

    case STATES.AWAIT_MISSED_REASON: {
      if (!text) {
        await cleanupMessages(userId);
        await sendMessage(chatId, 'Опишите причину упущенной кражи текстом:');
        await askMissedReason(chatId, userId, session.data);
        return;
      }

      await cleanupMessages(userId);
      const data = { ...session.data, missedReason: text };
      await sendMessage(chatId, `Причина упущенной кражи: ${text}`);
      if (!(await showConfirm(chatId, userId, data))) {
        await startOnboarding(chatId, userId);
      }
      return;
    }

    case STATES.CONFIRM:
      await sendMessage(chatId, 'Подтвердите сохранение кнопкой или начните заново.');
      return;

    default:
      await startFlow(chatId, userId);
  }
}

async function handleUpdate(update) {
  log('Входящий update:', update);

  const chatId = getChatId(update);
  const userId = getUserId(update);

  if (!chatId || !userId) {
    logError('В update не найден chat_id или user_id:', update);
    return;
  }

  const session = getSession(userId);

  try {
    if (isIdRequest(update)) {
      await sendUserId(chatId, userId);
      return;
    }

    if (isHelpRequest(update)) {
      await sendMessage(chatId, buildHelpText());
      return;
    }

    if (isAdmin(userId) && getText(update) && await handleAdminCommand(chatId, userId, getText(update), GOOGLE_SHEET_URL)) {
      return;
    }

    if (!isAllowedUser(userId) && !isAdmin(userId)) {
      if (!hasConfiguredPasswords()) {
        await sendMessage(chatId, 'Пароли доступа не настроены. Обратитесь к администратору бота.');
        return;
      }

      if (update.update_type === 'message_created' && session?.state === STATES.AWAIT_ACCESS_PASSWORD) {
        await handleText(update, chatId, userId, session);
        return;
      }

      if (update.update_type === 'message_created' && getText(update) && !getText(update).startsWith('/')) {
        saveSession(userId, STATES.AWAIT_ACCESS_PASSWORD, {});
        await handleText(update, chatId, userId, getSession(userId));
        return;
      }

      await askAccessPassword(chatId, userId);
      return;
    }

    if (update.update_type === 'bot_started') {
      await startFlow(chatId, userId);
      return;
    }

    if (update.update_type === 'message_callback') {
      if (!['confirm_save', 'new_record'].includes(getPayload(update))) {
        await removeCallbackKeyboard(update);
      }
      await handleCallback(update, chatId, userId, session);
      return;
    }

    if (update.update_type === 'message_created') {
      await handleText(update, chatId, userId, session);
      return;
    }

    log(`Необработанный тип update: ${update.update_type}`);
  } catch (error) {
    logError('Ошибка обработки update:', error);
    await sendMessage(chatId, 'Произошла ошибка. Попробуйте ещё раз или нажмите /start.');
  }
}

module.exports = {
  handleUpdate
};
