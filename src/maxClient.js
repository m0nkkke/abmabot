const axios = require('axios');
const {
  BOT_COMMANDS,
  MAX_API_BASE_URL,
  POLLING_REQUEST_TIMEOUT_MS,
  POLLING_TIMEOUT_SECONDS
} = require('./constants');
const { log, logError } = require('./logger');

const maxClient = axios.create({
  baseURL: MAX_API_BASE_URL,
  timeout: 10000,
  headers: {
    Authorization: process.env.MAX_BOT_TOKEN || ''
  }
});

let maxRequestQueue = Promise.resolve();
const MAX_REQUEST_INTERVAL_MS = 40;

maxClient.interceptors.request.use((config) => {
  maxRequestQueue = maxRequestQueue.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, MAX_REQUEST_INTERVAL_MS));
    return config;
  });

  return maxRequestQueue;
});

async function sendMessage(chatId, text, attachments) {
  if (!chatId) {
    throw new Error('Не найден chat_id для отправки сообщения');
  }

  const body = { text };
  if (attachments) {
    body.attachments = attachments;
  }

  const response = await maxClient.post(`/messages?chat_id=${encodeURIComponent(chatId)}`, body);
  return response.data;
}

async function sendMessageToUser(userId, text, attachments) {
  if (!userId) {
    throw new Error('Не найден user_id для отправки сообщения');
  }

  const body = { text };
  if (attachments) {
    body.attachments = attachments;
  }

  const response = await maxClient.post(`/messages?user_id=${encodeURIComponent(userId)}`, body);
  return response.data;
}

async function downloadUrl(url) {
  const requestConfig = {
    responseType: 'arraybuffer',
    timeout: 30000
  };

  const response = /^https?:\/\//i.test(url)
    ? await axios.get(url, requestConfig)
    : await maxClient.get(url, requestConfig);

  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || ''
  };
}

async function uploadImageBuffer(buffer, fileName = 'image.jpg', contentType = 'image/jpeg') {
  const uploadMeta = await maxClient.post('/uploads?type=image');
  const uploadUrl = uploadMeta.data?.url;

  if (!uploadUrl) {
    throw new Error('MAX не вернул URL для загрузки изображения');
  }

  const form = new FormData();
  form.append('data', new Blob([buffer], { type: contentType }), fileName);

  const response = await axios.post(uploadUrl, form, {
    timeout: 30000
  });

  return response.data;
}

async function removeButtonsFromMessage(messageId, text) {
  if (!messageId) {
    return;
  }

  const body = { attachments: [] };
  if (text) {
    body.text = text;
  }

  try {
    await maxClient.put(`/messages?message_id=${encodeURIComponent(messageId)}`, body);
  } catch (error) {
    logError('Не удалось удалить кнопки у сообщения:', error);
  }
}

async function deleteMessage(messageId) {
  if (!messageId) {
    return false;
  }

  try {
    await maxClient.delete(`/messages?message_id=${encodeURIComponent(messageId)}`);
    return true;
  } catch (error) {
    logError('Не удалось удалить сообщение:', error);
    return false;
  }
}

async function registerWebhook(webhookUrl) {
  if (!process.env.MAX_BOT_TOKEN) {
    throw new Error('Не задана переменная окружения MAX_BOT_TOKEN');
  }

  if (!webhookUrl) {
    throw new Error('Не задана переменная окружения WEBHOOK_URL');
  }

  await maxClient.post('/subscriptions', { url: webhookUrl });
  log(`Webhook зарегистрирован: ${webhookUrl}`);
}

async function registerBotCommands() {
  if (!process.env.MAX_BOT_TOKEN) {
    throw new Error('Не задана переменная окружения MAX_BOT_TOKEN');
  }

  await maxClient.patch('/me', { commands: BOT_COMMANDS });
  log('Команды бота зарегистрированы в MAX.');
}

function startPolling(handleUpdate) {
  if (!process.env.MAX_BOT_TOKEN) {
    throw new Error('Не задана переменная окружения MAX_BOT_TOKEN');
  }

  let stopped = false;
  let marker = null;

  async function poll() {
    log('Long polling MAX запущен. Для production используйте webhook.');

    while (!stopped) {
      try {
        const response = await maxClient.get('/updates', {
          timeout: POLLING_REQUEST_TIMEOUT_MS,
          params: {
            limit: 100,
            timeout: POLLING_TIMEOUT_SECONDS,
            marker,
            types: 'bot_started,message_created,message_callback'
          }
        });

        const updates = response.data?.updates || [];
        marker = response.data?.marker ?? marker;

        for (const update of updates) {
          if (stopped) {
            break;
          }

          await handleUpdate(update);
        }
      } catch (error) {
        if (!stopped) {
          logError('Ошибка long polling MAX:', error);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    log('Long polling MAX остановлен.');
  }

  poll();

  return () => {
    stopped = true;
  };
}

module.exports = {
  deleteMessage,
  downloadUrl,
  uploadImageBuffer,
  sendMessage,
  sendMessageToUser,
  removeButtonsFromMessage,
  registerWebhook,
  registerBotCommands,
  startPolling
};
