const { google } = require('googleapis');
const { MAX_PHOTOS_PER_RECORD } = require('./constants');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials/service-account.json';
const DATA_SHEET_NAME = 'Данные';
const BASE_HEADERS = [
  'ФИО',
  'Регион',
  'Магазин',
  'Дата',
  'Наименование товара',
  'Тип фиксации',
  'Сумма кражи',
  'Сумма у. кражи',
  'Сумма нарушения',
  'Причина упущенной кражи'
];
const PHOTO_HEADERS = Array.from({ length: MAX_PHOTOS_PER_RECORD }, (_, index) => {
  const photoNumber = index + 1;
  return [`Фото ${photoNumber}`, `Ссылка на фото ${photoNumber}`];
}).flat();
const HEADERS = [...BASE_HEADERS, ...PHOTO_HEADERS];
const HEADER_END_COLUMN = columnNameByIndex(HEADERS.length);
const DATA_RANGE = `A:${HEADER_END_COLUMN}`;
const HEADER_RANGE = `A1:${HEADER_END_COLUMN}1`;
const GOOGLE_REQUEST_TIMEOUT_MS = Number(process.env.GOOGLE_REQUEST_TIMEOUT_MS || 20000);
const MIN_EXTRA_ROWS = 1000;
const MIN_EXTRA_COLUMNS = 5;

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

function columnNameByIndex(index) {
  let number = index;
  let name = '';

  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }

  return name;
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

  await ensureSheetGridSize(sheets, shop, 1, HEADERS.length);

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
      range: `'${escapeSheetName(shop)}'!${HEADER_RANGE}`
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

async function ensureSheetGridSize(sheets, sheetName, minRows, minColumns = HEADERS.length) {
  const properties = await getSheetProperties(sheets, sheetName);
  const rowCount = properties.gridProperties?.rowCount || 0;
  const columnCount = properties.gridProperties?.columnCount || 0;

  if (rowCount >= minRows && columnCount >= minColumns) {
    return;
  }

  const targetRows = rowCount >= minRows ? rowCount : minRows + MIN_EXTRA_ROWS;
  const targetColumns = columnCount >= minColumns ? columnCount : minColumns + MIN_EXTRA_COLUMNS;
  log('Google Sheets: расширяем лист перед записью.', {
    sheetName,
    currentRows: rowCount,
    currentColumns: columnCount,
    targetRows,
    targetColumns
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
                  rowCount: targetRows,
                  columnCount: targetColumns
                }
              },
              fields: 'gridProperties.rowCount,gridProperties.columnCount'
            }
          }
        ]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `расширение листа ${sheetName} до ${targetRows} строк и ${targetColumns} колонок`
  );
}

async function writeRowToNextFreeLine(sheets, sheetName, row) {
  const escapedSheetName = escapeSheetName(sheetName);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!${DATA_RANGE}`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск свободной строки на листе ${sheetName}`
  );

  const nextRow = findNextDataRow(valuesResponse.data.values);
  await ensureSheetGridSize(sheets, sheetName, nextRow, HEADERS.length);
  log('Google Sheets: записываем строку в явный диапазон.', { sheetName, row: nextRow });

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!A${nextRow}:${HEADER_END_COLUMN}${nextRow}`,
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
