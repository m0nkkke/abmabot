function getChatId(update) {
  return update.message?.recipient?.chat_id
    || update.message?.chat?.id
    || update.chat_id
    || update.callback?.message?.recipient?.chat_id
    || update.callback?.message?.chat?.id;
}

function getUserId(update) {
  return update.user?.user_id
    || update.user?.id
    || update.user_id
    || update.callback?.user_id
    || update.callback?.user?.user_id
    || update.callback?.user?.id
    || update.callback?.sender?.user_id
    || update.callback?.sender?.id
    || update.message?.sender?.user_id
    || update.message?.sender?.id;
}

function getText(update) {
  return (update.message?.body?.text || update.message?.text || '').trim();
}

function getPayload(update) {
  return update.callback?.payload || '';
}

function getMessageIdFromMessage(message) {
  return message?.body?.mid
    || message?.body?.message_id
    || message?.body?.id
    || message?.message_id
    || message?.mid
    || message?.id;
}

function getMessageTextFromMessage(message) {
  return message?.body?.text || message?.text || '';
}

function getSentMessageId(responseData) {
  return getMessageIdFromMessage(responseData?.message || responseData);
}

function getCallbackMessage(update) {
  return update.callback?.message || update.message;
}

function getMessageAttachments(update) {
  return update.message?.body?.attachments
    || update.message?.attachments
    || [];
}

function getImageAttachment(update) {
  return getMessageAttachments(update).find((attachment) => {
    return attachment?.type === 'image' || attachment?.type === 'photo';
  }) || null;
}

function getImageAttachmentUrl(update) {
  const attachment = getImageAttachment(update);
  const payload = attachment?.payload || {};

  return payload.url
    || payload.download_url
    || payload.downloadUrl
    || payload.image_url
    || payload.imageUrl
    || payload.urls?.original
    || payload.urls?.large
    || payload.urls?.medium
    || attachment?.url
    || '';
}

function isIdRequest(update) {
  const text = getText(update).toLowerCase();
  const payload = getPayload(update);
  return text === '/id' || payload === 'show_user_id';
}

function isHelpRequest(update) {
  return getText(update).toLowerCase() === '/help';
}

module.exports = {
  getCallbackMessage,
  getChatId,
  getMessageIdFromMessage,
  getMessageTextFromMessage,
  getImageAttachment,
  getImageAttachmentUrl,
  getMessageAttachments,
  getPayload,
  getSentMessageId,
  getText,
  getUserId,
  isHelpRequest,
  isIdRequest
};
