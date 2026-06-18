const express = require('express');
const { miniAppAuthMiddleware } = require('./services/miniAppAuthService');
const { getMiniAppBootstrap, listRegions, listShops } = require('./services/catalogService');
const { getMiniAppBonusSummary } = require('./services/bonusService');
const {
  createFixation,
  createOnlineTheft,
  listMiniAppRecentFixations
} = require('./services/fixationService');
const {
  createAnonymousFeedback,
  createKsoReport,
  createTechReport,
  createTextReport
} = require('./services/reportService');
const {
  archiveRejectedKsoScheduleRequest,
  approveKsoScheduleRequest,
  createKsoScheduleMonth,
  createKsoScheduleStatus,
  getKsoScheduleMonth,
  getKsoScheduleTable,
  listKsoScheduleRequestItems,
  revokeApprovedKsoScheduleMonth,
  updateKsoScheduleRegion,
  updateApprovedKsoScheduleMonth
} = require('./services/ksoScheduleService');
const { getKsoDecisionModel } = require('./services/ksoDecisionService');
const {
  parseInputDate,
  previewKsoDecisionAssignment,
  todayIso
} = require('./ksoAssignment');

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

router.get('/bonuses', async (req, res, next) => {
  try {
    res.json({
      ok: true,
      bonus: await getMiniAppBonusSummary(req.miniAppUserId || null, req.query.month || '')
    });
  } catch (error) {
    next(error);
  }
});

router.get('/kso-decision/model', (req, res) => {
  res.json({ ok: true, model: getKsoDecisionModel() });
});

router.get('/kso-decision/preview', async (req, res, next) => {
  try {
    const isoDate = req.query.date ? parseInputDate(req.query.date) : todayIso();
    if (!isoDate) {
      const error = new Error('Укажите дату в формате ДД.ММ или ДД.ММ.ГГГГ');
      error.statusCode = 400;
      throw error;
    }

    res.json({
      ok: true,
      preview: await previewKsoDecisionAssignment(isoDate)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/kso-schedule/month', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await getKsoScheduleMonth(req.query || {})) });
  } catch (error) {
    next(error);
  }
});

router.get('/kso-schedule/requests', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await listKsoScheduleRequestItems(req)) });
  } catch (error) {
    next(error);
  }
});

router.get('/kso-schedule/table', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await getKsoScheduleTable(req.query || {}, req)) });
  } catch (error) {
    next(error);
  }
});

postAction('/fixations', (body, req) => createFixation({
  ...body,
  userId: req.miniAppUserId || body.userId
}));
postAction('/online-thefts', (body, req) => createOnlineTheft({
  ...body,
  userId: req.miniAppUserId || body.userId
}));
postAction('/anonymous-feedback', createAnonymousFeedback);
postAction(['/reports', '/text-report'], createTextReport);
postAction(['/kso', '/kso-report'], createKsoReport);
postAction('/kso-schedule', createKsoScheduleStatus);
postAction('/kso-schedule/month', createKsoScheduleMonth);
postAction('/kso-schedule/region', updateKsoScheduleRegion);
postAction('/kso-schedule/review', approveKsoScheduleRequest);
postAction('/kso-schedule/archive', archiveRejectedKsoScheduleRequest);
postAction('/kso-schedule/update-approved', updateApprovedKsoScheduleMonth);
postAction('/kso-schedule/revoke-approved', revokeApprovedKsoScheduleMonth);
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
