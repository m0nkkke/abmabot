const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { after, beforeEach, describe, test } = require('node:test');
const express = require('express');
const { miniAppApiRouter } = require('../src/miniapp');
const { saveEmployee } = require('../src/db');
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

  test('requires signed MAX initData when enabled', async () => {
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
      const denied = await requestJson(server.baseUrl, '/api/miniapp/bootstrap', {
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

      assert.equal(denied.response.status, 401);
      assert.equal(accepted.response.status, 200);
      assert.equal(accepted.body.user.userId, '12345');
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
