const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials/service-account.json';
const DATA_SHEET_NAME = 'Данные';
const HEADERS = [
  'ФИО',
  'Регион',
  'Магазин',
  'Дата',
  'Наименование товара',
  'Тип фиксации',
  'Сумма кражи',
  'Сумма у. кражи',
  'Сумма нарушения',
  'Причина упущенной кражи',
  'Фото',
  'Ссылка на фото'
];
const HEADER_RANGE = 'A1:L1';
const GOOGLE_REQUEST_TIMEOUT_MS = Number(process.env.GOOGLE_REQUEST_TIMEOUT_MS || 20000);
const MIN_EXTRA_ROWS = 1000;

let sheetsClient;

function logError(message, error) {
  if (error && error.response) {
    console.error(`[${new Date().toISOString()}] ${message}`, {
      message: error.message,
      code: error.code,
      status: error.response.status,
      data: error.response.data
    });
    return;
  }

  console.error(`[${new Date().toISOString()}] ${message}`, {
    message: error?.message,
    code: error?.code
  });
}

function log(message, data) {
  if (data === undefined) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    return;
  }

  console.log(`[${new Date().toISOString()}] ${message}`, data);
}

function withTimeout(promise, stepName) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`Google Sheets timeout на шаге: ${stepName}`);
      error.code = 'GOOGLE_SHEETS_TIMEOUT';
      reject(error);
    }, GOOGLE_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function escapeSheetName(name) {
  return String(name).replace(/'/g, "''");
}

function getSheetsClient() {
  if (!SHEET_ID) {
    throw new Error('Не задана переменная окружения GOOGLE_SHEET_ID');
  }

  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
  }

  return sheetsClient;
}

async function ensureShopSheet(sheets, shop) {
  log('Google Sheets: проверяем лист магазина.', { shop });

  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение метаданных таблицы'
  );

  const existingSheet = spreadsheet.data.sheets.find((sheet) => {
    return sheet.properties && sheet.properties.title === shop;
  });

  if (!existingSheet) {
    await withTimeout(
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: shop
                }
              }
            }
          ]
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      'создание листа магазина'
    );
  }

  const headerResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${escapeSheetName(shop)}'!${HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение заголовков листа'
  );
  const currentHeaders = headerResponse.data.values?.[0] || [];
  const headersAreActual = HEADERS.every((header, index) => currentHeaders[index] === header);

  if (headersAreActual) {
    return;
  }

  await withTimeout(
    sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `'${escapeSheetName(shop)}'!A1:Z1`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка старой строки заголовков'
  );

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${escapeSheetName(shop)}'!${HEADER_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [HEADERS]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'обновление заголовков листа'
  );
}

function findNextDataRow(values) {
  const rows = values || [];

  for (let index = rows.length - 1; index >= 1; index -= 1) {
    const hasData = (rows[index] || []).some((cell) => String(cell || '').trim() !== '');
    if (hasData) {
      return index + 2;
    }
  }

  return 2;
}

async function getSheetProperties(sheets, sheetName) {
  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `получение свойств листа ${sheetName}`
  );

  const sheet = spreadsheet.data.sheets.find((item) => {
    return item.properties && item.properties.title === sheetName;
  });

  if (!sheet?.properties) {
    throw new Error(`Лист ${sheetName} не найден`);
  }

  return sheet.properties;
}

async function ensureSheetHasRows(sheets, sheetName, minRows) {
  const properties = await getSheetProperties(sheets, sheetName);
  const rowCount = properties.gridProperties?.rowCount || 0;

  if (rowCount >= minRows) {
    return;
  }

  const targetRows = minRows + MIN_EXTRA_ROWS;
  log('Google Sheets: расширяем лист перед записью.', {
    sheetName,
    currentRows: rowCount,
    targetRows
  });

  await withTimeout(
    sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: properties.sheetId,
                gridProperties: {
                  rowCount: targetRows
                }
              },
              fields: 'gridProperties.rowCount'
            }
          }
        ]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `расширение листа ${sheetName} до ${targetRows} строк`
  );
}

async function writeRowToNextFreeLine(sheets, sheetName, row) {
  const escapedSheetName = escapeSheetName(sheetName);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!A:L`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск свободной строки на листе ${sheetName}`
  );

  const nextRow = findNextDataRow(valuesResponse.data.values);
  await ensureSheetHasRows(sheets, sheetName, nextRow);
  log('Google Sheets: записываем строку в явный диапазон.', { sheetName, row: nextRow });

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!A${nextRow}:L${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `запись строки ${nextRow} на лист ${sheetName}`
  );
}

async function appendRow(shop, row) {
  try {
    log('Google Sheets: начинаем запись строки.', { shop });
    const sheets = getSheetsClient();
    await ensureShopSheet(sheets, shop);
    await ensureShopSheet(sheets, DATA_SHEET_NAME);

    await writeRowToNextFreeLine(sheets, shop, row);
    await writeRowToNextFreeLine(sheets, DATA_SHEET_NAME, row);

    log('Google Sheets: строка успешно записана.', { shop });
  } catch (error) {
    logError('Ошибка записи в Google Sheets:', error);
    throw error;
  }
}

module.exports = { appendRow };
