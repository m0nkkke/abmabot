const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { downloadUrl, uploadImageBuffer } = require('./maxClient');
const { getImageAttachmentUrl } = require('./updateUtils');

const PHOTO_STORAGE_DIR = path.resolve(process.env.PHOTO_STORAGE_DIR || './storage/photos');
const PHOTO_PUBLIC_BASE_URL = getPhotoPublicBaseUrl();
const PHOTO_MAX_WIDTH = Number(process.env.PHOTO_MAX_WIDTH || 1600);
const PHOTO_WEBP_QUALITY = Number(process.env.PHOTO_WEBP_QUALITY || 75);
const PHOTO_RETENTION_DAYS = Number(process.env.PHOTO_RETENTION_DAYS || 30);
const PHOTO_CLEANUP_INTERVAL_MS = Number(process.env.PHOTO_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000);

function getPhotoPublicBaseUrl() {
  if (process.env.PHOTO_PUBLIC_BASE_URL) {
    return process.env.PHOTO_PUBLIC_BASE_URL.replace(/\/+$/, '');
  }

  if (process.env.WEBHOOK_URL) {
    try {
      const webhookUrl = new URL(process.env.WEBHOOK_URL);
      return `${webhookUrl.origin}/photos`;
    } catch (error) {
      return '';
    }
  }

  return '';
}

function ensurePhotoStorageDir() {
  fs.mkdirSync(PHOTO_STORAGE_DIR, { recursive: true });
}

function buildPhotoFileName(userId) {
  const random = crypto.randomBytes(8).toString('hex');
  return `${Date.now()}-${String(userId)}-${random}.webp`;
}

async function savePhotoFromUpdate(update, userId) {
  const sourceUrl = getImageAttachmentUrl(update);
  if (!sourceUrl) {
    return null;
  }

  if (!PHOTO_PUBLIC_BASE_URL) {
    throw new Error('Не задан PHOTO_PUBLIC_BASE_URL или WEBHOOK_URL для формирования ссылки на фото');
  }

  ensurePhotoStorageDir();

  const { buffer } = await downloadUrl(sourceUrl);
  const fileName = buildPhotoFileName(userId);
  const outputPath = path.join(PHOTO_STORAGE_DIR, fileName);

  await sharp(buffer)
    .rotate()
    .resize({
      width: PHOTO_MAX_WIDTH,
      withoutEnlargement: true
    })
    .webp({ quality: PHOTO_WEBP_QUALITY })
    .toFile(outputPath);

  const previewBuffer = await sharp(buffer)
    .rotate()
    .resize({
      width: PHOTO_MAX_WIDTH,
      withoutEnlargement: true
    })
    .jpeg({ quality: PHOTO_WEBP_QUALITY })
    .toBuffer();
  const messageImagePayload = await uploadImageBuffer(previewBuffer, fileName.replace(/\.webp$/, '.jpg'));

  return {
    fileName,
    messageImagePayload,
    path: outputPath,
    url: `${PHOTO_PUBLIC_BASE_URL}/${encodeURIComponent(fileName)}`
  };
}

async function cleanupOldPhotos() {
  ensurePhotoStorageDir();

  if (!Number.isFinite(PHOTO_RETENTION_DAYS) || PHOTO_RETENTION_DAYS <= 0) {
    console.log(`[${new Date().toISOString()}] Очистка фото отключена: PHOTO_RETENTION_DAYS=${PHOTO_RETENTION_DAYS}`);
    return { deleted: 0, retentionDays: PHOTO_RETENTION_DAYS };
  }

  const now = Date.now();
  const retentionMs = PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = await fs.promises.readdir(PHOTO_STORAGE_DIR, { withFileTypes: true });
  let deleted = 0;

  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }

    const filePath = path.join(PHOTO_STORAGE_DIR, file.name);
    let stats;

    try {
      stats = await fs.promises.stat(filePath);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Не удалось прочитать параметры фото ${file.name}:`, error);
      continue;
    }

    if (now - stats.mtimeMs < retentionMs) {
      continue;
    }

    try {
      await fs.promises.unlink(filePath);
      deleted += 1;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Не удалось удалить старое фото ${file.name}:`, error);
    }
  }

  console.log(`[${new Date().toISOString()}] Очистка фото завершена. Удалено файлов: ${deleted}. Срок хранения: ${PHOTO_RETENTION_DAYS} дн.`);
  return { deleted, retentionDays: PHOTO_RETENTION_DAYS };
}

function startPhotoCleanupScheduler() {
  cleanupOldPhotos().catch((error) => {
    console.error(`[${new Date().toISOString()}] Ошибка очистки старых фото:`, error);
  });

  const interval = setInterval(() => {
    cleanupOldPhotos().catch((error) => {
      console.error(`[${new Date().toISOString()}] Ошибка очистки старых фото:`, error);
    });
  }, PHOTO_CLEANUP_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  return () => clearInterval(interval);
}

module.exports = {
  PHOTO_STORAGE_DIR,
  cleanupOldPhotos,
  startPhotoCleanupScheduler,
  savePhotoFromUpdate
};
