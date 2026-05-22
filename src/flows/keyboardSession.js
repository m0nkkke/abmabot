const { getSession, saveSession } = require('../db');
const { deleteMessage, removeButtonsFromMessage, sendMessage } = require('../maxClient');
const {
  getCallbackMessage,
  getMessageIdFromMessage,
  getMessageTextFromMessage,
  getSentMessageId
} = require('../updateUtils');

async function removeStoredKeyboard(userId) {
  const session = getSession(userId);
  const messageId = session?.data?.lastKeyboardMessageId;

  if (!session || !messageId) {
    return;
  }

  await removeButtonsFromMessage(messageId, session.data.lastKeyboardText);

  const nextData = { ...session.data };
  delete nextData.lastKeyboardMessageId;
  delete nextData.lastKeyboardText;
  saveSession(userId, session.state, nextData);
}

async function deleteStoredKeyboard(userId) {
  const session = getSession(userId);
  const messageId = session?.data?.lastKeyboardMessageId;

  if (!session || !messageId) {
    return;
  }

  await deleteMessage(messageId);

  const nextData = { ...session.data };
  delete nextData.lastKeyboardMessageId;
  delete nextData.lastKeyboardText;
  saveSession(userId, session.state, nextData);
}

async function removeCallbackKeyboard(update) {
  const message = getCallbackMessage(update);
  await removeButtonsFromMessage(getMessageIdFromMessage(message), getMessageTextFromMessage(message));
}

async function sendKeyboardMessage(chatId, userId, text, attachments) {
  await removeStoredKeyboard(userId);

  const responseData = await sendMessage(chatId, text, attachments);
  const messageId = getSentMessageId(responseData);
  const session = getSession(userId);

  if (session && messageId) {
    saveSession(userId, session.state, {
      ...session.data,
      lastKeyboardMessageId: messageId,
      lastKeyboardText: text
    });
  }

  return responseData;
}

async function sendPersistentKeyboardMessage(chatId, text, attachments) {
  return sendMessage(chatId, text, attachments);
}

module.exports = {
  deleteStoredKeyboard,
  removeCallbackKeyboard,
  removeStoredKeyboard,
  sendKeyboardMessage,
  sendPersistentKeyboardMessage
};
