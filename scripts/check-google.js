require('dotenv').config();

const dns = require('dns');
const https = require('https');
const { google } = require('googleapis');

dns.setDefaultResultOrder('ipv4first');

const REQUEST_TIMEOUT_MS = Number(process.env.GOOGLE_REQUEST_TIMEOUT_MS || 20000);

function withTimeout(promise, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Таймаут на шаге: ${label}`));
    }, REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function checkHttps(host) {
  return withTimeout(new Promise((resolve, reject) => {
    const request = https.request({
      method: 'HEAD',
      host,
      path: '/',
      timeout: REQUEST_TIMEOUT_MS
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });

    request.on('timeout', () => {
      request.destroy(new Error(`HTTPS timeout: ${host}`));
    });
    request.on('error', reject);
    request.end();
  }), `HTTPS ${host}`);
}

async function main() {
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials/service-account.json';
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  console.log('Проверяем переменные окружения...');
  console.log({
    credentialsPath,
    hasSpreadsheetId: Boolean(spreadsheetId),
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  if (!spreadsheetId) {
    throw new Error('Не задан GOOGLE_SHEET_ID');
  }

  console.log('Проверяем DNS oauth2.googleapis.com...');
  console.log(await withTimeout(dns.promises.lookup('oauth2.googleapis.com'), 'DNS oauth2.googleapis.com'));

  console.log('Проверяем DNS sheets.googleapis.com...');
  console.log(await withTimeout(dns.promises.lookup('sheets.googleapis.com'), 'DNS sheets.googleapis.com'));

  console.log('Проверяем HTTPS oauth2.googleapis.com...');
  console.log(await checkHttps('oauth2.googleapis.com'));

  console.log('Проверяем HTTPS sheets.googleapis.com...');
  console.log(await checkHttps('sheets.googleapis.com'));

  console.log('Проверяем авторизацию service account...');
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const client = await withTimeout(auth.getClient(), 'получение OAuth-клиента');
  await withTimeout(client.getAccessToken(), 'получение access token');

  console.log('Проверяем доступ к Google Таблице...');
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await withTimeout(
    sheets.spreadsheets.get({ spreadsheetId }),
    'чтение метаданных таблицы'
  );

  console.log('Google Sheets доступен:', response.data.properties.title);
}

main().catch((error) => {
  console.error('Проверка Google Sheets не пройдена:', {
    message: error.message,
    code: error.code,
    status: error.response?.status,
    data: error.response?.data
  });
  process.exitCode = 1;
});
