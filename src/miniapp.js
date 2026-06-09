const express = require('express');
const { miniAppAuthMiddleware } = require('./services/miniAppAuthService');
const { getMiniAppBootstrap, listRegions, listShops } = require('./services/catalogService');
const {
  createFixation,
  createOnlineTheft,
  listMiniAppRecentFixations
} = require('./services/fixationService');
const {
  createKsoReport,
  createTechReport,
  createTextReport
} = require('./services/reportService');

const router = express.Router();

router.use(miniAppAuthMiddleware);

function postAction(paths, action) {
  router.post(paths, async (req, res, next) => {
    try {
      const result = await action(req.body, req);
      res.json({ ok: true, ...(result || {}) });
    } catch (error) {
      next(error);
    }
  });
}

router.get(['/bootstrap', '/config'], (req, res) => {
  res.json(getMiniAppBootstrap(req.miniAppUserId || null));
});

router.get('/catalog/regions', (req, res) => {
  res.json({ ok: true, regions: listRegions() });
});

router.get('/catalog/shops', (req, res) => {
  res.json({
    ok: true,
    shops: listShops(req.query.regionId || null)
  });
});

router.get('/fixations/recent', (req, res) => {
  res.json({
    ok: true,
    fixations: listMiniAppRecentFixations(req.miniAppUserId || null, 5)
  });
});

postAction('/fixations', (body, req) => createFixation({
  ...body,
  userId: req.miniAppUserId || body.userId
}));
postAction('/online-thefts', (body, req) => createOnlineTheft({
  ...body,
  userId: req.miniAppUserId || body.userId
}));
postAction(['/reports', '/text-report'], createTextReport);
postAction(['/kso', '/kso-report'], createKsoReport);
postAction(['/tech', '/tech-report'], createTechReport);

router.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if ((error.statusCode || 500) >= 500) {
    console.error(`[${new Date().toISOString()}] Ошибка mini app API:`, error);
  } else if (String(process.env.MINIAPP_LOG_CLIENT_ERRORS || '').toLowerCase() === 'true') {
    console.warn(`[${new Date().toISOString()}] Ошибка запроса mini app API: ${error.message}`);
  }

  res.status(error.statusCode || 500).json({
    ok: false,
    error: error.message || 'Ошибка mini app API'
  });
});

module.exports = { miniAppApiRouter: router };
