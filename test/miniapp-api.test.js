const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { after, beforeEach, describe, test } = require('node:test');
const express = require('express');
const { ROLES } = require('../src/constants');
const { miniAppApiRouter } = require('../src/miniapp');
const { saveEmployee, saveKsoScheduleRequest, saveProfile } = require('../src/db');
const { buildBonusSummary } = require('../src/services/bonusService');
const { createMiniAppLogin, validateMaxWebAppInitData } = require('../src/services/miniAppAuthService');

const originalMiniAppAuthRequired = process.env.MINIAPP_AUTH_REQUIRED;
const originalRequireMaxInitData = process.env.MINIAPP_REQUIRE_MAX_INIT_DATA;
const originalAllowMaxInitAuth = process.env.MINIAPP_ALLOW_MAX_INIT_AUTH;
const originalMaxBotToken = process.env.MAX_BOT_TOKEN;

function signMaxInitData(params, botToken) {
  const encodedParams = Object.entries(params)
    .map(([key, value]) => [key, encodeURIComponent(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  const launchParams = encodedParams
    .map(([key, value]) => `${key}=${decodeURIComponent(value)}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(launchParams).digest('hex');

  return [
    ...encodedParams.map(([key, value]) => `${key}=${value}`),
    `hash=${hash}`
  ].join('&');
}

function createTestServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/miniapp', miniAppApiRouter);

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    })
  };
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

beforeEach(() => {
  process.env.MINIAPP_AUTH_REQUIRED = 'false';
  process.env.MINIAPP_REQUIRE_MAX_INIT_DATA = 'false';
  process.env.MINIAPP_ALLOW_MAX_INIT_AUTH = 'false';
  process.env.MAX_BOT_TOKEN = 'test-max-token';
});

after(() => {
  if (originalMiniAppAuthRequired === undefined) {
    delete process.env.MINIAPP_AUTH_REQUIRED;
  } else {
    process.env.MINIAPP_AUTH_REQUIRED = originalMiniAppAuthRequired;
  }

  if (originalRequireMaxInitData === undefined) {
    delete process.env.MINIAPP_REQUIRE_MAX_INIT_DATA;
  } else {
    process.env.MINIAPP_REQUIRE_MAX_INIT_DATA = originalRequireMaxInitData;
  }

  if (originalAllowMaxInitAuth === undefined) {
    delete process.env.MINIAPP_ALLOW_MAX_INIT_AUTH;
  } else {
    process.env.MINIAPP_ALLOW_MAX_INIT_AUTH = originalAllowMaxInitAuth;
  }

  if (originalMaxBotToken === undefined) {
    delete process.env.MAX_BOT_TOKEN;
  } else {
    process.env.MAX_BOT_TOKEN = originalMaxBotToken;
  }
});

describe('miniapp API smoke', () => {
  test('serves bootstrap with catalog data when auth is disabled', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/bootstrap');

      assert.equal(response.status, 200);
      assert.equal(Array.isArray(body.regions), true);
      assert.equal(typeof body.eventTypes, 'object');
      assert.equal(typeof body.violationTypes, 'object');
      assert.equal(typeof body.maxPhotos, 'number');
      assert.equal(body.user.userId, null);
    } finally {
      await server.close();
    }
  });

  test('keeps legacy config endpoint compatible', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/config');

      assert.equal(response.status, 200);
      assert.equal(Array.isArray(body.regions), true);
      assert.equal(typeof body.eventTypes, 'object');
      assert.equal(typeof body.maxPhotos, 'number');
    } finally {
      await server.close();
    }
  });

  test('serves catalog endpoints', async () => {
    const server = createTestServer();

    try {
      const regions = await requestJson(server.baseUrl, '/api/miniapp/catalog/regions');
      const shops = await requestJson(server.baseUrl, '/api/miniapp/catalog/shops');

      assert.equal(regions.response.status, 200);
      assert.equal(regions.body.ok, true);
      assert.equal(Array.isArray(regions.body.regions), true);

      assert.equal(shops.response.status, 200);
      assert.equal(shops.body.ok, true);
      assert.equal(Array.isArray(shops.body.shops), true);
    } finally {
      await server.close();
    }
  });

  test('serves recent fixations endpoint', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/fixations/recent');

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(Array.isArray(body.fixations), true);
    } finally {
      await server.close();
    }
  });

  test('builds employee bonus summary by selected month', () => {
    const rows = [
      ['Месяц', 'Дата', 'ФИО', 'Тип', 'Сумма', 'ID_Фиксации', 'Премия'],
      ['06.2026', '01.06.2026', 'Иванов Иван', 'Кража', '1 000,50', 'fix-1', '100,50'],
      ['06.2026', '15.06.2026', 'Иванов Иван', 'Упущенная кража', '500', 'fix-2', '50'],
      ['06.2026', '20.06.2026', 'Петров Петр', 'Кража', '900', 'fix-3', '90'],
      ['05.2026', '31.05.2026', 'Иванов Иван', 'Нарушение', '700', 'fix-4', '70']
    ];

    const bonus = buildBonusSummary(rows, 'Иванов Иван', '2026-06');

    assert.equal(bonus.selectedMonth, '2026-06');
    assert.equal(bonus.totalBonus, 150.5);
    assert.equal(bonus.rowsInMonth, 2);
    assert.equal(bonus.recentFixations.length, 3);
    assert.equal(bonus.recentFixations[0].fixationId, 'fix-2');
    assert.deepEqual(bonus.months.map((month) => month.value), ['2026-06', '2026-05']);
  });

  test('bonus endpoint requires known employee fio before reading sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/bonuses');

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /ФИО/i);
    } finally {
      await server.close();
    }
  });

  test('requires token when auth is enabled', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/bootstrap');

      assert.equal(response.status, 401);
      assert.equal(body.ok, false);
      assert.match(body.error, /mini-app|бота/i);
    } finally {
      await server.close();
    }
  });

  test('accepts valid miniapp token', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    const login = createMiniAppLogin('smoke-user');
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/bootstrap', {
        headers: {
          Authorization: `Bearer ${login.token}`
        }
      });

      assert.equal(response.status, 200);
      assert.equal(body.user.userId, 'smoke-user');
      assert.equal(Array.isArray(body.regions), true);
    } finally {
      await server.close();
    }
  });

  test('validates MAX WebApp initData signature', () => {
    const initData = signMaxInitData({
      auth_date: '1771409719',
      query_id: 'query-1',
      start_param: 'payload-token',
      user: JSON.stringify({
        id: 12345,
        first_name: 'Max',
        last_name: 'User',
        username: 'max_user',
        language_code: 'ru',
        photo_url: null
      })
    }, 'test-max-token');

    const data = validateMaxWebAppInitData(initData, 'test-max-token');
    assert.equal(data.user.id, 12345);
    assert.equal(data.start_param, 'payload-token');
    assert.equal(validateMaxWebAppInitData(initData.replace('payload-token', 'other-token'), 'test-max-token'), null);
  });

  test('accepts valid miniapp token when signed MAX initData is missing', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    process.env.MINIAPP_REQUIRE_MAX_INIT_DATA = 'true';
    const login = createMiniAppLogin('12345');
    const initData = signMaxInitData({
      auth_date: '1771409719',
      query_id: 'query-2',
      start_param: login.token,
      user: JSON.stringify({ id: 12345, first_name: 'Max', last_name: 'User' })
    }, 'test-max-token');
    const server = createTestServer();

    try {
      const tokenOnly = await requestJson(server.baseUrl, '/api/miniapp/bootstrap', {
        headers: {
          Authorization: `Bearer ${login.token}`
        }
      });
      const accepted = await requestJson(server.baseUrl, '/api/miniapp/bootstrap', {
        headers: {
          Authorization: `Bearer ${login.token}`,
          'X-Max-WebApp-Data': initData
        }
      });

      assert.equal(tokenOnly.response.status, 200);
      assert.equal(tokenOnly.body.user.userId, '12345');
      assert.equal(accepted.response.status, 200);
      assert.equal(accepted.body.user.userId, '12345');
    } finally {
      await server.close();
    }
  });

  test('rejects miniapp token when signed MAX initData belongs to another user', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    process.env.MINIAPP_REQUIRE_MAX_INIT_DATA = 'true';
    const login = createMiniAppLogin('12345');
    const initData = signMaxInitData({
      auth_date: '1771409719',
      query_id: 'query-mismatch',
      user: JSON.stringify({ id: 67890, first_name: 'Other', last_name: 'User' })
    }, 'test-max-token');
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/bootstrap', {
        headers: {
          Authorization: `Bearer ${login.token}`,
          'X-Max-WebApp-Data': initData
        }
      });

      assert.equal(response.status, 401);
      assert.equal(body.ok, false);
      assert.match(body.error, /не соответствует/i);
    } finally {
      await server.close();
    }
  });

  test('accepts signed MAX initData without bot token for allowed users when enabled', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    process.env.MINIAPP_REQUIRE_MAX_INIT_DATA = 'true';
    process.env.MINIAPP_ALLOW_MAX_INIT_AUTH = 'true';
    saveEmployee('54321', 'Allowed Max User', null, true, 'test');
    const initData = signMaxInitData({
      auth_date: '1771409719',
      query_id: 'query-3',
      user: JSON.stringify({ id: 54321, first_name: 'Allowed', last_name: 'User' })
    }, 'test-max-token');
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/bootstrap', {
        headers: {
          'X-Max-WebApp-Data': initData
        }
      });

      assert.equal(response.status, 200);
      assert.equal(body.user.userId, '54321');
    } finally {
      await server.close();
    }
  });

  test('accepts signed MAX initData without bot token by default for allowed users', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    process.env.MINIAPP_REQUIRE_MAX_INIT_DATA = 'true';
    delete process.env.MINIAPP_ALLOW_MAX_INIT_AUTH;
    saveEmployee('67890', 'Default Max User', null, true);
    const initData = signMaxInitData({
      auth_date: '1710000000',
      user: JSON.stringify({ id: 67890, first_name: 'Default', last_name: 'User' })
    }, 'test-max-token');
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/bootstrap', {
        headers: {
          'X-Max-WebApp-Data': initData
        }
      });

      assert.equal(response.status, 200);
      assert.equal(body.user.userId, '67890');
    } finally {
      await server.close();
    }
  });

  test('validates simple report payload without writing to sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /ФИО|дату|текст/i);
    } finally {
      await server.close();
    }
  });

  test('validates anonymous feedback payload without writing to sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/anonymous-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /обращения/i);
    } finally {
      await server.close();
    }
  });

  test('validates online theft payload without writing to sheets', async () => {
    const server = createTestServer();

    try {
      const bootstrap = await requestJson(server.baseUrl, '/api/miniapp/bootstrap');
      const shop = bootstrap.body.regions[0].shops[0];
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/online-thefts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fio: 'Smoke User',
          shopId: shop.id,
          date: '09.06.2026',
          events: [{
            item: 'Item',
            eventType: bootstrap.body.eventTypes.THEFT,
            amount: '100'
          }]
        })
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /комментарий|фото/i);
    } finally {
      await server.close();
    }
  });

  test('validates KSO schedule payload without writing to sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /статус|дату|ДД\.ММ/i);
    } finally {
      await server.close();
    }
  });

  test('validates KSO schedule month payload without writing to sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/month', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ month: 'bad', entries: [] })
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /месяц|день|графика/i);
    } finally {
      await server.close();
    }
  });

  test('creates KSO schedule draft without writing to sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/month', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fio: 'Schedule User',
          month: '2026-06',
          status: 'draft',
          entries: [
            { date: '2026-06-01', hours: 10 },
            { date: '2026-06-02', hours: 0 }
          ]
        })
      });

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.request.status, 'draft');
      assert.equal(body.totalHours, 10);
    } finally {
      await server.close();
    }
  });

  test('stores KSO schedule shift type in draft without writing to sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/month', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fio: 'Lunch Schedule User',
          month: '2026-06',
          status: 'draft',
          shiftType: 'lunch',
          entries: [
            { date: '2026-06-01', hours: 10, shiftType: 'lunch' },
            { date: '2026-06-02', hours: 10, shiftType: 'morning' }
          ]
        })
      });

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.request.entries[0].shiftType, 'lunch');
      assert.equal(body.request.entries[1].shiftType, 'morning');
    } finally {
      await server.close();
    }
  });

  test('requires reviewer rights for KSO schedule table before reading sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/table?month=2026-06');

      assert.equal(response.status, 403);
      assert.equal(body.ok, false);
      assert.match(body.error, /прав|согласован/i);
    } finally {
      await server.close();
    }
  });

  test('validates edited KSO schedule approval entries before writing to sheets', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    saveEmployee('schedule-employee', 'Schedule Employee', null, true);
    saveProfile('schedule-employee', 'Schedule Employee');
    saveEmployee('schedule-admin', 'Schedule Admin', null, true, null, ROLES.ADMIN);
    const employeeLogin = createMiniAppLogin('schedule-employee');
    const adminLogin = createMiniAppLogin('schedule-admin');
    const server = createTestServer();

    try {
      const created = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/month', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeLogin.token}`
        },
        body: JSON.stringify({
          month: '2026-06',
          status: 'submitted',
          entries: [
            { date: '2026-06-01', hours: 10 },
            { date: '2026-06-02', hours: 10 }
          ]
        })
      });

      assert.equal(created.response.status, 200);
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`
        },
        body: JSON.stringify({
          requestId: created.body.request.id,
          action: 'approved',
          entries: [
            { date: '2026-07-01', hours: 10 }
          ]
        })
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /даты|месяцу/i);
    } finally {
      await server.close();
    }
  });

  test('archives rejected KSO schedule requests', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    const requestId = `archive-rejected-request-${Date.now()}`;
    saveEmployee('archive-admin', 'Archive Admin', null, true, null, ROLES.ADMIN);
    saveKsoScheduleRequest({
      id: requestId,
      userId: 'archive-user',
      fio: 'Archive User',
      month: '2026-06',
      requestType: 'month',
      status: 'rejected',
      entries: [
        { isoDate: '2026-06-01', hours: 10 }
      ]
    });
    const adminLogin = createMiniAppLogin('archive-admin');
    const server = createTestServer();

    try {
      const archived = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/archive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`
        },
        body: JSON.stringify({ requestId })
      });

      assert.equal(archived.response.status, 200);
      assert.equal(archived.body.ok, true);

      const listed = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/requests', {
        headers: {
          Authorization: `Bearer ${adminLogin.token}`
        }
      });

      assert.equal(listed.response.status, 200);
      assert.equal(listed.body.requests.some((request) => request.id === requestId), false);
    } finally {
      await server.close();
    }
  });

  test('validates manual edits of approved KSO schedule before writing to sheets', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    const requestId = `approved-edit-request-${Date.now()}`;
    saveEmployee('approved-edit-admin', 'Approved Edit Admin', null, true, null, ROLES.ADMIN);
    saveKsoScheduleRequest({
      id: requestId,
      userId: 'approved-edit-user',
      fio: 'Approved Edit User',
      month: '2026-06',
      requestType: 'month',
      status: 'approved',
      entries: [
        { isoDate: '2026-06-01', hours: 10 }
      ]
    });
    const adminLogin = createMiniAppLogin('approved-edit-admin');
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/update-approved', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`
        },
        body: JSON.stringify({
          requestId,
          entries: [
            { date: '2026-07-01', hours: 10 }
          ]
        })
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /даты|месяцу/i);
    } finally {
      await server.close();
    }
  });

  test('rejects revoke for non-approved KSO schedule before writing to sheets', async () => {
    process.env.MINIAPP_AUTH_REQUIRED = 'true';
    const requestId = `revoke-draft-request-${Date.now()}`;
    saveEmployee('revoke-admin', 'Revoke Admin', null, true, null, ROLES.ADMIN);
    saveKsoScheduleRequest({
      id: requestId,
      userId: 'revoke-user',
      fio: 'Revoke User',
      month: '2026-06',
      requestType: 'month',
      status: 'draft',
      entries: [
        { isoDate: '2026-06-01', hours: 10, shiftType: 'morning' }
      ]
    });
    const adminLogin = createMiniAppLogin('revoke-admin');
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-schedule/revoke-approved', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`
        },
        body: JSON.stringify({ requestId })
      });

      assert.equal(response.status, 404);
      assert.equal(body.ok, false);
      assert.match(body.error, /согласованный|approved|график/i);
    } finally {
      await server.close();
    }
  });

  test('serves KSO decision model', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-decision/model');

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.model.storeComplexity.formula.includes('Ks'), true);
      assert.equal(body.model.employeeKpi.eventPointWeights.online, 4);
      assert.equal(Array.isArray(body.model.employeeKpi.norms), true);
    } finally {
      await server.close();
    }
  });

  test('validates KSO decision preview date before reading sheets', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/kso-decision/preview?date=bad-date');

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /ДД\.ММ/i);
    } finally {
      await server.close();
    }
  });

  test('keeps legacy simple report endpoint compatible', async () => {
    const server = createTestServer();

    try {
      const { response, body } = await requestJson(server.baseUrl, '/api/miniapp/text-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.error, /ФИО|дату|текст/i);
    } finally {
      await server.close();
    }
  });
});
