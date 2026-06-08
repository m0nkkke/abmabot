const { randomBytes } = require('crypto');
const {
  createMiniAppSession,
  deleteExpiredMiniAppSessions,
  getMiniAppSession,
  markMiniAppSessionUsed
} = require('../db');

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function isMiniAppAuthRequired() {
  return String(process.env.MINIAPP_AUTH_REQUIRED || '').toLowerCase() === 'true';
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

  const session = validateMiniAppToken(extractMiniAppToken(req));
  if (!session) {
    res.status(401).json({
      ok: false,
      error: 'Требуется открыть mini-app через бота'
    });
    return;
  }

  req.miniAppSession = session;
  req.miniAppUserId = session.userId;
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
  getMiniAppBaseUrl,
  getMiniAppSessionCleanupIntervalMs,
  getMiniAppSessionTtlMs,
  isMiniAppAuthRequired,
  miniAppAuthMiddleware,
  runMiniAppSessionCleanup,
  startMiniAppSessionCleanupScheduler,
  validateMiniAppToken
};
