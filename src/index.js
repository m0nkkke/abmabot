require('dotenv').config();

const dns = require('dns');
const express = require('express');
const { handleUpdate } = require('./bot');
const { registerWebhook, registerBotCommands, startPolling } = require('./maxClient');
const { closeDb } = require('./db');
const { seedEmployeesFromJson } = require('./employees');
const { PHOTO_STORAGE_DIR, startPhotoCleanupScheduler } = require('./photos');

dns.setDefaultResultOrder('ipv4first');

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const BOT_MODE = (process.env.BOT_MODE || 'webhook').toLowerCase();

const app = express();
let stopPolling = null;
let stopPhotoCleanup = null;

if ((process.env.SEED_EMPLOYEES_FROM_JSON || '').toLowerCase() === 'true') {
  seedEmployeesFromJson();
}

function log(message, data) {
  if (data === undefined) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    return;
  }

  console.log(`[${new Date().toISOString()}] ${message}`, data);
}

function logError(message, error) {
  console.error(`[${new Date().toISOString()}] ${message}`, error);
}

app.use(express.json({ limit: '1mb' }));
app.use('/photos', express.static(PHOTO_STORAGE_DIR));
stopPhotoCleanup = startPhotoCleanupScheduler();

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    await handleUpdate(req.body);
  } catch (error) {
    logError('Необработанная ошибка webhook:', error);
  }
});

const server = app.listen(PORT, async () => {
  log(`Сервер запущен на порту ${PORT}`);

  if (BOT_MODE === 'polling') {
    try {
      await registerBotCommands();
      stopPolling = startPolling(handleUpdate);
      log('Режим работы: polling. WEBHOOK_URL не используется.');
    } catch (error) {
      logError('Не удалось запустить polling:', error);
    }
    return;
  }

  if (BOT_MODE !== 'webhook') {
    logError(`Неизвестный BOT_MODE: ${BOT_MODE}. Используйте webhook или polling.`);
    return;
  }

  try {
    await registerBotCommands();
    await registerWebhook(WEBHOOK_URL);
    log('Режим работы: webhook.');
  } catch (error) {
    logError('Не удалось зарегистрировать webhook:', error);
  }
});

function shutdown(signal) {
  log(`Получен сигнал ${signal}. Завершаем работу.`);

  if (stopPolling) {
    stopPolling();
    stopPolling = null;
  }

  if (stopPhotoCleanup) {
    stopPhotoCleanup();
    stopPhotoCleanup = null;
  }

  server.close((error) => {
    if (error) {
      logError('Ошибка закрытия HTTP-сервера:', error);
      process.exitCode = 1;
    }

    try {
      closeDb();
      log('SQLite соединение закрыто.');
    } catch (dbError) {
      logError('Ошибка закрытия SQLite:', dbError);
      process.exitCode = 1;
    }

    process.exit();
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
