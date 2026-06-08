const assert = require('node:assert/strict');
const { after, beforeEach, describe, test } = require('node:test');
const express = require('express');
const { miniAppApiRouter } = require('../src/miniapp');
const { createMiniAppLogin } = require('../src/services/miniAppAuthService');

const originalMiniAppAuthRequired = process.env.MINIAPP_AUTH_REQUIRED;

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
});

after(() => {
  if (originalMiniAppAuthRequired === undefined) {
    delete process.env.MINIAPP_AUTH_REQUIRED;
    return;
  }

  process.env.MINIAPP_AUTH_REQUIRED = originalMiniAppAuthRequired;
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
