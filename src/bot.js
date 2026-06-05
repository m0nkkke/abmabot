const { randomUUID } = require('crypto');
const { STATES } = require('./states');
const { EVENT_TYPES, MAX_PHOTOS_PER_RECORD, VIOLATION_TYPES } = require('./constants');
const {
    grantAccessByPassword,
    hasConfiguredPasswords,
    handleAdminCommand,
    isAdmin,
    ROLE_LABELS
} = require('./access');
const { inlineKeyboard } = require('./keyboards');
const { log, logError } = require('./logger');
const { buildHelpText } = require('./messages');
const { deleteMessage, sendMessage, sendMessageToUser } = require('./maxClient');
const {
    getChatId,
    getPayload,
    getSentMessageId,
    getText,
    getUserId,
    isHelpRequest,
    isIdRequest
} = require('./updateUtils');
const { isValidDate, parseAmount, todayMskPlus5 } = require('./validators');
const { handleAdminCatalogCallback } = require('./callbacks/adminCatalogCallbacks');
const { handleKsoReportCallback } = require('./callbacks/ksoReportCallbacks');
const { handleKsoScheduleCallback } = require('./callbacks/ksoScheduleCallbacks');
const { handleTechIssueCallback } = require('./callbacks/techIssueCallbacks');
const { handleTextReportCallback } = require('./callbacks/textReportCallbacks');
const { handleKsoReportText } = require('./handlers/ksoReportHandlers');
const { handleKsoScheduleText } = require('./handlers/ksoScheduleHandlers');
const { handleTechIssueText } = require('./handlers/techIssueHandlers');
const { handleTextReportText } = require('./handlers/textReportHandlers');
const { handleAdminCatalogText } = require('./handlers/adminCatalogHandlers');
const {
    getProfile,
    getCatalogRegion,
    saveProfile,
    deleteProfile,
    getSession,
    saveSession,
    deleteSession,
    deleteUserLocalData,
    updateEmployeeShop,
    listEmployees,
    listRecentFixations,
    rememberRecentShop,
    saveRecentFixation,
    isAllowedUser
} = require('./db');
const { appendOnlineTheftRow, appendRow, replaceFixationRows } = require('./sheets');
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
    getShopByPayload,
    showRegionPage,
    showShopSearchResults,
    showShopPage
} = require('./flows/profileFlow');
const {
    askAmount,
    askDate,
    askEventType,
    askItem,
    askMissedReason,
    askOnlineComment,
    askPhoto,
    askCheckAction,
    askViolationType,
    showConfirm
} = require('./flows/reportFlow');
const {
    askTextReportDate,
    askTextReportFio,
    askTextReportText
} = require('./flows/textReportFlow');
const {
    askKsoDate,
    askKsoText
} = require('./flows/ksoFlow');
const {
    askKsoScheduleDate,
    askKsoScheduleStatus
} = require('./flows/ksoScheduleFlow');
const {
    askTechReportDate,
    askTechReportText
} = require('./flows/techIssueFlow');
const { savePhotoFromUpdate } = require('./photos');
const { searchShops } = require('./shops');
const {
    showAdminCatalogMenu
} = require('./flows/adminCatalogFlow');

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

function getPhotos(data) {
    if (Array.isArray(data.photos)) {
        return data.photos;
    }

    if (data.photoUrl) {
        return [{
            photoUrl: data.photoUrl,
            photoFileName: data.photoFileName,
            photoAttachmentPayload: data.photoAttachmentPayload
        }];
    }

    return [];
}

function buildPhotoCells(data) {
    const photos = getPhotos(data).slice(0, MAX_PHOTOS_PER_RECORD);
    const cells = [];

    for (let index = 0; index < MAX_PHOTOS_PER_RECORD; index += 1) {
        const photo = photos[index];
        cells.push(buildPhotoPreviewFormula(photo?.photoUrl));
        cells.push(photo?.photoUrl || '');
    }

    return cells;
}

function formatEventTypeForSheet(event) {
    if (event.eventType === EVENT_TYPES.VIOLATION && event.violationType) {
        return `${event.eventType}: ${event.violationType}`;
    }

    return event.eventType;
}

function getEvents(data) {
    if (Array.isArray(data.events) && data.events.length) {
        return data.events;
    }

    if (!data.eventType) {
        return [];
    }

    return [{
        item: data.item,
        eventType: data.eventType,
        violationType: data.violationType,
        amount: data.amount,
        missedReason: data.missedReason
    }];
}

function appendCurrentEvent(data) {
    const event = {
        item: data.item,
        eventType: data.eventType,
        violationType: data.violationType,
        amount: data.amount,
        missedReason: data.missedReason || ''
    };
    const nextData = {
        ...data,
        events: [...(Array.isArray(data.events) ? data.events : []), event]
    };

    delete nextData.item;
    delete nextData.eventType;
    delete nextData.violationType;
    delete nextData.amount;
    delete nextData.missedReason;
    delete nextData.isAdditionalEvent;

    return nextData;
}

function popLastEvent(data) {
    const events = Array.isArray(data.events) ? [...data.events] : [];
    const lastEvent = events.pop();

    if (!lastEvent) {
        return null;
    }

    const nextData = {
        ...data,
        events,
        item: lastEvent.item || data.item,
        eventType: lastEvent.eventType,
        violationType: lastEvent.violationType
    };

    delete nextData.amount;
    delete nextData.missedReason;

    return nextData;
}

function buildSheetRow(profile, data, event, fixationId, recordId) {
    return [
        profile.fio,
        data.region || '',
        data.shop || '',
        data.date,
        event.item || data.item || '',
        formatEventTypeForSheet(event),
        event.eventType === EVENT_TYPES.THEFT ? event.amount : '',
        event.eventType === EVENT_TYPES.MISSED_THEFT ? event.amount : '',
        event.eventType === EVENT_TYPES.VIOLATION ? event.amount : '',
        event.missedReason || '',
        ...buildPhotoCells(data),
        fixationId,
        recordId
    ];
}

function buildSheetRows(profile, data) {
    const fixationId = data.editFixationId || randomUUID();
    return getEvents(data).map((event) => {
        const recordId = randomUUID();
        return {
            event,
            fixationId,
            recordId,
            row: buildSheetRow(profile, data, event, fixationId, recordId)
        };
    });
}

function buildOnlineTheftRow(profile, data, event, fixationId, recordId) {
    const baseCells = [
        profile.fio,
        data.region || '',
        data.shop || '',
        data.date,
        event.item || data.item || '',
        formatEventTypeForSheet(event),
        event.eventType === EVENT_TYPES.THEFT ? event.amount : '',
        event.eventType === EVENT_TYPES.MISSED_THEFT ? event.amount : '',
        event.eventType === EVENT_TYPES.VIOLATION ? event.amount : '',
        event.missedReason || '',
        data.onlineComment || ''
    ];

    return [
        ...baseCells,
        ...buildPhotoCells(data),
        fixationId,
        recordId
    ];
}

function buildOnlineTheftRows(profile, data) {
    const fixationId = randomUUID();
    return getEvents(data).map((event) => {
        const recordId = randomUUID();
        return {
            event,
            fixationId,
            recordId,
            row: buildOnlineTheftRow(profile, data, event, fixationId, recordId)
        };
    });
}

function buildEventSummaryRows(data) {
    const events = getEvents(data);

    if (!events.length) {
        return ['События чека: не добавлены'];
    }

    return [
        'События чека:',
        ...events.map((event, index) => {
            const eventLabel = event.violationType ? `${event.eventType}: ${event.violationType}` : event.eventType;
            const reason = event.missedReason ? `, причина: ${event.missedReason}` : '';
            const item = event.item || data.item || 'Не указан';
            return `${index + 1}. ${item}: ${eventLabel}, сумма: ${event.amount} руб.${reason}`;
        })
    ];
}

function buildSavedSummary(profile, data) {
    const rows = [
        data.reportKind === 'online' ? '✅ Онлайн-кража сохранена!' : '✅ Данные сохранены!',
        '',
        `ФИО: ${profile.fio}`,
        `Регион: ${data.region || 'Не указан'}`,
        `Магазин: ${data.shop || 'Не указан'}`,
        `Дата: ${data.date}`,
        data.reportKind === 'online' ? `Комментарий: ${data.onlineComment || 'Не указан'}` : '',
        `Фото: ${getPhotos(data).length}`,
        '',
        ...buildEventSummaryRows(data)
    ].filter((row) => row !== '');

    return rows.join('\n');
}

function buildSavedSummaryAttachments(data) {
    const attachments = data.reportKind === 'online'
        ? buildRepeatOrMenuAttachments('new_online_record', '+ Новая онлайн-кража')
        : buildRepeatOrMenuAttachments('new_record', '+ Новая фиксация');

    const photoAttachments = getPhotos(data)
        .filter((photo) => photo.photoAttachmentPayload)
        .map((photo) => ({
            type: 'image',
            payload: photo.photoAttachmentPayload
        }));
    attachments.unshift(...photoAttachments);

    return attachments;
}

function buildRepeatOrMenuAttachments(repeatPayload, repeatText) {
    return inlineKeyboard([
        [{ text: repeatText, type: 'callback', payload: repeatPayload }],
        [{ text: '← В меню', type: 'callback', payload: 'main_menu' }]
    ]);
}

function buildMainMenuAttachments() {
    return inlineKeyboard([
        [
            { text: 'Кражи КСО', type: 'callback', payload: 'main_fixation' }
        ],
        [
            { text: 'Онлайн кражи', type: 'callback', payload: 'main_online_theft' }
        ],
        [
            { text: 'Отчет', type: 'callback', payload: 'main_text_report' }
        ],
        [
            { text: 'Отписка КСО', type: 'callback', payload: 'main_kso_report' }
        ],
        // [
        //   { text: 'График КСО', type: 'callback', payload: 'main_kso_schedule' }
        // ],
        [
            { text: 'Тех. неполадки', type: 'callback', payload: 'main_tech_report' }
        ],
        [
            { text: 'Изменить запись', type: 'callback', payload: 'main_edit_record' }
        ]
    ]);
}

function buildBroadcastConfirmAttachments() {
    return inlineKeyboard([
        [{ text: '✅ Отправить всем', type: 'callback', payload: 'broadcast_send' }],
        [{ text: '✏️ Изменить текст', type: 'callback', payload: 'broadcast_edit' }],
        [{ text: 'Отменить', type: 'callback', payload: 'broadcast_cancel' }]
    ]);
}

async function showMainMenu(chatId, userId, text = 'Выберите действие:') {
    await cleanupInterruptedForm(userId);
    saveSession(userId, STATES.IDLE, {});
    await sendKeyboardMessage(chatId, userId, text, buildMainMenuAttachments());
}

function formatRecentFixation(fixation, index) {
    const data = fixation.data || {};
    const events = Array.isArray(data.events) ? data.events : [];
    return `${index + 1}. ${data.date || 'Без даты'} · ${data.shop || 'Без магазина'} · событий: ${events.length}`;
}

async function showRecentFixations(chatId, userId) {
    const recentFixations = listRecentFixations(userId, 5);

    if (!recentFixations.length) {
        await sendMessage(chatId, 'У вас пока нет фиксаций, доступных для изменения.');
        await showMainMenu(chatId, userId);
        return;
    }

    saveSession(userId, STATES.IDLE, { recentFixations });
    await sendKeyboardMessage(
        chatId,
        userId,
        'Выберите фиксацию, которую нужно изменить:',
        inlineKeyboard([
            ...recentFixations.map((fixation, index) => ([
                { text: formatRecentFixation(fixation, index), type: 'callback', payload: `edit_fixation_${index}` }
            ])), [{ text: '← В меню', type: 'callback', payload: 'main_menu' }]
        ])
    );
}

function buildRecentFixationData(data, events) {
    return {
        region: data.region || '',
        shop: data.shop || '',
        date: data.date || '',
        item: data.item || '',
        events: events.map((event) => ({
            item: event.item || data.item || '',
            eventType: event.eventType,
            violationType: event.violationType || '',
            amount: event.amount,
            missedReason: event.missedReason || ''
        }))
    };
}

function uniqueIds(ids) {
    return [...new Set(ids.filter(Boolean).map(String))];
}

async function sendFormMessage(chatId, data, text) {
    const responseData = await sendMessage(chatId, text);
    const messageId = getSentMessageId(responseData);

    if (!messageId) {
        return data;
    }

    return {
        ...(data || {}),
        formMessageIds: uniqueIds([...(data?.formMessageIds || []), messageId])
    };
}

async function cleanupFormMessages(userId) {
    const session = getSession(userId);
    const messageIds = session?.data?.formMessageIds || [];

    if (!session || !messageIds.length) {
        return;
    }

    for (const messageId of uniqueIds(messageIds)) {
        await deleteMessage(messageId);
    }

    const nextData = { ...session.data };
    delete nextData.formMessageIds;
    saveSession(userId, session.state, nextData);
}

async function cleanupInterruptedForm(userId) {
    await deleteStoredKeyboard(userId);
    await cleanupMessages(userId);
    await cleanupFormMessages(userId);
}

async function sendUserId(chatId, userId) {
    await sendMessage(chatId, `Ваш MAX user_id: ${userId}\nПередайте этот ID администратору для добавления доступа.`);
}

async function askAccessPassword(chatId, userId) {
    saveSession(userId, STATES.AWAIT_ACCESS_PASSWORD, {});
    await sendCleanupMessage(chatId, userId, 'Введите пароль доступа, который выдал администратор.');
}

async function startBroadcastFlow(chatId, userId) {
    if (!isAdmin(userId)) {
        await sendMessage(chatId, 'Команда доступна только администратору.');
        return;
    }

    saveSession(userId, STATES.AWAIT_BROADCAST_TEXT, {});
    await sendCleanupMessage(
        chatId,
        userId,
        'Введите текст сообщения для рассылки активным пользователям бота.',
        inlineKeyboard([
            [{ text: 'Отменить', type: 'callback', payload: 'broadcast_cancel' }]
        ])
    );
}

async function showBroadcastConfirm(chatId, userId, data) {
    const recipientsCount = listEmployees().filter((employee) => employee.active === 1).length;
    saveSession(userId, STATES.BROADCAST_CONFIRM, data);
    await sendKeyboardMessage(
        chatId,
        userId, [
            'Проверьте текст рассылки:',
            '',
            data.broadcastText,
            '',
            `Получателей: ${recipientsCount}`
        ].join('\n'),
        buildBroadcastConfirmAttachments()
    );
}

async function sendBroadcast(text) {
    const recipients = listEmployees().filter((employee) => employee.active === 1);
    const messageText = [
        'Информационное сообщение от администратора:',
        '',
        text
    ].join('\n');
    let successCount = 0;
    const failed = [];

    for (const recipient of recipients) {
        try {
            await sendMessageToUser(recipient.user_id, messageText);
            successCount += 1;
        } catch (error) {
            failed.push(recipient.user_id);
            logError(`Не удалось отправить рассылку пользователю ${recipient.user_id}:`, error);
        }
    }

    return {
        failed,
        totalCount: recipients.length,
        successCount
    };
}

async function startOnboarding(chatId, userId) {
    if (!hasValidConsent(userId)) {
        await askConsent(chatId, userId);
        return;
    }

    saveSession(userId, STATES.AWAIT_FIO, {});
    await sendCleanupMessage(
        chatId,
        userId,
        'Добро пожаловать! Введите ваше ФИО:',
        inlineKeyboard([
            [{ text: '← В меню', type: 'callback', payload: 'main_menu' }]
        ])
    );
}

async function startFlow(chatId, userId) {
    if (!hasValidConsent(userId)) {
        await askConsent(chatId, userId);
        return;
    }

    await showMainMenu(chatId, userId);
}

async function startFixationFlow(chatId, userId) {
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

async function startOnlineTheftFlow(chatId, userId) {
    if (!hasValidConsent(userId)) {
        await askConsent(chatId, userId);
        return;
    }

    const profile = getProfile(userId);
    if (!profile) {
        await startOnboarding(chatId, userId);
        return;
    }

    await showRegionPage(chatId, userId, { reportKind: 'online' });
}

async function startTextReportFlow(chatId, userId) {
    if (!hasValidConsent(userId)) {
        await askConsent(chatId, userId);
        return;
    }

    const profile = getProfile(userId);
    if (!profile) {
        await askTextReportFio(chatId, userId, { continueToTextReport: true });
        return;
    }

    await askTextReportDate(chatId, userId, {});
}

async function startKsoReportFlow(chatId, userId) {
    if (!hasValidConsent(userId)) {
        await askConsent(chatId, userId);
        return;
    }

    const profile = getProfile(userId);
    if (!profile) {
        await askTextReportFio(chatId, userId, { continueToKsoReport: true });
        return;
    }

    await askKsoDate(chatId, userId, {});
}

async function startKsoScheduleFlow(chatId, userId) {
    if (!hasValidConsent(userId)) {
        await askConsent(chatId, userId);
        return;
    }

    const profile = getProfile(userId);
    if (!profile) {
        await askTextReportFio(chatId, userId, { continueToKsoSchedule: true });
        return;
    }

    await askKsoScheduleStatus(chatId, userId, {});
}

async function startTechReportFlow(chatId, userId) {
    if (!hasValidConsent(userId)) {
        await askConsent(chatId, userId);
        return;
    }

    const profile = getProfile(userId);
    if (!profile) {
        await askTextReportFio(chatId, userId, { continueToTechReport: true });
        return;
    }

    await askTechReportDate(chatId, userId, {});
}

function isTextReportCommand(text) {
    const command = String(text || '').trim().toLowerCase();
    return command === '/report' || command === '/command';
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

    await cleanupInterruptedForm(userId);

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
            if (session.data.isAdditionalEvent) {
                await askCheckAction(
                    chatId,
                    userId,
                    omitFormFields(session.data, ['item', 'eventType', 'violationType', 'amount', 'missedReason', 'isAdditionalEvent'])
                );
                return;
            }

            if (session.data.reportKind === 'online' && session.data.eventType) {
                await askEventType(chatId, userId, omitFormFields(session.data, ['item', 'eventType', 'violationType', 'amount', 'missedReason']));
                return;
            }

            await askDate(chatId, userId, omitFormFields(session.data, ['date', 'item']));
            return;

        case STATES.AWAIT_EVENT_TYPE:
            if (session.data.reportKind === 'online' && !session.data.item) {
                await askDate(chatId, userId, omitFormFields(session.data, ['date', 'eventType', 'violationType', 'amount']));
                return;
            }

            await askItem(chatId, userId, omitFormFields(session.data, ['item', 'eventType', 'violationType', 'amount']));
            return;

        case STATES.AWAIT_VIOLATION_TYPE:
            if (session.data.isAdditionalEvent) {
                await askItem(chatId, userId, omitFormFields(session.data, ['item', 'violationType', 'amount']));
                return;
            }

            if (Array.isArray(session.data.events) && session.data.events.length) {
                await askCheckAction(chatId, userId, omitFormFields(session.data, ['eventType', 'violationType', 'amount']));
                return;
            }

            await askEventType(chatId, userId, omitFormFields(session.data, ['eventType', 'violationType', 'amount']));
            return;

        case STATES.AWAIT_AMOUNT:
            if (session.data.eventType === EVENT_TYPES.VIOLATION) {
                await askViolationType(chatId, userId, omitFormFields(session.data, ['violationType', 'amount']));
                return;
            }

            if (session.data.isAdditionalEvent) {
                await askItem(chatId, userId, omitFormFields(session.data, ['item', 'amount', 'missedReason']));
                return;
            }

            await askEventType(chatId, userId, omitFormFields(session.data, ['eventType', 'violationType', 'amount']));
            return;

        case STATES.AWAIT_PHOTO:
            if (session.data.reportKind === 'online') {
                await askOnlineComment(
                    chatId,
                    userId,
                    omitFormFields(session.data, ['photos', 'photoUrl', 'photoFileName', 'photoAttachmentPayload'])
                );
                return;
            }

            await askCheckAction(chatId, userId, omitFormFields(session.data, ['photos', 'photoUrl', 'photoFileName', 'photoAttachmentPayload']));
            return;

        case STATES.AWAIT_ONLINE_COMMENT:
            await askCheckAction(chatId, userId, omitFormFields(session.data, ['onlineComment']));
            return;

        case STATES.AWAIT_MISSED_REASON:
            await askAmount(chatId, userId, omitFormFields(session.data, ['amount', 'missedReason']));
            return;

        case STATES.AWAIT_CHECK_ACTION:
            {
                const data = popLastEvent(session.data);
                if (!data) {
                    await askEventType(chatId, userId, omitFormFields(session.data, ['item', 'eventType', 'violationType', 'amount', 'missedReason']));
                    return;
                }

                await askAmount(chatId, userId, data);
                return;
            }

        case STATES.AWAIT_TEXT_REPORT_FIO:
            await showMainMenu(chatId, userId);
            return;

        case STATES.AWAIT_TEXT_REPORT_DATE:
            if (session.data.continueToTextReport) {
                await askTextReportFio(chatId, userId, omitFormFields(session.data, ['fio', 'date']));
                return;
            }

            await showMainMenu(chatId, userId);
            return;

        case STATES.AWAIT_TEXT_REPORT_TEXT:
            await askTextReportDate(chatId, userId, omitFormFields(session.data, ['date', 'reportText']));
            return;

        case STATES.TEXT_REPORT_CONFIRM:
            await askTextReportText(chatId, userId, omitFormFields(session.data, ['reportText']));
            return;

        case STATES.AWAIT_KSO_DATE:
            await showMainMenu(chatId, userId);
            return;

        case STATES.AWAIT_KSO_TEXT:
            await askKsoDate(chatId, userId, omitFormFields(session.data, ['date', 'ksoText']));
            return;

        case STATES.KSO_CONFIRM:
            await askKsoText(chatId, userId, omitFormFields(session.data, ['ksoText']));
            return;

        case STATES.AWAIT_KSO_SCHEDULE_DATE:
            await askKsoScheduleStatus(chatId, userId, omitFormFields(session.data, ['status', 'isoDate']));
            return;

        case STATES.KSO_SCHEDULE_CONFIRM:
            await askKsoScheduleDate(chatId, userId, omitFormFields(session.data, ['isoDate']));
            return;

        case STATES.AWAIT_TECH_REPORT_DATE:
            await showMainMenu(chatId, userId);
            return;

        case STATES.AWAIT_TECH_REPORT_TEXT:
            await askTechReportDate(chatId, userId, omitFormFields(session.data, ['date', 'techReportText']));
            return;

        case STATES.TECH_REPORT_CONFIRM:
            await askTechReportText(chatId, userId, omitFormFields(session.data, ['techReportText']));
            return;

        case STATES.AWAIT_BROADCAST_TEXT:
        case STATES.BROADCAST_CONFIRM:
            await startFlow(chatId, userId);
            return;

        case STATES.CONFIRM:
            await askPhoto(chatId, userId, session.data);
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

    if (await handleAdminCatalogCallback(update, chatId, userId, payload, { isAdmin })) {
        return;
    }

    if (payload === 'change_profile') {
        await handleProfileReset(chatId, userId);
        return;
    }

    if (payload === 'broadcast_cancel') {
        await deleteCallbackMessage(update);
        deleteSession(userId);
        await sendMessage(chatId, 'Рассылка отменена.');
        return;
    }

    if (payload === 'broadcast_edit') {
        await deleteCallbackMessage(update);
        await startBroadcastFlow(chatId, userId);
        return;
    }

    if (payload === 'broadcast_send') {
        const currentSession = getSession(userId);

        if (!isAdmin(userId)) {
            await sendMessage(chatId, 'Команда доступна только администратору.');
            return;
        }

        if (!currentSession || currentSession.state !== STATES.BROADCAST_CONFIRM || !currentSession.data.broadcastText) {
            await sendMessage(chatId, 'Текст рассылки не найден. Начните заново командой /message.');
            return;
        }

        await deleteCallbackMessage(update);
        await sendCleanupMessage(chatId, userId, 'Отправляю рассылку, пожалуйста подождите...');
        const result = await sendBroadcast(currentSession.data.broadcastText);
        await cleanupMessages(userId);
        deleteSession(userId);
        await sendMessage(
            chatId, [
                'Рассылка завершена.',
                `Отправлено: ${result.successCount}/${result.totalCount}`,
                result.failed.length ? `Не удалось отправить: ${result.failed.join(', ')}` : ''
            ].filter(Boolean).join('\n')
        );
        return;
    }

    if (payload === 'main_menu') {
        await cleanupInterruptedForm(userId);
        await showMainMenu(chatId, userId);
        return;
    }

    if (payload === 'main_fixation') {
        await startFixationFlow(chatId, userId);
        return;
    }

    if (payload === 'main_online_theft') {
        await startOnlineTheftFlow(chatId, userId);
        return;
    }

    if (payload === 'main_edit_record') {
        await deleteCallbackMessage(update);
        await showRecentFixations(chatId, userId);
        return;
    }

    if (payload.startsWith('edit_fixation_')) {
        const index = Number(payload.replace('edit_fixation_', ''));
        const fixation = session?.data?.recentFixations?.[index];

        if (!fixation) {
            await sendMessage(chatId, 'Не удалось найти выбранную фиксацию. Откройте список ещё раз.');
            await showRecentFixations(chatId, userId);
            return;
        }

        await deleteCallbackMessage(update);
        await sendMessage(chatId, 'Заполните обновленные данные для выбранной записи.');
        await showRegionPage(chatId, userId, {
            editFixationId: fixation.fixationId,
            editOriginalRegion: fixation.data.region || 'Без региона'
        });
        return;
    }

    if (await handleTextReportCallback(update, chatId, userId, session, payload, {
        sendFormMessage,
        startFlow,
        startTextReportFlow
    })) {
        return;
    }

    if (await handleKsoScheduleCallback(update, chatId, userId, session, payload, {
        sendFormMessage,
        showMainMenu,
        startKsoScheduleFlow,
        startOnboarding
    })) {
        return;
    }

    if (await handleKsoReportCallback(update, chatId, userId, session, payload, {
        sendFormMessage,
        startFlow,
        startKsoReportFlow
    })) {
        return;
    }

    if (await handleTechIssueCallback(update, chatId, userId, session, payload, {
        sendFormMessage,
        startFlow,
        startTechReportFlow
    })) {
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

    if (payload === 'choose_other_shop') {
        await deleteCallbackMessage(update);
        await showRegionPage(chatId, userId, { ...(session?.data || {}), skipRecentShops: true });
        return;
    }

    if (payload === 'form_back') {
        await handleFormBack(chatId, userId, session);
        return;
    }

    if (payload.startsWith('recent_shop_')) {
        const recentIndex = Number(payload.replace('recent_shop_', ''));
        const recentShop = session?.data?.recentShops?.[recentIndex];

        if (!recentShop) {
            await sendMessage(chatId, 'Не удалось выбрать недавний магазин. Выберите регион.');
            await showRegionPage(chatId, userId, {});
            return;
        }

        await deleteCallbackMessage(update);
        let data = {
            ...(session?.data || {}),
            region: recentShop.region,
            shop: recentShop.shop
        };
        delete data.recentShops;

        data = await sendFormMessage(chatId, data, `Магазин: ${recentShop.shop}`);
        await askDate(chatId, userId, data);
        return;
    }

    if (payload.startsWith('region_')) {
        const regionId = Number(payload.replace('region_', ''));
        const regionItem = getCatalogRegion(regionId);
        const region = regionItem?.name || '';

        if (!region) {
            await sendMessage(chatId, 'Не удалось выбрать регион. Попробуйте ещё раз.');
            await showRegionPage(chatId, userId, session?.data || {});
            return;
        }

        await deleteCallbackMessage(update);
        let data = { ...(session?.data || {}), region, regionId };
        delete data.recentShops;
        data = await sendFormMessage(chatId, data, `Регион: ${region}`);
        await showShopPage(chatId, userId, 0, data);
        return;
    }

    if (payload.startsWith('shop_')) {
        const selectedShop = getShopByPayload(payload);
        const shopText = selectedShop?.shopText || '';
        const region = session?.data?.region || selectedShop?.region || '';
        const regionId = session?.data?.regionId || selectedShop?.regionId;

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
                updated ?
                    `Магазин пользователя ${session.data.adminEditUserId} обновлён: ${region}, ${shopText}` :
                    `У пользователя ${session.data.adminEditUserId} ещё нет профиля. Попросите сотрудника пройти первичную настройку профиля.`
            );
            return;
        }

        if (!shopText || !region) {
            await sendMessage(chatId, 'Не удалось выбрать магазин. Выберите регион ещё раз.');
            await showRegionPage(chatId, userId, session?.data || {});
            return;
        }

        await deleteCallbackMessage(update);
        let data = { ...(session?.data || {}), region, regionId, shop: shopText };
        delete data.recentShops;
        if (session?.data?.fio && !getProfile(userId)) {
            saveProfile(userId, session.data.fio);
        }
        data = await sendFormMessage(chatId, data, `Магазин: ${shopText}`);
        await askDate(chatId, userId, data);
        return;
    }

    if (payload === 'date_today' || payload === 'date_now') {
        if (!session || session.state !== STATES.AWAIT_DATE) {
            await askDate(chatId, userId, session?.data || {});
            return;
        }

        let data = { ...session.data, date: todayMskPlus5() };
        await deleteCallbackMessage(update);
        data = await sendFormMessage(chatId, data, `Дата: ${data.date}`);
        if (data.reportKind === 'online') {
            await askEventType(chatId, userId, data);
            return;
        }

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

        if (session.data.reportKind === 'online' && eventType === EVENT_TYPES.VIOLATION) {
            await askEventType(chatId, userId, session.data);
            return;
        }

        await deleteCallbackMessage(update);
        let nextData = { ...session.data, eventType };
        nextData = await sendFormMessage(chatId, nextData, `Тип фиксации: ${eventType}`);
        if (nextData.reportKind === 'online' && !nextData.item) {
            await askItem(chatId, userId, nextData);
            return;
        }

        if (eventType === EVENT_TYPES.VIOLATION) {
            await askViolationType(chatId, userId, nextData);
            return;
        }

        await askAmount(chatId, userId, nextData);
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
            violation_type_container: VIOLATION_TYPES.CONTAINER,
            violation_type_resort: VIOLATION_TYPES.RESORT,
            violation_type_wrong_barcode: VIOLATION_TYPES.WRONG_BARCODE
        };
        const violationType = violationTypeByPayload[payload];

        if (!violationType) {
            await askViolationType(chatId, userId, session.data);
            return;
        }

        await deleteCallbackMessage(update);
        let nextData = { ...session.data, violationType };
        nextData = await sendFormMessage(chatId, nextData, `Вид нарушения: ${violationType}`);
        await askAmount(chatId, userId, nextData);
        return;
    }

    if (payload === 'photo_done') {
        if (!session || session.state !== STATES.AWAIT_PHOTO) {
            await askPhoto(chatId, userId, session?.data || {});
            return;
        }

        const photos = getPhotos(session.data);
        if (!photos.length) {
            await sendMessage(chatId, 'Нужно отправить хотя бы одно фото.');
            await askPhoto(chatId, userId, session.data);
            return;
        }

        await deleteCallbackMessage(update);
        const data = { ...session.data, photos };

        if (!(await showConfirm(chatId, userId, data))) {
            await startOnboarding(chatId, userId);
        }
        return;
    }

    if (payload === 'check_add_theft') {
        if (!session || session.state !== STATES.AWAIT_CHECK_ACTION) {
            await askCheckAction(chatId, userId, session?.data || {});
            return;
        }

        await deleteCallbackMessage(update);
        let data = {
            ...session.data,
            eventType: EVENT_TYPES.THEFT,
            isAdditionalEvent: true
        };
        data = await sendFormMessage(chatId, data, `Тип фиксации: ${EVENT_TYPES.THEFT}`);
        await askItem(chatId, userId, data);
        return;
    }

    if (payload === 'check_add_missed_theft') {
        if (!session || session.state !== STATES.AWAIT_CHECK_ACTION) {
            await askCheckAction(chatId, userId, session?.data || {});
            return;
        }

        await deleteCallbackMessage(update);
        let data = {
            ...session.data,
            eventType: EVENT_TYPES.MISSED_THEFT,
            isAdditionalEvent: true
        };
        data = await sendFormMessage(chatId, data, `Тип фиксации: ${EVENT_TYPES.MISSED_THEFT}`);
        await askItem(chatId, userId, data);
        return;
    }

    if (payload === 'check_add_violation') {
        if (!session || session.state !== STATES.AWAIT_CHECK_ACTION) {
            await askCheckAction(chatId, userId, session?.data || {});
            return;
        }

        if (session.data.reportKind === 'online') {
            await askCheckAction(chatId, userId, session.data);
            return;
        }

        await deleteCallbackMessage(update);
        let data = {
            ...session.data,
            eventType: EVENT_TYPES.VIOLATION,
            isAdditionalEvent: true
        };
        data = await sendFormMessage(chatId, data, `Тип фиксации: ${EVENT_TYPES.VIOLATION}`);
        await askItem(chatId, userId, data);
        return;
    }

    if (payload === 'check_finish') {
        if (!session || session.state !== STATES.AWAIT_CHECK_ACTION) {
            await askCheckAction(chatId, userId, session?.data || {});
            return;
        }

        if (!getEvents(session.data).length) {
            await sendMessage(chatId, 'Добавьте хотя бы одно событие в чек.');
            await askCheckAction(chatId, userId, session.data);
            return;
        }

        await deleteCallbackMessage(update);
        if (session.data.reportKind === 'online') {
            await askOnlineComment(chatId, userId, session.data);
            return;
        }

        await askPhoto(chatId, userId, session.data);
        return;
    }

    if (payload === 'restart_form') {
        await deleteCallbackMessage(update);
        await showRegionPage(chatId, userId, session?.data?.reportKind === 'online' ? { reportKind: 'online' } : {});
        return;
    }

    if (payload === 'new_record') {
        await startFixationFlow(chatId, userId);
        return;
    }

    if (payload === 'new_online_record') {
        await startOnlineTheftFlow(chatId, userId);
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

            const isOnlineTheft = currentSession.data.reportKind === 'online';
            const rows = isOnlineTheft
                ? buildOnlineTheftRows(profile, currentSession.data)
                : buildSheetRows(profile, currentSession.data);

            if (!rows.length) {
                await sendMessage(chatId, 'В чеке нет событий для сохранения. Добавьте кражу или нарушение.');
                await askCheckAction(chatId, userId, currentSession.data);
                return;
            }

            if (isOnlineTheft) {
                for (const row of rows) {
                    await appendOnlineTheftRow(row.row);
                }
            } else if (currentSession.data.editFixationId) {
                await replaceFixationRows(
                    currentSession.data.editOriginalRegion || 'Без региона',
                    currentSession.data.region || 'Без региона',
                    currentSession.data.editFixationId,
                    rows.map((row) => row.row)
                );
            } else {
                for (const row of rows) {
                    await appendRow(currentSession.data.region || 'Без региона', row.row);
                }
            }

            if (!isOnlineTheft) {
                saveRecentFixation(
                    userId,
                    rows[0].fixationId,
                    buildRecentFixationData(currentSession.data, rows.map((row) => row.event))
                );
            }
            rememberRecentShop(userId, currentSession.data.region || 'Без региона', currentSession.data.shop || 'Не указан');

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

    if (await handleKsoScheduleText(chatId, userId, session, text, {
        sendFormMessage,
        startOnboarding
    })) {
        return;
    }

    if (await handleKsoReportText(chatId, userId, session, text, {
        sendFormMessage,
        startOnboarding
    })) {
        return;
    }

    if (await handleTextReportText(chatId, userId, session, text, {
        sendFormMessage
    })) {
        return;
    }

    if (await handleTechIssueText(chatId, userId, session, text, {
        sendFormMessage,
        startOnboarding
    })) {
        return;
    }

    if (await handleAdminCatalogText(chatId, userId, session, text, { isAdmin })) {
        return;
    }

    if (text === '/start') {
        await startFlow(chatId, userId);
        return;
    }

    if (isTextReportCommand(text)) {
        await startTextReportFlow(chatId, userId);
        return;
    }

    if (text === '/message') {
        await startBroadcastFlow(chatId, userId);
        return;
    }

    if (text === '/admin') {
        if (!isAdmin(userId)) {
            await sendMessage(chatId, 'Команда доступна только администратору.');
            return;
        }

        await showAdminCatalogMenu(chatId, userId);
        return;
    }

    if (text === '/profile') {
        await handleProfileReset(chatId, userId);
        return;
    }

    if (text === '/password') {
        await askAccessPassword(chatId, userId);
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
        case STATES.AWAIT_ACCESS_PASSWORD:
            {
                const role = grantAccessByPassword(userId, text);
                if (!role) {
                    await cleanupMessages(userId);
                    await askAccessPassword(chatId, userId);
                    return;
                }

                await cleanupMessages(userId);
                await showMainMenu(
                    chatId,
                    userId,
                    `Пароль принят. Текущая роль: ${ROLE_LABELS[role] || role}.\n\nВыберите действие:`
                );
                return;
            }

        case STATES.AWAIT_CONSENT:
            await askConsent(chatId, userId);
            return;

        case STATES.AWAIT_FIO:
            {
                if (!text) {
                    await sendMessage(chatId, 'Введите ваше ФИО текстом:');
                    return;
                }

                await cleanupMessages(userId);
                let data = { ...(session?.data || {}) };
                data = await sendFormMessage(chatId, data, `ФИО: ${text}`);
                saveProfile(userId, text);
                await showRegionPage(chatId, userId, data);
                return;
            }

        case STATES.AWAIT_REGION:
        case STATES.AWAIT_SHOP_PAGE:
            {
                const matches = searchShops(text, 9);
                if (!matches.length) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Магазин не найден. Введите номер или название магазина, например К31, КЭШ-31, Ирк-3.');
                    await showRegionPage(chatId, userId, session.data || {});
                    return;
                }

                if (matches.length === 1 || matches[0].score >= 100) {
                    const selectedShop = matches[0].shop;
                    let data = {
                        ...(session.data || {}),
                        region: selectedShop.region,
                        regionId: selectedShop.region_id,
                        shop: selectedShop.name
                    };
                    delete data.recentShops;
                    delete data.searchResults;
                    delete data.searchQuery;

                    await deleteStoredKeyboard(userId);
                    await cleanupMessages(userId);
                    data = await sendFormMessage(chatId, data, `Магазин: ${selectedShop.name}`);
                    await askDate(chatId, userId, data);
                    return;
                }

                await cleanupMessages(userId);
                await showShopSearchResults(chatId, userId, matches, text, session.data || {});
                return;
            }

        case STATES.AWAIT_TEXT_REPORT_FIO:
            {
                if (!text) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Введите ФИО текстом:');
                    await askTextReportFio(chatId, userId, session.data);
                    return;
                }

                await cleanupMessages(userId);
                saveProfile(userId, text);
                let data = { ...session.data, fio: text };
                data = await sendFormMessage(chatId, data, `ФИО: ${text}`);
                if (data.continueToKsoReport) {
                    await askKsoDate(chatId, userId, data);
                    return;
                }

                if (data.continueToKsoSchedule) {
                    await askKsoScheduleStatus(chatId, userId, data);
                    return;
                }

                if (data.continueToTechReport) {
                    await askTechReportDate(chatId, userId, data);
                    return;
                }

                await askTextReportDate(chatId, userId, data);
                return;
            }

        case STATES.AWAIT_BROADCAST_TEXT:
            {
                if (!isAdmin(userId)) {
                    await sendMessage(chatId, 'Команда доступна только администратору.');
                    await startFlow(chatId, userId);
                    return;
                }

                if (!text) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Введите непустой текст рассылки.');
                    await startBroadcastFlow(chatId, userId);
                    return;
                }

                await cleanupMessages(userId);
                await showBroadcastConfirm(chatId, userId, { broadcastText: text });
                return;
            }

        case STATES.BROADCAST_CONFIRM:
            await sendMessage(chatId, 'Подтвердите рассылку кнопкой или отмените её.');
            return;

        case STATES.AWAIT_DATE:
            {
                if (!isValidDate(text)) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Дата указана неверно. Введите дату в формате ДД.ММ.ГГГГ или нажмите «Сегодня».');
                    await askDate(chatId, userId, session.data);
                    return;
                }

                await deleteStoredKeyboard(userId);
                await cleanupMessages(userId);
                let data = { ...session.data, date: text };
                data = await sendFormMessage(chatId, data, `Дата: ${text}`);
                if (data.reportKind === 'online') {
                    await askEventType(chatId, userId, data);
                    return;
                }

                await askItem(chatId, userId, data);
                return;
            }

        case STATES.AWAIT_ITEM:
            {
                if (!text) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Введите наименование товара:');
                    await askItem(chatId, userId, session.data);
                    return;
                }

                await cleanupMessages(userId);
                let data = { ...session.data, item: text };
                data = await sendFormMessage(chatId, data, `Наименование товара: ${text}`);
                if (data.eventType === EVENT_TYPES.VIOLATION) {
                    await askViolationType(chatId, userId, data);
                    return;
                }

                if (data.eventType) {
                    await askAmount(chatId, userId, data);
                    return;
                }

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

        case STATES.AWAIT_AMOUNT:
            {
                const amount = parseAmount(text);
                if (amount === null) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Введите сумму числом, например 349.90:');
                    await askAmount(chatId, userId, session.data);
                    return;
                }

                await cleanupMessages(userId);
                let data = { ...session.data, amount };
                data = await sendFormMessage(chatId, data, `Сумма: ${amount} руб.`);
                if (data.eventType === EVENT_TYPES.MISSED_THEFT) {
                    await askMissedReason(chatId, userId, data);
                    return;
                }

                await askCheckAction(chatId, userId, appendCurrentEvent(data));
                return;
            }

        case STATES.AWAIT_PHOTO:
            {
                const existingPhotos = getPhotos(session.data);
                if (existingPhotos.length >= MAX_PHOTOS_PER_RECORD) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, `Уже загружено максимальное количество фото: ${MAX_PHOTOS_PER_RECORD}. Нажмите «Готово».`);
                    await askPhoto(chatId, userId, { ...session.data, photos: existingPhotos });
                    return;
                }

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

                let data = {
                    ...session.data,
                    photos: [
                        ...existingPhotos,
                        {
                            photoUrl: photo.url,
                            photoFileName: photo.fileName,
                            photoAttachmentPayload: photo.messageImagePayload
                        }
                    ]
                };
                delete data.photoUrl;
                delete data.photoFileName;
                delete data.photoAttachmentPayload;

                await cleanupMessages(userId);
                data = await sendFormMessage(chatId, data, `Фото получено: ${data.photos.length}/${MAX_PHOTOS_PER_RECORD}`);

                if (data.photos.length >= MAX_PHOTOS_PER_RECORD) {
                    if (!(await showConfirm(chatId, userId, data))) {
                        await startOnboarding(chatId, userId);
                    }
                    return;
                }

                await askPhoto(chatId, userId, data);
                return;
            }

        case STATES.AWAIT_MISSED_REASON:
            {
                if (!text) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Опишите причину упущенной кражи текстом:');
                    await askMissedReason(chatId, userId, session.data);
                    return;
                }

                await cleanupMessages(userId);
                let data = { ...session.data, missedReason: text };
                data = await sendFormMessage(chatId, data, `Причина упущенной кражи: ${text}`);
                await askCheckAction(chatId, userId, appendCurrentEvent(data));
                return;
            }

        case STATES.AWAIT_ONLINE_COMMENT:
            {
                if (!text) {
                    await cleanupMessages(userId);
                    await sendMessage(chatId, 'Введите комментарий по онлайн-краже:');
                    await askOnlineComment(chatId, userId, session.data);
                    return;
                }

                await cleanupMessages(userId);
                let data = { ...session.data, onlineComment: text };
                data = await sendFormMessage(chatId, data, `Комментарий: ${text}`);
                await askPhoto(chatId, userId, data);
                return;
            }

        case STATES.AWAIT_CHECK_ACTION:
            await sendMessage(chatId, 'Выберите действие кнопкой: добавить событие или завершить чек.');
            return;

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
            if (!['confirm_save', 'text_report_save', 'broadcast_send', 'new_record', 'new_text_report', 'new_kso_report', 'new_tech_report'].includes(getPayload(update))) {
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
