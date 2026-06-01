const { google } = require('googleapis');
const { MAX_PHOTOS_PER_RECORD } = require('./constants');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const REPORTS_SHEET_ID = process.env.GOOGLE_REPORTS_SHEET_ID || process.env.GOOGLE_REPORT_SHEET_ID || '';
const TECH_REPORTS_SHEET_ID = process.env.GOOGLE_TECH_REPORTS_SHEET_ID || '';
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials/service-account.json';
const DATA_SHEET_NAME = 'Данные';
const REPORTS_SHEET_NAME = process.env.GOOGLE_REPORTS_SHEET_NAME || 'Отчеты';
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
const REPORT_HEADERS = ['ФИО', 'Дата', 'Отчет'];
const KSO_HEADERS = ['ФИО', 'Дата', 'Отписка КСО'];
const TECH_REPORT_HEADERS = ['ФИО', 'Дата', 'Техническая неполадка'];
const HEADER_END_COLUMN = columnNameByIndex(HEADERS.length);
const DATA_RANGE = `A:${HEADER_END_COLUMN}`;
const HEADER_RANGE = `A1:${HEADER_END_COLUMN}1`;
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

async function ensureTextReportSheet(sheets) {
  const spreadsheetId = getReportsSheetId();
  log('Google Sheets: проверяем лист текстовых отчетов.', { sheet: REPORTS_SHEET_NAME });

  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'получение метаданных таблицы отчетов'
  );

  const existingSheet = spreadsheet.data.sheets.find((sheet) => {
    return sheet.properties && sheet.properties.title === REPORTS_SHEET_NAME;
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
                  title: REPORTS_SHEET_NAME
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

  await ensureTextReportGridSize(sheets, 1, REPORT_HEADERS.length);

  const headerResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapeSheetName(REPORTS_SHEET_NAME)}'!${REPORT_HEADER_RANGE}`
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
      range: `'${escapeSheetName(REPORTS_SHEET_NAME)}'!${REPORT_HEADER_RANGE}`
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    'очистка старой строки заголовков листа текстовых отчетов'
  );

  await withTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${escapeSheetName(REPORTS_SHEET_NAME)}'!${REPORT_HEADER_RANGE}`,
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

async function getTextReportSheetProperties(sheets) {
  const spreadsheetId = getReportsSheetId();
  const spreadsheet = await withTimeout(
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `получение свойств листа ${REPORTS_SHEET_NAME}`
  );

  const sheet = spreadsheet.data.sheets.find((item) => {
    return item.properties && item.properties.title === REPORTS_SHEET_NAME;
  });

  if (!sheet?.properties) {
    throw new Error(`Лист ${REPORTS_SHEET_NAME} не найден`);
  }

  return sheet.properties;
}

async function ensureTextReportGridSize(sheets, minRows, minColumns = REPORT_HEADERS.length) {
  const spreadsheetId = getReportsSheetId();
  const properties = await getTextReportSheetProperties(sheets);
  const rowCount = properties.gridProperties?.rowCount || 0;
  const columnCount = properties.gridProperties?.columnCount || 0;

  if (rowCount >= minRows && columnCount >= minColumns) {
    return;
  }

  const targetRows = rowCount >= minRows ? rowCount : minRows + MIN_EXTRA_ROWS;
  const targetColumns = columnCount >= minColumns ? columnCount : minColumns + MIN_EXTRA_COLUMNS;
  log('Google Sheets: расширяем лист отчетов перед записью.', {
    sheetName: REPORTS_SHEET_NAME,
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

async function writeTextReportToNextFreeLine(sheets, row) {
  const spreadsheetId = getReportsSheetId();
  const escapedSheetName = escapeSheetName(REPORTS_SHEET_NAME);
  const valuesResponse = await withTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapedSheetName}'!${REPORT_DATA_RANGE}`,
      majorDimension: 'ROWS'
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS
    }),
    `поиск свободной строки на листе ${REPORTS_SHEET_NAME}`
  );

  const nextRow = findNextDataRow(valuesResponse.data.values);
  await ensureTextReportGridSize(sheets, nextRow, REPORT_HEADERS.length);
  log('Google Sheets: записываем текстовый отчет в явный диапазон.', {
    sheetName: REPORTS_SHEET_NAME,
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
    `запись строки ${nextRow} на лист ${REPORTS_SHEET_NAME}`
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

module.exports = { appendRow, replaceFixationRows, appendTextReportRow, appendKsoReportRow, appendTechReportRow };
