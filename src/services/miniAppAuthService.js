const { createHmac, randomBytes, timingSafeEqual } = require('crypto');
const {
  createMiniAppSession,
  deleteExpiredMiniAppSessions,
  isAllowedUser,
  getMiniAppSession,
  markMiniAppSessionUsed
} = require('../db');

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function isMiniAppAuthRequired() {
  return String(process.env.MINIAPP_AUTH_REQUIRED || '').toLowerCase() === 'true';
}

function isMaxInitDataRequired() {
  return String(process.env.MINIAPP_REQUIRE_MAX_INIT_DATA || '').toLowerCase() === 'true';
}

function isMaxInitDataAuthAllowed() {
  return String(process.env.MINIAPP_ALLOW_MAX_INIT_AUTH || 'true').toLowerCase() !== 'false';
}

function getMiniAppSessionTtlMs() {
  const value = Number(process.env.MINIAPP_SESSION_TTL_MS || DEFAULT_TTL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_MS;
}

function getMiniAppSessionCleanupIntervalMs() {
  const value = Number(process.env.MINIAPP_SESSION_CLEANUP_INTERVAL_MS || DEFAULT_CLEANUP_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CLEANUP_INTERVAL_MS;
}

function getMiniAppBaseUrl() {
  const explicitUrl = process.env.MINIAPP_BASE_URL || process.env.MINIAPP_PUBLIC_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  if (process.env.WEBHOOK_URL) {
    return new URL('/miniapp/', process.env.WEBHOOK_URL).toString();
  }

  return 'http://localhost:3000/miniapp/';
}

function createMiniAppLogin(userId) {
  deleteExpiredMiniAppSessions();

  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + getMiniAppSessionTtlMs();
  const session = createMiniAppSession(token, userId, expiresAt);
  const url = new URL(getMiniAppBaseUrl());
  url.searchParams.set('token', token);

  return {
    token,
    url: url.toString(),
    expiresAt: session.expiresAt
  };
}

function extractMiniAppToken(req) {
  const authHeader = String(req.headers.authorization || '');
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }

  return String(req.query.token || req.body?.token || '').trim();
}

function extractMaxInitData(req) {
  return String(req.headers['x-max-webapp-data'] || req.query.WebAppData || req.body?.webAppData || '').trim();
}

function splitParamPair(pair) {
  const separatorIndex = pair.indexOf('=');
  if (separatorIndex < 0) {
    return [pair, ''];
  }

  return [
    pair.slice(0, separatorIndex),
    pair.slice(separatorIndex + 1)
  ];
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function validateMaxWebAppInitData(initData, botToken = process.env.MAX_BOT_TOKEN || '') {
  if (!initData || !botToken) {
    return null;
  }

  const params = initData.split('&').filter(Boolean).map(splitParamPair);
  const seenKeys = new Set();
  for (const [key] of params) {
    if (!key || seenKeys.has(key)) {
      return null;
    }
    seenKeys.add(key);
  }

  const hashParams = params.filter(([key]) => key === 'hash');
  if (hashParams.length !== 1 || !hashParams[0][1]) {
    return null;
  }

  const originalHash = hashParams[0][1];
  const decodedParams = params
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => [key, decodeURIComponent(value || '')])
    .sort(([left], [right]) => left.localeCompare(right));
  const launchParams = decodedParams.map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(launchParams).digest('hex');

  if (!safeEqualHex(hash, originalHash)) {
    return null;
  }

  const result = Object.fromEntries(decodedParams);
  if (result.user) {
    try {
      result.user = JSON.parse(result.user);
    } catch (error) {
      return null;
    }
  }
  if (result.chat) {
    try {
      result.chat = JSON.parse(result.chat);
    } catch (error) {
      return null;
    }
  }

  return result;
}

function validateMiniAppToken(token) {
  if (!token) {
    return null;
  }

  const session = getMiniAppSession(token);
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  if (!session.usedAt) {
    session.usedAt = markMiniAppSessionUsed(token);
  }

  return session;
}

function miniAppAuthMiddleware(req, res, next) {
  if (!isMiniAppAuthRequired()) {
    next();
    return;
  }

  const maxInitData = validateMaxWebAppInitData(extractMaxInitData(req));
  if (isMaxInitDataRequired() && !maxInitData) {
    res.status(401).json({
      ok: false,
      error: 'Требуется открыть mini-app внутри MAX'
    });
    return;
  }

  const session = validateMiniAppToken(extractMiniAppToken(req));
  if (!session) {
    const maxUserId = maxInitData?.user?.id ? String(maxInitData.user.id) : null;
    if (isMaxInitDataAuthAllowed() && maxUserId && isAllowedUser(maxUserId)) {
      req.miniAppSession = null;
      req.miniAppUserId = maxUserId;
      req.maxWebAppData = maxInitData;
      next();
      return;
    }

    res.status(401).json({
      ok: false,
      error: 'Требуется открыть mini-app через бота'
    });
    return;
  }

  const maxUserId = maxInitData?.user?.id ? String(maxInitData.user.id) : null;
  if (isMaxInitDataRequired() && maxUserId && maxUserId !== String(session.userId)) {
    res.status(401).json({
      ok: false,
      error: 'Сессия mini-app не соответствует пользователю MAX'
    });
    return;
  }

  req.miniAppSession = session;
  req.miniAppUserId = session.userId;
  req.maxWebAppData = maxInitData;
  next();
}

function runMiniAppSessionCleanup() {
  const deleted = deleteExpiredMiniAppSessions();
  console.log(`[${new Date().toISOString()}] Очистка mini-app сессий завершена. Удалено записей: ${deleted}.`);
  return deleted;
}

function startMiniAppSessionCleanupScheduler() {
  runMiniAppSessionCleanup();

  const timer = setInterval(runMiniAppSessionCleanup, getMiniAppSessionCleanupIntervalMs());
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return () => clearInterval(timer);
}

module.exports = {
  createMiniAppLogin,
  extractMiniAppToken,
  extractMaxInitData,
  getMiniAppBaseUrl,
  getMiniAppSessionCleanupIntervalMs,
  getMiniAppSessionTtlMs,
  isMiniAppAuthRequired,
  isMaxInitDataRequired,
  isMaxInitDataAuthAllowed,
  miniAppAuthMiddleware,
  runMiniAppSessionCleanup,
  startMiniAppSessionCleanupScheduler,
  validateMaxWebAppInitData,
  validateMiniAppToken
};
