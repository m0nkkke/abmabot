const { CONSENT_VERSION } = require('../constants');
const { getConsent, saveConsent, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const {
  buildConsentText: buildConsentTextMessage,
  buildPrivacyText: buildPrivacyTextMessage
} = require('../messages');
const { sendMessage } = require('../maxClient');
const { STATES } = require('../states');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

const PRIVACY_CONFIG = {
  operatorName: process.env.PD_OPERATOR_NAME || 'оператор персональных данных',
  privacyContact: process.env.PD_PRIVACY_CONTACT || 'ответственное лицо работодателя',
  privacyPolicyUrl: process.env.PD_PRIVACY_POLICY_URL || ''
};

function buildConsentText() {
  return buildConsentTextMessage(PRIVACY_CONFIG);
}

function buildPrivacyText() {
  return buildPrivacyTextMessage(PRIVACY_CONFIG);
}

function hasValidConsent(userId) {
  const consent = getConsent(userId);
  return Boolean(consent && consent.policy_version === CONSENT_VERSION);
}

async function askConsent(chatId, userId) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_CONSENT, {});
  await sendKeyboardMessage(
    chatId,
    userId,
    buildConsentText(),
    inlineKeyboard([
      [
        { text: '✅ Согласен', type: 'callback', payload: 'consent_accept' },
        { text: '❌ Не согласен', type: 'callback', payload: 'consent_decline' }
      ]
    ])
  );
}

async function acceptConsent(chatId, userId) {
  saveConsent(userId, CONSENT_VERSION, buildConsentText());
}

async function declineConsent(chatId, userId) {
  saveSession(userId, STATES.IDLE, {});
  await sendMessage(
    chatId,
    'Без согласия на обработку персональных данных бот не может принять сообщение. Для повторного запуска нажмите /start.'
  );
}

module.exports = {
  acceptConsent,
  askConsent,
  buildConsentText,
  buildPrivacyText,
  declineConsent,
  hasValidConsent
};
