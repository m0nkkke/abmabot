const { google } = require('googleapis');
const { MAX_PHOTOS_PER_RECORD } = require('./constants');
const { getProfile, listEmployees } = require('./db');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const REPORTS_SHEET_ID = process.env.GOOGLE_REPORTS_SHEET_ID || process.env.GOOGLE_REPORT_SHEET_ID || '';
const TECH_REPORTS_SHEET_ID = process.env.GOOGLE_TECH_REPORTS_SHEET_ID || '';
const BONUS_SHEET_ID = process.env.GOOGLE_BONUS_SHEET_ID || SHEET_ID;
const KSO_ASSIGNMENT_SHEET_ID = process.env.GOOGLE_KSO_ASSIGNMENT_SHEET_ID || SHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials/service-account.json';
const DATA_SHEET_NAME = 'Данные';
const BONUS_SHEET_NAME = process.env.GOOGLE_BONUS_SHEET_NAME || 'Премии [данные]';
const ONLINE_THEFT_SHEET_NAME = process.env.GOOGLE_ONLINE_THEFT_SHEET_NAME || 'Онлайн кражи';
const REPORTS_SHEET_NAME = process.env.GOOGLE_REPORTS_SHEET_NAME || 'Отчеты';
const ANONYMOUS_FEEDBACK_SHEET_NAME = process.env.GOOGLE_ANONYMOUS_FEEDBACK_SHEET_NAME || 'Анонимные обращения';
const KSO_SHEET_NAME = process.env.GOOGLE_KSO_SHEET_NAME || 'Отписки КСО';
const TECH_REPORTS_SHEET_NAME = process.env.GOOGLE_TECH_REPORTS_SHEET_NAME || 'Тех. неполадки';
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
HEADERS.push('ID фиксации', 'record_id');
const ONLINE_THEFT_HEADERS = [...BASE_HEADERS, 'Комментарий', ...PHOTO_HEADERS, 'ID фиксации', 'record_id'];
const REPORT_HEADERS = ['ФИО', 'Дата', 'Отчет'];
const KSO_HEADERS = ['ФИО', 'Дата', 'Отписка КСО'];
const TECH_REPORT_HEADERS = ['ФИО', 'Дата', 'Техническая неполадка'];
const HEADER_END_COLUMN = columnNameByIndex(HEADERS.length);
const DATA_RANGE = `A:${HEADER_END_COLUMN}`;
const HEADER_RANGE = `A1:${HEADER_END_COLUMN}1`;
const ONLINE_THEFT_HEADER_END_COLUMN = columnNameByIndex(ONLINE_THEFT_HEADERS.length);
const ONLINE_THEFT_DATA_RANGE = `A:${ONLINE_THEFT_HEADER_END_COLUMN}`;
const ONLINE_THEFT_HEADER_RANGE = `A1:${ONLINE_THEFT_HEADER_END_COLUMN}1`;
const REPORT_HEADER_END_COLUMN = columnNameByIndex(REPORT_HEADERS.length);
const REPORT_DATA_RANGE = `A:${REPORT_HEADER_END_COLUMN}`;
const REPORT_HEADER_RANGE = `A1:${REPORT_HEADER_END_COLUMN}1`;
const KSO_HEADER_END_COLUMN = columnNameByIndex(KSO_HEADERS.length);
const KSO_DATA_RANGE = `A:${KSO_HEADER_END_COLUMN}`;
const KSO_HEADER_RANGE = `A1:${KSO_HEADER_END_COLUMN}1`;
const TECH_REPORT_HEADER_END_COLUMN = columnNameByIndex(TECH_REPORT_HEADERS.length);
const TECH_REPORT_DATA_RANGE = `A:${TECH_REPORT_HEADER_END_COLUMN}`;
const TECH_REPORT_HEADER_RANGE = `A1:${TECH_REPORT_HEADER_END_COLUMN}1`;
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
  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
  }

  return sheetsClient;
}

function getReportsSheetId() {
  if (!REPORTS_SHEET_ID) {
    throw new Error('Не задана переменная окружения GOOGLE_REPORTS_SHEET_ID');
  }

  return REPORTS_SHEET_ID;
}

function getTechReportsSheetId() {
  if (!TECH_REPORTS_SHEET_ID) {
    throw new Error('Не задана переменная окружения GOOGLE_TECH_REPORTS_SHEET_ID');
  }

  return TECH_REPORTS_SHEET_ID;
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

async function ensureOnlineTheftSheet(sheets) {
  log('Google Sheets: проверяем лист онлайн-краж.', { sheet: ONLINE_THEFT_SHEET_NAME });

  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение метаданных таблицы онлайн-краж'
  );

  const existingSheet = spreadsheet.data.sheets.find((sheet) => {
    return sheet.properties && sheet.properties.title === ONLINE_THEFT_SHEET_NAME;
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
                  title: ONLINE_THEFT_SHEET_NAME
                }
              }
            }
          ]
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      'создание листа онлайн-краж'
    );
  }

  await ensureSheetGridSize(sheets, ONLINE_THEFT_SHEET_NAME, 1, ONLINE_THEFT_HEADERS.length);

  const headerResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${escapeSheetName(ONLINE_THEFT_SHEET_NAME)}'!${ONLINE_THEFT_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение заголовков листа онлайн-краж'
  );
  const currentHeaders = headerResponse.data.values?.[0] || [];
  const headersAreActual = ONLINE_THEFT_HEADERS.every((header, index) => currentHeaders[index] === header);

  if (headersAreActual) {
    return;
  }

  await withTimeout(
    sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `'${escapeSheetName(ONLINE_THEFT_SHEET_NAME)}'!${ONLINE_THEFT_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка старой строки заголовков листа онлайн-краж'
  );

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${escapeSheetName(ONLINE_THEFT_SHEET_NAME)}'!${ONLINE_THEFT_HEADER_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [ONLINE_THEFT_HEADERS]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'обновление заголовков листа онлайн-краж'
  );
}

async function ensureTextReportSheet(sheets, sheetName = REPORTS_SHEET_NAME) {
  const spreadsheetId = getReportsSheetId();
  log('Google Sheets: проверяем лист текстовых отчетов.', { sheet: sheetName });

  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение метаданных таблицы отчетов'
  );

  const existingSheet = spreadsheet.data.sheets.find((sheet) => {
    return sheet.properties && sheet.properties.title === sheetName;
  });

  if (!existingSheet) {
    await withTimeout(
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName
                }
              }
            }
          ]
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      'создание листа текстовых отчетов'
    );
  }

  await ensureTextReportGridSize(sheets, 1, REPORT_HEADERS.length, sheetName);

  const headerResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapeSheetName(sheetName)}'!${REPORT_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение заголовков листа текстовых отчетов'
  );
  const currentHeaders = headerResponse.data.values?.[0] || [];
  const headersAreActual = REPORT_HEADERS.every((header, index) => currentHeaders[index] === header);

  if (headersAreActual) {
    return;
  }

  await withTimeout(
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${escapeSheetName(sheetName)}'!${REPORT_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка старой строки заголовков листа текстовых отчетов'
  );

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escapeSheetName(sheetName)}'!${REPORT_HEADER_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [REPORT_HEADERS]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'обновление заголовков листа текстовых отчетов'
  );
}

async function ensureKsoReportSheet(sheets) {
  const spreadsheetId = getReportsSheetId();
  log('Google Sheets: проверяем лист отписок КСО.', { sheet: KSO_SHEET_NAME });

  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение метаданных таблицы отписок КСО'
  );

  const existingSheet = spreadsheet.data.sheets.find((sheet) => {
    return sheet.properties && sheet.properties.title === KSO_SHEET_NAME;
  });

  if (!existingSheet) {
    await withTimeout(
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: KSO_SHEET_NAME
                }
              }
            }
          ]
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      'создание листа отписок КСО'
    );
  }

  await ensureKsoReportGridSize(sheets, 1, KSO_HEADERS.length);

  const headerResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapeSheetName(KSO_SHEET_NAME)}'!${KSO_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение заголовков листа отписок КСО'
  );
  const currentHeaders = headerResponse.data.values?.[0] || [];
  const headersAreActual = KSO_HEADERS.every((header, index) => currentHeaders[index] === header);

  if (headersAreActual) {
    return;
  }

  await withTimeout(
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${escapeSheetName(KSO_SHEET_NAME)}'!${KSO_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка старой строки заголовков листа отписок КСО'
  );

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escapeSheetName(KSO_SHEET_NAME)}'!${KSO_HEADER_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [KSO_HEADERS]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'обновление заголовков листа отписок КСО'
  );
}

async function ensureTechReportSheet(sheets) {
  const spreadsheetId = getTechReportsSheetId();
  log('Google Sheets: проверяем лист технических неполадок.', { sheet: TECH_REPORTS_SHEET_NAME });

  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение метаданных таблицы технических неполадок'
  );

  const existingSheet = spreadsheet.data.sheets.find((sheet) => {
    return sheet.properties && sheet.properties.title === TECH_REPORTS_SHEET_NAME;
  });

  if (!existingSheet) {
    await withTimeout(
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: TECH_REPORTS_SHEET_NAME
                }
              }
            }
          ]
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      'создание листа технических неполадок'
    );
  }

  await ensureTechReportGridSize(sheets, 1, TECH_REPORT_HEADERS.length);

  const headerResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapeSheetName(TECH_REPORTS_SHEET_NAME)}'!${TECH_REPORT_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение заголовков листа технических неполадок'
  );
  const currentHeaders = headerResponse.data.values?.[0] || [];
  const headersAreActual = TECH_REPORT_HEADERS.every((header, index) => currentHeaders[index] === header);

  if (headersAreActual) {
    return;
  }

  await withTimeout(
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${escapeSheetName(TECH_REPORTS_SHEET_NAME)}'!${TECH_REPORT_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка старой строки заголовков листа технических неполадок'
  );

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escapeSheetName(TECH_REPORTS_SHEET_NAME)}'!${TECH_REPORT_HEADER_RANGE}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [TECH_REPORT_HEADERS]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'обновление заголовков листа технических неполадок'
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

async function getTextReportSheetProperties(sheets, sheetName = REPORTS_SHEET_NAME) {
  const spreadsheetId = getReportsSheetId();
  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId,
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

async function ensureTextReportGridSize(sheets, minRows, minColumns = REPORT_HEADERS.length, sheetName = REPORTS_SHEET_NAME) {
  const spreadsheetId = getReportsSheetId();
  const properties = await getTextReportSheetProperties(sheets, sheetName);
  const rowCount = properties.gridProperties?.rowCount || 0;
  const columnCount = properties.gridProperties?.columnCount || 0;

  if (rowCount >= minRows && columnCount >= minColumns) {
    return;
  }

  const targetRows = rowCount >= minRows ? rowCount : minRows + MIN_EXTRA_ROWS;
  const targetColumns = columnCount >= minColumns ? columnCount : minColumns + MIN_EXTRA_COLUMNS;
  log('Google Sheets: расширяем лист отчетов перед записью.', {
    sheetName,
    currentRows: rowCount,
    currentColumns: columnCount,
    targetRows,
    targetColumns
  });

  await withTimeout(
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
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
    `расширение листа отчетов до ${targetRows} строк и ${targetColumns} колонок`
  );
}

async function getKsoReportSheetProperties(sheets) {
  const spreadsheetId = getReportsSheetId();
  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `получение свойств листа ${KSO_SHEET_NAME}`
  );

  const sheet = spreadsheet.data.sheets.find((item) => {
    return item.properties && item.properties.title === KSO_SHEET_NAME;
  });

  if (!sheet?.properties) {
    throw new Error(`Лист ${KSO_SHEET_NAME} не найден`);
  }

  return sheet.properties;
}

async function ensureKsoReportGridSize(sheets, minRows, minColumns = KSO_HEADERS.length) {
  const spreadsheetId = getReportsSheetId();
  const properties = await getKsoReportSheetProperties(sheets);
  const rowCount = properties.gridProperties?.rowCount || 0;
  const columnCount = properties.gridProperties?.columnCount || 0;

  if (rowCount >= minRows && columnCount >= minColumns) {
    return;
  }

  const targetRows = rowCount >= minRows ? rowCount : minRows + MIN_EXTRA_ROWS;
  const targetColumns = columnCount >= minColumns ? columnCount : minColumns + MIN_EXTRA_COLUMNS;
  log('Google Sheets: расширяем лист отписок КСО перед записью.', {
    sheetName: KSO_SHEET_NAME,
    currentRows: rowCount,
    currentColumns: columnCount,
    targetRows,
    targetColumns
  });

  await withTimeout(
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
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
    `расширение листа отписок КСО до ${targetRows} строк и ${targetColumns} колонок`
  );
}

async function getTechReportSheetProperties(sheets) {
  const spreadsheetId = getTechReportsSheetId();
  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `получение свойств листа ${TECH_REPORTS_SHEET_NAME}`
  );

  const sheet = spreadsheet.data.sheets.find((item) => {
    return item.properties && item.properties.title === TECH_REPORTS_SHEET_NAME;
  });

  if (!sheet?.properties) {
    throw new Error(`Лист ${TECH_REPORTS_SHEET_NAME} не найден`);
  }

  return sheet.properties;
}

async function ensureTechReportGridSize(sheets, minRows, minColumns = TECH_REPORT_HEADERS.length) {
  const spreadsheetId = getTechReportsSheetId();
  const properties = await getTechReportSheetProperties(sheets);
  const rowCount = properties.gridProperties?.rowCount || 0;
  const columnCount = properties.gridProperties?.columnCount || 0;

  if (rowCount >= minRows && columnCount >= minColumns) {
    return;
  }

  const targetRows = rowCount >= minRows ? rowCount : minRows + MIN_EXTRA_ROWS;
  const targetColumns = columnCount >= minColumns ? columnCount : minColumns + MIN_EXTRA_COLUMNS;
  log('Google Sheets: расширяем лист технических неполадок перед записью.', {
    sheetName: TECH_REPORTS_SHEET_NAME,
    currentRows: rowCount,
    currentColumns: columnCount,
    targetRows,
    targetColumns
  });

  await withTimeout(
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
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
    `расширение листа технических неполадок до ${targetRows} строк и ${targetColumns} колонок`
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

async function writeOnlineTheftRowToNextFreeLine(sheets, row) {
  const escapedSheetName = escapeSheetName(ONLINE_THEFT_SHEET_NAME);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!${ONLINE_THEFT_DATA_RANGE}`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск свободной строки на листе ${ONLINE_THEFT_SHEET_NAME}`
  );

  const nextRow = findNextDataRow(valuesResponse.data.values);
  await ensureSheetGridSize(sheets, ONLINE_THEFT_SHEET_NAME, nextRow, ONLINE_THEFT_HEADERS.length);
  log('Google Sheets: записываем онлайн-кражу в явный диапазон.', {
    sheetName: ONLINE_THEFT_SHEET_NAME,
    row: nextRow
  });

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!A${nextRow}:${ONLINE_THEFT_HEADER_END_COLUMN}${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `запись строки ${nextRow} на лист ${ONLINE_THEFT_SHEET_NAME}`
  );
}

async function findFixationRows(sheets, sheetName, fixationId) {
  const escapedSheetName = escapeSheetName(sheetName);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!${DATA_RANGE}`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск фиксации ${fixationId} на листе ${sheetName}`
  );

  return (valuesResponse.data.values || []).reduce((rows, row, index) => {
    if (index > 0 && row[HEADERS.length - 2] === fixationId) {
      rows.push(index + 1);
    }
    return rows;
  }, []);
}

async function updateRecordRow(sheets, sheetName, rowNumber, row) {
  const escapedSheetName = escapeSheetName(sheetName);
  await ensureSheetGridSize(sheets, sheetName, rowNumber, HEADERS.length);
  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${escapedSheetName}'!A${rowNumber}:${HEADER_END_COLUMN}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `обновление строки ${rowNumber} на листе ${sheetName}`
  );
}

async function deleteRecordRows(sheets, sheetName, rowNumbers) {
  if (!rowNumbers.length) {
    return;
  }

  const properties = await getSheetProperties(sheets, sheetName);
  const requests = [...rowNumbers]
    .sort((left, right) => right - left)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId: properties.sheetId,
          dimension: 'ROWS',
          startIndex: rowNumber - 1,
          endIndex: rowNumber
        }
      }
    }));

  await withTimeout(
    sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `удаление строк ${rowNumbers.join(', ')} на листе ${sheetName}`
  );
}

async function writeTextReportToNextFreeLine(sheets, row, sheetName = REPORTS_SHEET_NAME) {
  const spreadsheetId = getReportsSheetId();
  const escapedSheetName = escapeSheetName(sheetName);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapedSheetName}'!${REPORT_DATA_RANGE}`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск свободной строки на листе ${sheetName}`
  );

  const nextRow = findNextDataRow(valuesResponse.data.values);
  await ensureTextReportGridSize(sheets, nextRow, REPORT_HEADERS.length, sheetName);
  log('Google Sheets: записываем текстовый отчет в явный диапазон.', {
    sheetName,
    row: nextRow
  });

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escapedSheetName}'!A${nextRow}:${REPORT_HEADER_END_COLUMN}${nextRow}`,
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

async function writeKsoReportToNextFreeLine(sheets, row) {
  const spreadsheetId = getReportsSheetId();
  const escapedSheetName = escapeSheetName(KSO_SHEET_NAME);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapedSheetName}'!${KSO_DATA_RANGE}`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск свободной строки на листе ${KSO_SHEET_NAME}`
  );

  const nextRow = findNextDataRow(valuesResponse.data.values);
  await ensureKsoReportGridSize(sheets, nextRow, KSO_HEADERS.length);
  log('Google Sheets: записываем отписку КСО в явный диапазон.', {
    sheetName: KSO_SHEET_NAME,
    row: nextRow
  });

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escapedSheetName}'!A${nextRow}:${KSO_HEADER_END_COLUMN}${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `запись строки ${nextRow} на лист ${KSO_SHEET_NAME}`
  );
}

async function writeTechReportToNextFreeLine(sheets, row) {
  const spreadsheetId = getTechReportsSheetId();
  const escapedSheetName = escapeSheetName(TECH_REPORTS_SHEET_NAME);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapedSheetName}'!${TECH_REPORT_DATA_RANGE}`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск свободной строки на листе ${TECH_REPORTS_SHEET_NAME}`
  );

  const nextRow = findNextDataRow(valuesResponse.data.values);
  await ensureTechReportGridSize(sheets, nextRow, TECH_REPORT_HEADERS.length);
  log('Google Sheets: записываем техническую неполадку в явный диапазон.', {
    sheetName: TECH_REPORTS_SHEET_NAME,
    row: nextRow
  });

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escapedSheetName}'!A${nextRow}:${TECH_REPORT_HEADER_END_COLUMN}${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `запись строки ${nextRow} на лист ${TECH_REPORTS_SHEET_NAME}`
  );
}

async function appendRow(shop, row) {
  try {
    if (!SHEET_ID) {
      throw new Error('Не задана переменная окружения GOOGLE_SHEET_ID');
    }

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

async function appendOnlineTheftRow(row) {
  try {
    if (!SHEET_ID) {
      throw new Error('Не задана переменная окружения GOOGLE_SHEET_ID');
    }

    log('Google Sheets: начинаем запись онлайн-кражи.', { sheet: ONLINE_THEFT_SHEET_NAME });
    const sheets = getSheetsClient();
    await ensureOnlineTheftSheet(sheets);
    await writeOnlineTheftRowToNextFreeLine(sheets, row);
    log('Google Sheets: онлайн-кража успешно записана.', { sheet: ONLINE_THEFT_SHEET_NAME });
  } catch (error) {
    logError('Ошибка записи онлайн-кражи в Google Sheets:', error);
    throw error;
  }
}

async function replaceRowsOnSheet(sheets, sheetName, existingRows, rows) {
  const commonLength = Math.min(existingRows.length, rows.length);

  for (let index = 0; index < commonLength; index += 1) {
    await updateRecordRow(sheets, sheetName, existingRows[index], rows[index]);
  }

  await deleteRecordRows(sheets, sheetName, existingRows.slice(commonLength));

  for (let index = commonLength; index < rows.length; index += 1) {
    await writeRowToNextFreeLine(sheets, sheetName, rows[index]);
  }
}

async function replaceFixationRows(previousShop, nextShop, fixationId, rows) {
  try {
    if (!SHEET_ID) {
      throw new Error('Не задана переменная окружения GOOGLE_SHEET_ID');
    }

    const sheets = getSheetsClient();
    await ensureShopSheet(sheets, DATA_SHEET_NAME);
    await ensureShopSheet(sheets, previousShop);
    await ensureShopSheet(sheets, nextShop);

    const dataRows = await findFixationRows(sheets, DATA_SHEET_NAME, fixationId);
    const previousShopRows = await findFixationRows(sheets, previousShop, fixationId);

    if (!dataRows.length || !previousShopRows.length) {
      throw new Error(`Не удалось найти редактируемую фиксацию ${fixationId} в Google Sheets`);
    }

    await replaceRowsOnSheet(sheets, DATA_SHEET_NAME, dataRows, rows);

    if (previousShop === nextShop) {
      await replaceRowsOnSheet(sheets, previousShop, previousShopRows, rows);
    } else {
      await deleteRecordRows(sheets, previousShop, previousShopRows);
      for (const row of rows) {
        await writeRowToNextFreeLine(sheets, nextShop, row);
      }
    }

    log('Google Sheets: строки фиксации успешно заменены.', { fixationId, previousShop, nextShop });
  } catch (error) {
    logError('Ошибка замены строки в Google Sheets:', error);
    throw error;
  }
}

async function appendTextReportRow(row) {
  try {
    log('Google Sheets: начинаем запись текстового отчета.', { sheet: REPORTS_SHEET_NAME });
    const sheets = getSheetsClient();
    await ensureTextReportSheet(sheets);
    await writeTextReportToNextFreeLine(sheets, row);
    log('Google Sheets: текстовый отчет успешно записан.', { sheet: REPORTS_SHEET_NAME });
  } catch (error) {
    logError('Ошибка записи текстового отчета в Google Sheets:', error);
    throw error;
  }
}

async function appendAnonymousFeedbackRow(row) {
  try {
    log('Google Sheets: начинаем запись анонимного обращения.', { sheet: ANONYMOUS_FEEDBACK_SHEET_NAME });
    const sheets = getSheetsClient();
    await ensureTextReportSheet(sheets, ANONYMOUS_FEEDBACK_SHEET_NAME);
    await writeTextReportToNextFreeLine(sheets, row, ANONYMOUS_FEEDBACK_SHEET_NAME);
    log('Google Sheets: анонимное обращение успешно записано.', { sheet: ANONYMOUS_FEEDBACK_SHEET_NAME });
  } catch (error) {
    logError('Ошибка записи анонимного обращения в Google Sheets:', error);
    throw error;
  }
}

async function appendKsoReportRow(row) {
  try {
    log('Google Sheets: начинаем запись отписки КСО.', { sheet: KSO_SHEET_NAME });
    const sheets = getSheetsClient();
    await ensureKsoReportSheet(sheets);
    await writeKsoReportToNextFreeLine(sheets, row);
    log('Google Sheets: отписка КСО успешно записана.', { sheet: KSO_SHEET_NAME });
  } catch (error) {
    logError('Ошибка записи отписки КСО в Google Sheets:', error);
    throw error;
  }
}

async function appendTechReportRow(row) {
  try {
    log('Google Sheets: начинаем запись технической неполадки.', { sheet: TECH_REPORTS_SHEET_NAME });
    const sheets = getSheetsClient();
    await ensureTechReportSheet(sheets);
    await writeTechReportToNextFreeLine(sheets, row);
    log('Google Sheets: техническая неполадка успешно записана.', { sheet: TECH_REPORTS_SHEET_NAME });
  } catch (error) {
    logError('Ошибка записи технической неполадки в Google Sheets:', error);
    throw error;
  }
}

async function getBonusSheetRows() {
  if (!BONUS_SHEET_ID) {
    throw new Error('Не задана переменная окружения GOOGLE_BONUS_SHEET_ID или GOOGLE_SHEET_ID');
  }

  const sheets = getSheetsClient();
  const response = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: BONUS_SHEET_ID,
      range: `'${escapeSheetName(BONUS_SHEET_NAME)}'!A:G`,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `чтение листа ${BONUS_SHEET_NAME}`
  );

  return response.data.values || [];
}

const KSO_EMPLOYEES_SHEET_NAME = 'Сотрудники';
const KSO_SCHEDULE_SHEET_NAME = 'График';
const KSO_SHOPS_SHEET_NAME = 'Магазины';
const KSO_ANALYTICS_SHEET_NAME = 'Аналитика';
const KSO_DAILY_SHEET_NAME = 'Ежедневное распределение';
const KSO_DECISION_SETTINGS_SHEET_NAME = 'Нормативы СППР';
const KSO_STORE_COMPLEXITY_SHEET_NAME = 'Сложность магазинов';
const KSO_KPI_SHEET_NAME = 'KPI СППР';
const KSO_EMPLOYEE_HEADERS = ['№', 'ФИО', 'Имя', 'Уровень', 'Коэффициент', 'Гиперов за месяц', 'Статус', 'Приоритет', 'Ограничения'];
const KSO_SCHEDULE_HEADERS = ['№', 'ФИО', ...Array.from({ length: 31 }, (_, index) => String(index + 1)), 'Итого'];
const KSO_SHOP_HEADERS = ['Магазин', 'Категория', 'Приоритет', 'Нужно сотрудников', 'Поток'];
const KSO_HISTORY_HEADERS_PREFIX = ['№', 'ФИО'];
const KSO_DAILY_HEADERS = [
  'Сотрудник',
  'Уровень',
  'Гиперов за месяц',
  'Последний гипер',
  'Дней подряд',
  'Рекомендуемая категория',
  'Назначение'
];
const KSO_ANALYTICS_HEADERS = ['Сотрудник', 'Гиперов', 'Средних', 'Маленьких', 'Баллы', 'Последний гипер'];
const KSO_DECISION_SETTINGS_HEADERS = ['Стаж', 'Норма КСО', 'Норма сторно', 'Норма онлайн', 'Норма персонал', 'Вес КСО', 'Вес сторно', 'Вес онлайн', 'Вес персонал'];
const KSO_STORE_COMPLEXITY_HEADERS = ['Магазин', 'Поток 1-3', 'Кассы 1-3', 'Кражи 1-3', 'Ks', 'Комментарий'];
const KSO_KPI_HEADERS = ['Период', 'ФИО', 'Стаж', 'КСО', 'Сторно', 'Онлайн', 'Персонал', 'Часы', 'Баллы', 'KPI', 'Rs'];
const KSO_DECISION_SETTINGS_DEFAULT_ROWS = [
  KSO_DECISION_SETTINGS_HEADERS,
  ['до 1 мес', 30, 25, 3, 35, 1.169, 1.395, 11.357, 1],
  ['1-3 мес', 30, 25, 3, 35, 1.169, 1.395, 11.357, 1],
  ['3-6 мес', 42, 30, 5, 45, 1.073, 1.507, 8.913, 1],
  ['6+ мес', 58, 45, 8, 56, 1, 1.288, 7.333, 1.035]
];

function getKsoScheduleSheetId() {
  return getReportsSheetId();
}

const KSO_SCHEDULE_MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь'
];

function getKsoScheduleSheetName(isoDate) {
  const year = String(isoDate || '').slice(0, 4);
  const month = Number(String(isoDate || '').slice(5, 7));
  const monthName = KSO_SCHEDULE_MONTH_NAMES[month - 1] || String(isoDate || '').slice(0, 7);
  return `${KSO_SCHEDULE_SHEET_NAME}-${monthName}-${year}`;
}

function shortKsoEmployeeName(fio) {
  return String(fio || '').trim().split(/\s+/)[1] || String(fio || '').trim();
}

function getActiveKsoScheduleEmployees() {
  return listEmployees()
    .filter((employee) => employee.active === 1)
    .map((employee) => {
      const profile = getProfile(employee.user_id);
      const fio = String(profile?.fio || employee.fio || '').trim();

      return {
        id: String(employee.user_id),
        fio,
        name: shortKsoEmployeeName(fio)
      };
    })
    .filter((employee) => employee.fio)
    .sort((left, right) => left.fio.localeCompare(right.fio, 'ru'));
}

function formatKsoDateHeader(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

function getKsoHistoryHeaders(isoDate) {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayHeaders = Array.from({ length: lastDay }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return `${day}.${String(month).padStart(2, '0')}.${year}`;
  });

  return [...KSO_HISTORY_HEADERS_PREFIX, ...dayHeaders, 'Гиперов'];
}

async function getSpreadsheetSheetNames(sheets, spreadsheetId = SHEET_ID) {
  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение списка листов для КСО'
  );

  return spreadsheet.data.sheets.map((sheet) => sheet.properties);
}

async function ensureKsoSheetExists(sheets, spreadsheetId, sheetName, headers = null, minRows = 100, minColumns = 20) {
  const properties = await getSpreadsheetSheetNames(sheets, spreadsheetId);
  const existing = properties.find((item) => item.title === sheetName);

  if (!existing) {
    await withTimeout(
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                  gridProperties: {
                    rowCount: Math.max(minRows, MIN_EXTRA_ROWS),
                    columnCount: Math.max(minColumns, MIN_EXTRA_COLUMNS)
                  }
                }
              }
            }
          ]
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      `создание листа ${sheetName}`
    );
  } else if ((existing.gridProperties?.rowCount || 0) < minRows || (existing.gridProperties?.columnCount || 0) < minColumns) {
    await withTimeout(
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: existing.sheetId,
                  gridProperties: {
                    rowCount: Math.max(existing.gridProperties?.rowCount || 0, minRows + MIN_EXTRA_ROWS),
                    columnCount: Math.max(existing.gridProperties?.columnCount || 0, minColumns + MIN_EXTRA_COLUMNS)
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
      `расширение листа ${sheetName}`
    );
  }

  if (headers) {
    await withTimeout(
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${escapeSheetName(sheetName)}'!A1:${columnNameByIndex(headers.length)}1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers]
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      `обновление заголовков листа ${sheetName}`
    );
  }
}

async function ensureKsoAssignmentSheets(sheets, isoDate, historySheetName) {
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, KSO_EMPLOYEES_SHEET_NAME, KSO_EMPLOYEE_HEADERS, 100, KSO_EMPLOYEE_HEADERS.length);
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, KSO_SHOPS_SHEET_NAME, KSO_SHOP_HEADERS, 100, KSO_SHOP_HEADERS.length);
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, KSO_ANALYTICS_SHEET_NAME, KSO_ANALYTICS_HEADERS, 100, KSO_ANALYTICS_HEADERS.length);
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, KSO_DAILY_SHEET_NAME, KSO_DAILY_HEADERS, 100, KSO_DAILY_HEADERS.length);
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, KSO_DECISION_SETTINGS_SHEET_NAME, KSO_DECISION_SETTINGS_HEADERS, 20, KSO_DECISION_SETTINGS_HEADERS.length);
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, KSO_STORE_COMPLEXITY_SHEET_NAME, KSO_STORE_COMPLEXITY_HEADERS, 100, KSO_STORE_COMPLEXITY_HEADERS.length);
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, KSO_KPI_SHEET_NAME, KSO_KPI_HEADERS, 100, KSO_KPI_HEADERS.length);
  await ensureKsoSheetExists(sheets, KSO_ASSIGNMENT_SHEET_ID, historySheetName, getKsoHistoryHeaders(isoDate), 100, getKsoHistoryHeaders(isoDate).length);
}

async function readKsoScheduleSheetRows(sheets, sheetName) {
  const response = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: getKsoScheduleSheetId(),
      range: `'${escapeSheetName(sheetName)}'!A:AH`,
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `получение листа графика КСО ${sheetName}`
  );

  return response.data.values || [];
}

async function ensureKsoScheduleSheet(sheets, isoDate) {
  const sheetName = getKsoScheduleSheetName(isoDate);
  await ensureKsoSheetExists(sheets, getKsoScheduleSheetId(), sheetName, KSO_SCHEDULE_HEADERS, 100, KSO_SCHEDULE_HEADERS.length);

  const rows = await readKsoScheduleSheetRows(sheets, sheetName);
  const existingFios = new Set(rows.slice(1).map((row) => normalizeKsoFio(row[1])).filter(Boolean));
  const missingEmployees = getActiveKsoScheduleEmployees()
    .filter((employee) => !existingFios.has(normalizeKsoFio(employee.fio)));

  if (missingEmployees.length) {
    const startRow = rows.length + 1;
    const values = missingEmployees.map((employee, index) => {
      const rowNumber = startRow + index;
      return [
        employee.id,
        employee.fio,
        ...Array.from({ length: 31 }, () => ''),
        `=SUM(C${rowNumber}:AG${rowNumber})`
      ];
    });

    await withTimeout(
      sheets.spreadsheets.values.update({
        spreadsheetId: getKsoScheduleSheetId(),
        range: `'${escapeSheetName(sheetName)}'!A${startRow}:${columnNameByIndex(KSO_SCHEDULE_HEADERS.length)}${startRow + values.length - 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values
        }
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS
      }),
      `заполнение сотрудников на листе ${sheetName}`
    );
  }

  return sheetName;
}

async function getKsoAssignmentSheetData(isoDate, historySheetName) {
  if (!KSO_ASSIGNMENT_SHEET_ID) {
    throw new Error('Не задана переменная окружения GOOGLE_KSO_ASSIGNMENT_SHEET_ID');
  }

  const sheets = getSheetsClient();
  await ensureKsoAssignmentSheets(sheets, isoDate, historySheetName);
  await ensureKsoScheduleSheet(sheets, isoDate);

  const ranges = [
    `'${escapeSheetName(KSO_EMPLOYEES_SHEET_NAME)}'!A:Z`,
    `'${escapeSheetName(KSO_SHOPS_SHEET_NAME)}'!A:F`,
    `'${escapeSheetName(historySheetName)}'!A:AJ`,
    `'${escapeSheetName(KSO_ANALYTICS_SHEET_NAME)}'!A:F`,
    `'${escapeSheetName(KSO_STORE_COMPLEXITY_SHEET_NAME)}'!A:F`,
    `'${escapeSheetName(KSO_KPI_SHEET_NAME)}'!A:K`
  ];

  const response = await withTimeout(
    sheets.spreadsheets.values.batchGet({
      spreadsheetId: KSO_ASSIGNMENT_SHEET_ID,
      ranges,
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'batchGet данных распределения КСО'
  );

  const valueRanges = response.data.valueRanges || [];
  const scheduleRows = await getKsoScheduleSheetRows(isoDate);

  return {
    employees: valueRanges[0]?.values || [],
    schedule: scheduleRows,
    shops: valueRanges[1]?.values || [],
    history: valueRanges[2]?.values || [],
    analytics: valueRanges[3]?.values || [],
    storeComplexity: valueRanges[4]?.values || [],
    kpi: valueRanges[5]?.values || [],
    historySheetName
  };
}

async function getKsoScheduleSheetRows(isoDate) {
  const sheets = getSheetsClient();
  const sheetName = await ensureKsoScheduleSheet(sheets, isoDate);
  return readKsoScheduleSheetRows(sheets, sheetName);
}

function normalizeKsoText(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function normalizeKsoFio(value) {
  return normalizeKsoText(value).replace(/\s+/g, ' ');
}

function ksoEmployeeKey(employee) {
  return String(employee.id || '').trim() || normalizeKsoFio(employee.fio);
}

function getKsoDateColumnIndex(isoDate) {
  return Number(isoDate.slice(8, 10)) + 1;
}

function getKsoHistoryTotalColumnIndex(isoDate) {
  return getKsoHistoryHeaders(isoDate).length - 1;
}

function getKsoAssignmentEmployees(result, category = null) {
  const rows = [];
  result.assignments.forEach((assignment) => {
    if (!category || assignment.category === category) {
      assignment.employees.forEach((employee) => rows.push({ employee, assignment }));
    }
  });
  return rows;
}

function getKsoEmployeeRow(existingRows, employee, fallbackIndex) {
  const key = ksoEmployeeKey(employee);
  const found = existingRows.find((row) => {
    const rowKey = String(row.id || '').trim() || normalizeKsoFio(row.fio);
    return rowKey === key || normalizeKsoFio(row.fio) === normalizeKsoFio(employee.fio);
  });

  return found?.rowNumber || fallbackIndex + 2;
}

function buildKsoHistoryUpdates(isoDate, result, data) {
  const historyDateColumn = data.history.targetDateColumn >= 0
    ? data.history.targetDateColumn
    : getKsoDateColumnIndex(isoDate);
  const historyTotalColumn = data.history.hyperTotalColumn >= 0
    ? data.history.hyperTotalColumn
    : getKsoHistoryTotalColumnIndex(isoDate);
  const hyperEmployees = getKsoAssignmentEmployees(result, 'hyper').map((item) => item.employee);
  const employeesToUpdate = Array.isArray(result.available) && result.available.length ? result.available : data.employees;
  const updates = [];

  employeesToUpdate.forEach((employee) => {
    const fallbackIndex = Math.max(0, data.employees.findIndex((item) => ksoEmployeeKey(item) === ksoEmployeeKey(employee)));
    const rowNumber = getKsoEmployeeRow(data.history.rows, employee, fallbackIndex);
    const isHyper = hyperEmployees.some((item) => ksoEmployeeKey(item) === ksoEmployeeKey(employee));
    const previous = data.history.rows.find((row) => row.rowNumber === rowNumber);
    const nextTotal = Number(previous?.hyperCount || employee.hyperCount || 0) + (isHyper ? 1 : 0);

    updates.push({
      range: `'${escapeSheetName(data.historySheetName)}'!A${rowNumber}:B${rowNumber}`,
      values: [[employee.id || '', employee.fio || '']]
    });

    updates.push({
      range: `'${escapeSheetName(data.historySheetName)}'!${columnNameByIndex(historyDateColumn + 1)}${rowNumber}:${columnNameByIndex(historyDateColumn + 1)}${rowNumber}`,
      values: [[isHyper ? 1 : '']]
    });

    updates.push({
      range: `'${escapeSheetName(data.historySheetName)}'!${columnNameByIndex(historyTotalColumn + 1)}${rowNumber}:${columnNameByIndex(historyTotalColumn + 1)}${rowNumber}`,
      values: [[nextTotal]]
    });
  });

  return updates;
}

function buildKsoEmployeeCounterUpdates(result) {
  return getKsoAssignmentEmployees(result, 'hyper')
    .filter((item) => item.employee.rowNumber)
    .map((item) => ({
      range: `'${escapeSheetName(KSO_EMPLOYEES_SHEET_NAME)}'!F${item.employee.rowNumber}:F${item.employee.rowNumber}`,
      values: [[Number(item.employee.monthHyperCount || item.employee.hyperCount || 0) + 1]]
    }));
}

function buildKsoAnalyticsRows(result) {
  const totals = new Map();

  result.available.forEach((employee) => {
    totals.set(ksoEmployeeKey(employee), {
      employee,
      hyper: Number(employee.monthHyperCount || 0),
      medium: Number(employee.mediumCount || 0),
      small: Number(employee.smallCount || 0),
      points: Number(employee.points || 0),
      lastHyper: employee.lastHyper || ''
    });
  });

  result.assignments.forEach((assignment) => {
    assignment.employees.forEach((employee) => {
      const total = totals.get(ksoEmployeeKey(employee));
      if (!total) {
        return;
      }

      if (assignment.category === 'hyper') {
        total.hyper += 1;
        total.lastHyper = formatKsoDateHeader(result.isoDate);
        total.points += 5;
      } else if (assignment.category === 'medium') {
        total.medium += 1;
        total.points += 3;
      } else {
        total.small += 1;
        total.points += 1;
      }
    });
  });

  return [
    KSO_ANALYTICS_HEADERS,
    ...[...totals.values()].map((total) => [
      total.employee.fio,
      total.hyper,
      total.medium,
      total.small,
      total.points,
      total.lastHyper
    ])
  ];
}

async function writeKsoAssignmentResult(isoDate, result, data) {
  const sheets = getSheetsClient();
  const dailyValues = [
    [`Дата`, formatKsoDateHeader(isoDate), '', '', '', '', ''],
    [`Всего сотрудников`, result.available.length, '', '', '', '', ''],
    KSO_DAILY_HEADERS,
    ...result.dailyRows
  ];
  const analyticsRows = buildKsoAnalyticsRows(result);
  const updates = [
    {
      range: `'${escapeSheetName(KSO_DAILY_SHEET_NAME)}'!A1:G${dailyValues.length}`,
      values: dailyValues
    },
    {
      range: `'${escapeSheetName(KSO_ANALYTICS_SHEET_NAME)}'!A1:F${analyticsRows.length}`,
      values: analyticsRows
    },
    ...buildKsoHistoryUpdates(isoDate, result, data),
    ...buildKsoEmployeeCounterUpdates(result)
  ];

  await withTimeout(
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: KSO_ASSIGNMENT_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'batchUpdate результата распределения КСО'
  );
}

async function writeKsoManualAssignment(isoDate, employee, shop, data) {
  const category = normalizeKsoText(shop.category).includes('гипер')
    ? 'hyper'
    : normalizeKsoText(shop.category).includes('сред') ? 'medium' : 'small';
  const sheets = getSheetsClient();
  const dailyRow = [
    employee.fio,
    employee.level,
    employee.hyperCount || 0,
    '',
    '',
    shop.category,
    shop.code
  ];
  const updates = [
    {
      range: `'${escapeSheetName(KSO_DAILY_SHEET_NAME)}'!A4:G4`,
      values: [dailyRow]
    }
  ];

  if (category === 'hyper') {
    const result = {
      isoDate,
      available: [employee],
      assignments: [{ shop, category, employees: [employee] }],
      dailyRows: [dailyRow]
    };
    updates.push(...buildKsoHistoryUpdates(isoDate, result, data));
    if (employee.rowNumber) {
      updates.push({
        range: `'${escapeSheetName(KSO_EMPLOYEES_SHEET_NAME)}'!F${employee.rowNumber}:F${employee.rowNumber}`,
        values: [[Number(employee.hyperCount || 0) + 1]]
      });
    }
  }

  await withTimeout(
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: KSO_ASSIGNMENT_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'batchUpdate ручного назначения КСО'
  );

}

function findKsoScheduleRow(scheduleRows, profile) {
  const fio = normalizeKsoFio(profile?.fio);
  return scheduleRows.find((row) => normalizeKsoFio(row[1]) === fio);
}

function getKsoScheduleDateColumn(isoDate, headers) {
  const day = Number(isoDate.slice(8, 10));
  const directIndex = headers.findIndex((header) => Number(header) === day);
  return directIndex >= 0 ? directIndex : day + 1;
}

function getKsoScheduleTotalColumn(headers) {
  const index = headers.findIndex((header) => normalizeKsoText(header) === normalizeKsoText('Итого'));
  return index >= 0 ? index : KSO_SCHEDULE_HEADERS.length - 1;
}

async function writeKsoScheduleStatus(profile, isoDate, status, historySheetName) {
  if (!profile?.fio) {
    throw new Error('Не заполнен профиль сотрудника');
  }

  const sheets = getSheetsClient();
  const sheetName = await ensureKsoScheduleSheet(sheets, isoDate);
  const scheduleRows = await getKsoScheduleSheetRows(isoDate);
  const headers = scheduleRows[0] || [];
  const row = findKsoScheduleRow(scheduleRows.slice(1), profile);

  if (!row) {
    throw new Error(`Сотрудник ${profile.fio} не найден на листе ${sheetName}`);
  }

  const rowNumber = scheduleRows.slice(1).indexOf(row) + 2;
  const columnIndex = getKsoScheduleDateColumn(isoDate, headers);
  const columnName = columnNameByIndex(columnIndex + 1);
  const totalColumnName = columnNameByIndex(getKsoScheduleTotalColumn(headers) + 1);
  const cellValue = normalizeKsoText(status) === normalizeKsoText('Р') ? 10 : '';
  await withTimeout(
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getKsoScheduleSheetId(),
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `'${escapeSheetName(sheetName)}'!${columnName}${rowNumber}:${columnName}${rowNumber}`,
            values: [[cellValue]]
          },
          {
            range: `'${escapeSheetName(sheetName)}'!${totalColumnName}${rowNumber}:${totalColumnName}${rowNumber}`,
            values: [[`=SUM(C${rowNumber}:AG${rowNumber})`]]
          }
        ]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'batchUpdate статуса графика КСО'
  );
}

async function writeKsoScheduleMonthHours(profile, isoDateHours, historySheetName) {
  if (!profile?.fio) {
    throw new Error('Не заполнен профиль сотрудника');
  }

  if (!Array.isArray(isoDateHours) || isoDateHours.length === 0) {
    throw new Error('Не переданы дни графика');
  }

  const sheets = getSheetsClient();
  const sheetName = await ensureKsoScheduleSheet(sheets, isoDateHours[0].isoDate);
  const scheduleRows = await getKsoScheduleSheetRows(isoDateHours[0].isoDate);
  const headers = scheduleRows[0] || [];
  const row = findKsoScheduleRow(scheduleRows.slice(1), profile);

  if (!row) {
    throw new Error(`Сотрудник ${profile.fio} не найден на листе ${sheetName}`);
  }

  const rowNumber = scheduleRows.slice(1).indexOf(row) + 2;
  const updates = isoDateHours.map((item) => {
    const columnIndex = getKsoScheduleDateColumn(item.isoDate, headers);
    const columnName = columnNameByIndex(columnIndex + 1);
    return {
      range: `'${escapeSheetName(sheetName)}'!${columnName}${rowNumber}:${columnName}${rowNumber}`,
      values: [[item.hours || '']]
    };
  });
  const totalColumnName = columnNameByIndex(getKsoScheduleTotalColumn(headers) + 1);
  updates.push({
    range: `'${escapeSheetName(sheetName)}'!${totalColumnName}${rowNumber}:${totalColumnName}${rowNumber}`,
    values: [[`=SUM(C${rowNumber}:AG${rowNumber})`]]
  });

  await withTimeout(
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getKsoScheduleSheetId(),
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'batchUpdate месячного графика КСО'
  );
}

function buildKsoScheduleRows(employees) {
  return [
    KSO_SCHEDULE_HEADERS,
    ...employees.map((employee, index) => {
      const rowNumber = index + 2;
      return [
        employee.id,
        employee.fio,
        ...Array.from({ length: 31 }, () => ''),
        `=SUM(C${rowNumber}:AG${rowNumber})`
      ];
    })
  ];
}

function buildKsoHistoryRows(isoDate, employees) {
  const headers = getKsoHistoryHeaders(isoDate);
  const emptyDays = Array.from({ length: headers.length - KSO_HISTORY_HEADERS_PREFIX.length - 1 }, () => '');

  return [
    headers,
    ...employees.map((employee) => [
      employee.id,
      employee.fio,
      ...emptyDays,
      0
    ])
  ];
}

function buildKsoAnalyticsInitRows(employees) {
  return [
    KSO_ANALYTICS_HEADERS,
    ...employees.map((employee) => [
      employee.fio,
      0,
      0,
      0,
      0,
      ''
    ])
  ];
}

function buildKsoEmployeeRows(employees) {
  return [
    KSO_EMPLOYEE_HEADERS,
    ...employees.map((employee) => [
      employee.id,
      employee.fio,
      employee.name,
      'Стандарт',
      1,
      0,
      '',
      '',
      ''
    ])
  ];
}

function buildKsoShopRows(shops) {
  return [
    KSO_SHOP_HEADERS,
    ...shops.map((shop) => [
      shop.code,
      shop.category || 'Средний',
      shop.priority || 3,
      shop.required || 1,
      shop.flow || shop.region || ''
    ])
  ];
}

function buildKsoStoreComplexityRows(shops) {
  return [
    KSO_STORE_COMPLEXITY_HEADERS,
    ...shops.map((shop, index) => {
      const rowNumber = index + 2;
      return [
        shop.code,
        '',
        '',
        '',
        `=IFERROR(ROUND(B${rowNumber}*0.4+C${rowNumber}*0.3+D${rowNumber}*0.3,2),"")`,
        ''
      ];
    })
  ];
}

async function initializeKsoAssignmentSheet(isoDate, employees, shops, historySheetName) {
  if (!KSO_ASSIGNMENT_SHEET_ID) {
    throw new Error('Не задана переменная окружения GOOGLE_KSO_ASSIGNMENT_SHEET_ID');
  }

  const sheets = getSheetsClient();
  await ensureKsoAssignmentSheets(sheets, isoDate, historySheetName);
  const scheduleSheetName = await ensureKsoScheduleSheet(sheets, isoDate);

  const employeeRows = buildKsoEmployeeRows(employees);
  const scheduleRows = buildKsoScheduleRows(employees);
  const shopRows = buildKsoShopRows(shops);
  const storeComplexityRows = buildKsoStoreComplexityRows(shops);
  const analyticsRows = buildKsoAnalyticsInitRows(employees);
  const dailyRows = [KSO_DAILY_HEADERS];
  const kpiRows = [KSO_KPI_HEADERS];

  await withTimeout(
    sheets.spreadsheets.values.batchClear({
      spreadsheetId: KSO_ASSIGNMENT_SHEET_ID,
      requestBody: {
        ranges: [
          `'${escapeSheetName(KSO_EMPLOYEES_SHEET_NAME)}'!A:Z`,
          `'${escapeSheetName(KSO_SHOPS_SHEET_NAME)}'!A:F`,
          `'${escapeSheetName(KSO_ANALYTICS_SHEET_NAME)}'!A:F`,
          `'${escapeSheetName(KSO_DAILY_SHEET_NAME)}'!A:G`,
          `'${escapeSheetName(KSO_DECISION_SETTINGS_SHEET_NAME)}'!A:I`,
          `'${escapeSheetName(KSO_STORE_COMPLEXITY_SHEET_NAME)}'!A:F`,
          `'${escapeSheetName(KSO_KPI_SHEET_NAME)}'!A:K`
        ]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка листов инициализации КСО'
  );

  await withTimeout(
    sheets.spreadsheets.values.clear({
      spreadsheetId: getKsoScheduleSheetId(),
      range: `'${escapeSheetName(scheduleSheetName)}'!A:AH`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка листа графика КСО'
  );

  await withTimeout(
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: KSO_ASSIGNMENT_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `'${escapeSheetName(KSO_EMPLOYEES_SHEET_NAME)}'!A1:${columnNameByIndex(KSO_EMPLOYEE_HEADERS.length)}${employeeRows.length}`,
            values: employeeRows
          },
          {
            range: `'${escapeSheetName(KSO_SHOPS_SHEET_NAME)}'!A1:${columnNameByIndex(KSO_SHOP_HEADERS.length)}${shopRows.length}`,
            values: shopRows
          },
          {
            range: `'${escapeSheetName(KSO_ANALYTICS_SHEET_NAME)}'!A1:F${analyticsRows.length}`,
            values: analyticsRows
          },
          {
            range: `'${escapeSheetName(KSO_DAILY_SHEET_NAME)}'!A1:G1`,
            values: dailyRows
          },
          {
            range: `'${escapeSheetName(KSO_DECISION_SETTINGS_SHEET_NAME)}'!A1:I${KSO_DECISION_SETTINGS_DEFAULT_ROWS.length}`,
            values: KSO_DECISION_SETTINGS_DEFAULT_ROWS
          },
          {
            range: `'${escapeSheetName(KSO_STORE_COMPLEXITY_SHEET_NAME)}'!A1:F${storeComplexityRows.length}`,
            values: storeComplexityRows
          },
          {
            range: `'${escapeSheetName(KSO_KPI_SHEET_NAME)}'!A1:K1`,
            values: kpiRows
          }
        ]
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'batchUpdate инициализации КСО'
  );

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: getKsoScheduleSheetId(),
      range: `'${escapeSheetName(scheduleSheetName)}'!A1:${columnNameByIndex(KSO_SCHEDULE_HEADERS.length)}${scheduleRows.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: scheduleRows
      }
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'запись первичного графика КСО'
  );

  return {
    employeesCount: employees.length,
    shopsCount: shops.length,
    spreadsheetId: KSO_ASSIGNMENT_SHEET_ID
  };
}

module.exports = {
  appendRow,
  appendOnlineTheftRow,
  replaceFixationRows,
  appendTextReportRow,
  appendAnonymousFeedbackRow,
  appendKsoReportRow,
  appendTechReportRow,
  getBonusSheetRows,
  getKsoAssignmentSheetData,
  getKsoScheduleSheetRows,
  initializeKsoAssignmentSheet,
  writeKsoAssignmentResult,
  writeKsoManualAssignment,
  writeKsoScheduleMonthHours,
  writeKsoScheduleStatus
};
