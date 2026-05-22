const { getSession, saveSession } = require('../db');
const { deleteMessage, sendMessage } = require('../maxClient');
const { getCallbackMessage, getMessageIdFromMessage, getSentMessageId } = require('../updateUtils');

function uniqueIds(ids) {
  return [...new Set(ids.filter(Boolean).map(String))];
}

function rememberCleanupMessageId(userId, messageId) {
  if (!messageId) {
    return;
  }

  const session = getSession(userId);
  if (!session) {
    return;
  }

  saveSession(userId, session.state, {
    ...session.data,
    cleanupMessageIds: uniqueIds([...(session.data.cleanupMessageIds || []), messageId])
  });
}

async function sendCleanupMessage(chatId, userId, text, attachments) {
  const responseData = await sendMessage(chatId, text, attachments);
  rememberCleanupMessageId(userId, getSentMessageId(responseData));
  return responseData;
}

async function cleanupMessages(userId) {
  const session = getSession(userId);
  const messageIds = session?.data?.cleanupMessageIds || [];

  if (!session || !messageIds.length) {
    return;
  }

  for (const messageId of uniqueIds(messageIds)) {
    await deleteMessage(messageId);
  }

  const nextData = { ...session.data };
  delete nextData.cleanupMessageIds;
  saveSession(userId, session.state, nextData);
}

async function deleteCallbackMessage(update) {
  const messageId = getMessageIdFromMessage(getCallbackMessage(update));
  await deleteMessage(messageId);
}

module.exports = {
  cleanupMessages,
  deleteCallbackMessage,
  sendCleanupMessage
};
