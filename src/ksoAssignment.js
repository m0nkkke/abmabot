const { log, logError } = require('./logger');
const {
  getProfile,
  listCatalogShops,
  listEmployees
} = require('./db');
const {
  getKsoAssignmentSheetData,
  initializeKsoAssignmentSheet,
  writeKsoAssignmentResult,
  writeKsoManualAssignment,
  writeKsoScheduleMonthHours,
  writeKsoScheduleStatus
} = require('./sheets');
const {
  calculateAssignmentPriority,
  calculateStoreComplexity
} = require('./services/ksoDecisionService');

const GOOGLE_SHEETS_ERROR_TEXT = 'Не удалось получить данные из таблицы. Попробуйте позже.';
const CACHE_TTL_MS = 10 * 60 * 1000;

const MONTH_NAMES = [
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

const LEVEL_COEFFICIENTS = {
  'сильный': 0.6,
  'стандарт': 1,
  'новичок': 1.2,
  'ограниченный': 1.5
};

const DECISION_LEVEL_COEFFICIENTS = {
  'сильн': 0.9,
  'стандарт': 1,
  'нов': 1.1,
  'огранич': 0.1
};

const CATEGORY_LABELS = {
  hyper: 'Гипер',
  medium: 'Средний',
  small: 'Маленький'
};

let dictionaryCache = {
  expiresAt: 0,
  employees: null,
  shops: null
};

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-zа-я0-9]/g, '');
}

function normalizeFio(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function getCell(row, columns, aliases, fallbackIndex = -1) {
  for (const alias of aliases) {
    const index = columns[normalizeHeader(alias)];
    if (index !== undefined) {
      return row[index] ?? '';
    }
  }

  return fallbackIndex >= 0 ? row[fallbackIndex] ?? '' : '';
}

function buildColumnMap(headers) {
  return (headers || []).reduce((columns, header, index) => {
    const key = normalizeHeader(header);
    if (key) {
      columns[key] = index;
    }
    return columns;
  }, {});
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInputDate(value, now = new Date()) {
  const text = String(value || '').trim();
  const match = /^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/.exec(text);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3] || now.getFullYear());
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return formatIsoDate(date);
}

function todayIso(now = new Date()) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, '0'),
    String(local.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function isPastDate(isoDate, now = new Date()) {
  return isoDate < todayIso(now);
}

function formatIsoDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function parseGoogleDate(value, year) {
  if (value instanceof Date) {
    return formatIsoDate(new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())));
  }

  if (typeof value === 'number') {
    const base = Date.UTC(1899, 11, 30);
    return formatIsoDate(new Date(base + value * 24 * 60 * 60 * 1000));
  }

  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const ru = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(text);
  if (ru) {
    const day = Number(ru[1]);
    const month = Number(ru[2]);
    let parsedYear = year;
    if (ru[3]) {
      parsedYear = Number(ru[3].length === 2 ? `20${ru[3]}` : ru[3]);
    }
    return formatIsoDate(new Date(Date.UTC(parsedYear, month - 1, day)));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return formatIsoDate(new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())));
  }

  return '';
}

function formatDisplayDate(isoDate) {
  const [, month, day] = isoDate.split('-');
  return `${day}.${month}`;
}

function historySheetName(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return `История ${MONTH_NAMES[date.getUTCMonth()]}`;
}

function parseEmployees(rows) {
  const [headers = [], ...dataRows] = rows || [];
  const columns = buildColumnMap(headers);

  return dataRows
    .map((row, index) => {
      const level = String(getCell(row, columns, ['Уровень'], 3) || 'Стандарт').trim() || 'Стандарт';
      return {
        rowNumber: index + 2,
        id: String(getCell(row, columns, ['№', 'ID сотрудника', 'ID'], 0) || '').trim(),
        fio: String(getCell(row, columns, ['ФИО', 'Имя'], 1) || '').trim(),
        level,
        coefficient: numberValue(
          getCell(row, columns, ['Коэффициент'], 4),
          LEVEL_COEFFICIENTS[normalizeText(level)] || 1
        ),
        hyperCount: numberValue(getCell(row, columns, ['Гиперов за месяц', 'Гиперов'], 5)),
        status: String(getCell(row, columns, ['Статус'], 6) || '').trim(),
        manualPriority: numberValue(getCell(row, columns, ['Приоритет'], 7)),
        restrictions: String(getCell(row, columns, ['Ограничения'], 8) || '').trim()
      };
    })
    .filter((employee) => employee.id || employee.fio);
}

function parseShops(rows) {
  const [headers = [], ...dataRows] = rows || [];
  const columns = buildColumnMap(headers);

  return dataRows
    .map((row) => {
      const category = String(getCell(row, columns, ['Категория'], 1) || '').trim();
      return {
        code: String(getCell(row, columns, ['Магазин', 'Код'], 0) || '').trim(),
        category,
        priority: numberValue(getCell(row, columns, ['Приоритет'], 2), defaultShopPriority(category)),
        required: numberValue(getCell(row, columns, ['Нужно сотрудников', 'Нужно'], 3), defaultRequired(category)),
        flow: String(getCell(row, columns, ['Поток'], 4) || '').trim()
      };
    })
    .filter((shop) => shop.code && shop.category)
    .sort((left, right) => right.priority - left.priority || left.code.localeCompare(right.code, 'ru'));
}

function defaultShopPriority(category) {
  const normalized = normalizeText(category);
  if (normalized.includes('гипер')) {
    return 5;
  }
  if (normalized.includes('сред')) {
    return 3;
  }
  return 1;
}

function defaultRequired(category) {
  const normalized = normalizeText(category);
  if (normalized.includes('гипер')) {
    return 3;
  }
  if (normalized.includes('мал')) {
    return 0.5;
  }
  return 1;
}

function parseSchedule(rows, isoDate) {
  const [headers = [], ...dataRows] = rows || [];
  const targetDay = Number(isoDate.slice(8, 10));
  const dateIndex = headers.findIndex((header) => {
    if (Number(header) === targetDay) {
      return true;
    }
    return parseGoogleDate(header, Number(isoDate.slice(0, 4))) === isoDate;
  });
  const columns = buildColumnMap(headers);

  return {
    dateColumnIndex: dateIndex,
    rows: dataRows.map((row, index) => ({
      rowNumber: index + 2,
      id: String(getCell(row, columns, ['№', 'ID сотрудника', 'ID'], 0) || '').trim(),
      fio: String(getCell(row, columns, ['ФИО', 'Имя'], 1) || '').trim(),
      status: dateIndex >= 0 ? String(row[dateIndex] || '').trim() : ''
    }))
  };
}

function parseHistory(rows, isoDate) {
  const [headers = [], ...dataRows] = rows || [];
  const year = Number(isoDate.slice(0, 4));
  const dateColumns = headers
    .map((header, index) => ({ index, isoDate: parseGoogleDate(header, year) }))
    .filter((item) => item.isoDate);
  const targetDateColumn = dateColumns.find((item) => item.isoDate === isoDate)?.index ?? -1;
  const columns = buildColumnMap(headers);
  const hyperTotalColumn = columns[normalizeHeader('Гиперов')] ?? -1;

  return {
    headers,
    targetDateColumn,
    hyperTotalColumn,
    rows: dataRows.map((row, index) => {
      const employeeHistory = dateColumns
        .map((dateColumn) => ({
          isoDate: dateColumn.isoDate,
          value: numberValue(row[dateColumn.index])
        }))
        .filter((item) => item.value > 0);

      return {
        rowNumber: index + 2,
        id: String(getCell(row, columns, ['№', 'ID сотрудника', 'ID'], 0) || '').trim(),
        fio: String(getCell(row, columns, ['ФИО', 'Имя', 'Сотрудник'], 1) || '').trim(),
        hyperCount: hyperTotalColumn >= 0 ? numberValue(row[hyperTotalColumn]) : employeeHistory.length,
        dates: employeeHistory
      };
    })
  };
}

function parseAnalytics(rows) {
  const [headers = [], ...dataRows] = rows || [];
  const columns = buildColumnMap(headers);

  return dataRows
    .map((row) => ({
      fio: String(getCell(row, columns, ['Сотрудник', 'ФИО'], 0) || '').trim(),
      hyperCount: numberValue(getCell(row, columns, ['Гиперов'], 1)),
      mediumCount: numberValue(getCell(row, columns, ['Средних'], 2)),
      smallCount: numberValue(getCell(row, columns, ['Маленьких'], 3)),
      points: numberValue(getCell(row, columns, ['Баллы'], 4)),
      lastHyper: String(getCell(row, columns, ['Последний гипер'], 5) || '').trim()
    }))
    .filter((item) => item.fio);
}

function parseStoreComplexity(rows) {
  const [headers = [], ...dataRows] = rows || [];
  const columns = buildColumnMap(headers);
  const byCode = new Map();

  dataRows.forEach((row) => {
    const code = String(getCell(row, columns, ['Магазин', 'Код'], 0) || '').trim();
    if (!code) {
      return;
    }

    const flow = numberValue(getCell(row, columns, ['Поток 1-3', 'Поток'], 1), 0);
    const cashRegisters = numberValue(getCell(row, columns, ['Кассы 1-3', 'Кассы'], 2), 0);
    const thefts = numberValue(getCell(row, columns, ['Кражи 1-3', 'Кражи'], 3), 0);
    const explicitKs = numberValue(getCell(row, columns, ['Ks', 'Сложность'], 4), 0);
    const ks = explicitKs || (flow && cashRegisters && thefts
      ? calculateStoreComplexity({ flow, cashRegisters, thefts })
      : 0);

    byCode.set(normalizeText(code), {
      code,
      flow,
      cashRegisters,
      thefts,
      ks
    });
  });

  return byCode;
}

function parseDecisionKpi(rows) {
  const [headers = [], ...dataRows] = rows || [];
  const columns = buildColumnMap(headers);
  const byFio = new Map();

  dataRows.forEach((row) => {
    const fio = String(getCell(row, columns, ['ФИО', 'Сотрудник'], 1) || '').trim();
    if (!fio) {
      return;
    }

    const rs = numberValue(getCell(row, columns, ['Rs', 'Рейтинг'], 10), 0)
      || numberValue(getCell(row, columns, ['KPI', 'КПИ'], 9), 0)
      || 1;
    const points = numberValue(getCell(row, columns, ['Баллы'], 8), 0);

    byFio.set(normalizeFio(fio), {
      fio,
      period: String(getCell(row, columns, ['Период'], 0) || '').trim(),
      points,
      rs
    });
  });

  return byFio;
}

function mergeDictionaries(sheetData, isoDate) {
  const now = Date.now();
  const parsedEmployees = parseEmployees(sheetData.employees);
  const parsedShops = parseShops(sheetData.shops);

  dictionaryCache = {
    expiresAt: now + CACHE_TTL_MS,
    employees: parsedEmployees,
    shops: parsedShops
  };

  return {
    employees: parsedEmployees,
    shops: parsedShops,
    schedule: parseSchedule(sheetData.schedule, isoDate),
    rawSchedule: sheetData.schedule,
    history: parseHistory(sheetData.history, isoDate),
    analytics: parseAnalytics(sheetData.analytics),
    storeComplexity: parseStoreComplexity(sheetData.storeComplexity),
    decisionKpi: parseDecisionKpi(sheetData.kpi),
    historySheetName: sheetData.historySheetName
  };
}

function getDictionaries(sheetData, isoDate) {
  if (dictionaryCache.expiresAt > Date.now() && dictionaryCache.employees && dictionaryCache.shops) {
    return {
      employees: dictionaryCache.employees,
      shops: dictionaryCache.shops,
      schedule: parseSchedule(sheetData.schedule, isoDate),
      rawSchedule: sheetData.schedule,
      history: parseHistory(sheetData.history, isoDate),
      analytics: parseAnalytics(sheetData.analytics),
      storeComplexity: parseStoreComplexity(sheetData.storeComplexity),
      decisionKpi: parseDecisionKpi(sheetData.kpi),
      historySheetName: sheetData.historySheetName
    };
  }

  return mergeDictionaries(sheetData, isoDate);
}

function employeeKey(employee) {
  return employee.id || normalizeFio(employee.fio);
}

function buildAvailableEmployees(data) {
  const scheduleByKey = new Map();
  data.schedule.rows.forEach((row) => {
    scheduleByKey.set(row.id || normalizeFio(row.fio), row);
  });

  const historyByKey = new Map();
  data.history.rows.forEach((row) => {
    historyByKey.set(row.id || normalizeFio(row.fio), row);
  });

  const analyticsByFio = new Map(data.analytics.map((row) => [normalizeFio(row.fio), row]));

  return data.employees
    .map((employee) => {
      const scheduleRow = scheduleByKey.get(employeeKey(employee)) || scheduleByKey.get(normalizeFio(employee.fio));
      const historyRow = historyByKey.get(employeeKey(employee)) || historyByKey.get(normalizeFio(employee.fio));
      const analyticsRow = analyticsByFio.get(normalizeFio(employee.fio));
      const status = normalizeText(scheduleRow?.status || employee.status);
      const scheduledHours = numberValue(scheduleRow?.status, 0);
      const lastHyper = getLastHyperDate(historyRow?.dates || [], analyticsRow?.lastHyper);
      const daysInRow = countHyperDaysInRow(historyRow?.dates || [], isoDateFromParts(lastHyper));

      return {
        ...employee,
        scheduleRowNumber: scheduleRow?.rowNumber || null,
        scheduleStatus: scheduleRow?.status || employee.status,
        historyRowNumber: historyRow?.rowNumber || null,
        monthHyperCount: historyRow?.hyperCount ?? employee.hyperCount,
        mediumCount: analyticsRow?.mediumCount || 0,
        smallCount: analyticsRow?.smallCount || 0,
        points: analyticsRow?.points || 0,
        lastHyper,
        daysInRow,
        scheduledHours,
        isWorking: scheduledHours > 0 || status === 'р' || status === 'работает' || status === 'рабочий'
      };
    })
    .filter((employee) => employee.isWorking);
}

function getLastHyperDate(historyDates, analyticsLastHyper) {
  const fromHistory = [...historyDates]
    .sort((left, right) => right.isoDate.localeCompare(left.isoDate))[0]?.isoDate;
  if (fromHistory) {
    return fromHistory;
  }

  return parseGoogleDate(analyticsLastHyper, new Date().getFullYear()) || '';
}

function isoDateFromParts(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
}

function countHyperDaysInRow(historyDates, lastHyper) {
  if (!lastHyper) {
    return 0;
  }

  const hyperDates = new Set(historyDates.map((item) => item.isoDate));
  let cursor = new Date(`${lastHyper}T00:00:00Z`);
  let count = 0;

  while (hyperDates.has(formatIsoDate(cursor))) {
    count += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return count;
}

function hasExtraTasks(employee) {
  return normalizeText(employee.restrictions).includes('доп. задачи')
    || normalizeText(employee.restrictions).includes('доп задачи');
}

function isRestricted(employee) {
  return normalizeText(employee.level).includes('огранич');
}

function scoreEmployee(employee, category) {
  const fairness = employee.monthHyperCount * 10;
  const recency = employee.daysInRow >= 3 ? 25 : employee.daysInRow * 5;
  const categoryLoad = category === 'hyper' ? employee.mediumCount + employee.smallCount * 0.5 : employee.monthHyperCount * -1;
  const manualBoost = employee.manualPriority * -1;
  return (fairness + recency + categoryLoad + manualBoost) * employee.coefficient + employee.points * 0.1;
}

function getShopCategory(shop) {
  const normalized = normalizeText(shop.category);
  if (normalized.includes('гипер')) {
    return 'hyper';
  }
  if (normalized.includes('сред')) {
    return 'medium';
  }
  return 'small';
}

function requiredSlots(shop) {
  const category = getShopCategory(shop);
  if (category === 'small' && shop.required > 0 && shop.required < 1) {
    return 1;
  }

  return Math.max(0, Math.ceil(shop.required));
}

function assignEmployees(data, isoDate) {
  const warnings = [];
  const available = buildAvailableEmployees(data);

  if (!available.length) {
    return {
      isoDate,
      available,
      assignments: [],
      reserve: [],
      warnings: ['На выбранную дату никто не отмечен как работающий.'],
      dailyRows: []
    };
  }

  const eligible = available.filter((employee) => {
    if (!hasExtraTasks(employee)) {
      return true;
    }
    warnings.push(`${employee.fio} — Доп. Задачи, не поставлен на мониторинг.`);
    return false;
  });
  const assignedKeys = new Set();
  const assignments = [];

  for (const category of ['hyper', 'medium', 'small']) {
    const shops = data.shops.filter((shop) => getShopCategory(shop) === category);

    for (const shop of shops) {
      const slots = requiredSlots(shop);
      if (slots <= 0) {
        continue;
      }

      const selected = [];
      for (let slot = 0; slot < slots; slot += 1) {
        let candidates = eligible.filter((employee) => !assignedKeys.has(employeeKey(employee)));

        if (category === 'hyper') {
          const strictCandidates = candidates.filter((employee) => !isRestricted(employee));
          if (strictCandidates.length) {
            candidates = strictCandidates;
          } else if (candidates.length) {
            warnings.push('Ограниченный сотрудник поставлен на гипер из-за нехватки людей.');
          }
        }

        const employee = candidates
          .sort((left, right) => scoreEmployee(left, category) - scoreEmployee(right, category)
            || left.fio.localeCompare(right.fio, 'ru'))[0];

        if (!employee) {
          warnings.push(`Не хватило сотрудников для ${shop.code}.`);
          break;
        }

        assignedKeys.add(employeeKey(employee));
        selected.push(employee);

        if (category === 'hyper' && employee.daysInRow >= 2) {
          warnings.push(`${employee.fio} — ${employee.daysInRow + 1}-й день подряд на гипере, рекомендуется замена.`);
        }

        if (category === 'hyper' && isRestricted(employee)) {
          warnings.push(`${employee.fio} — Ограниченный уровень, гипер только как экстренный вариант.`);
        }
      }

      if (selected.length) {
        assignments.push({ shop, category, employees: selected });
      }
    }
  }

  const reserve = eligible.filter((employee) => !assignedKeys.has(employeeKey(employee)));
  const dailyRows = buildDailyRows(available, assignments);

  return {
    isoDate,
    available,
    assignments,
    reserve,
    warnings: [...new Set(warnings)],
    dailyRows
  };
}

function daysBetween(leftIsoDate, rightIsoDate) {
  if (!leftIsoDate || !rightIsoDate) {
    return 30;
  }

  const left = new Date(`${leftIsoDate}T00:00:00Z`).getTime();
  const right = new Date(`${rightIsoDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return 30;
  }

  return Math.max(1, Math.round((left - right) / (24 * 60 * 60 * 1000)));
}

function getDecisionEmployeeCoefficient(employee) {
  const level = normalizeText(employee.level);
  const found = Object.entries(DECISION_LEVEL_COEFFICIENTS)
    .find(([key]) => level.includes(key));

  return found?.[1] || 1;
}

function fallbackStoreComplexity(shop) {
  const category = getShopCategory(shop);
  if (category === 'hyper') {
    return 3;
  }
  if (category === 'medium') {
    return 2;
  }
  return 1;
}

function getDecisionStore(shop, data) {
  const configured = data.storeComplexity?.get(normalizeText(shop.code));
  const ks = configured?.ks || fallbackStoreComplexity(shop);

  return {
    ...shop,
    ks,
    complexitySource: configured?.ks ? 'sheet' : 'category'
  };
}

function enrichDecisionEmployee(employee, data, isoDate) {
  const kpi = data.decisionKpi?.get(normalizeFio(employee.fio));
  const rs = kpi?.rs || 1;
  const employeeCoefficient = getDecisionEmployeeCoefficient(employee);
  const daysWithoutHardStore = daysBetween(isoDate, employee.lastHyper) || 30;
  const restrictionPenalty = isRestricted(employee) ? 3 : 0;
  const overtimePenalty = employee.daysInRow >= 7 ? employee.daysInRow - 6 : 0;
  const ps = calculateAssignmentPriority({
    rs,
    employeeCoefficient,
    daysWithoutHardStore,
    consecutiveHardStoreDays: employee.daysInRow,
    overtimePenalty,
    restrictionPenalty
  });

  return {
    ...employee,
    rs,
    ps,
    kpiPeriod: kpi?.period || '',
    employeeCoefficient,
    daysWithoutHardStore,
    restrictionPenalty,
    overtimePenalty
  };
}

function assignEmployeesDecisionPreview(data, isoDate) {
  const warnings = [];
  const available = buildAvailableEmployees(data).map((employee) => enrichDecisionEmployee(employee, data, isoDate));

  if (!available.length) {
    return {
      isoDate,
      available,
      assignments: [],
      reserve: [],
      warnings: ['На выбранную дату никто не отмечен как работающий.']
    };
  }

  if (!data.decisionKpi?.size) {
    warnings.push('Лист KPI СППР пустой: для сотрудников используется нейтральный рейтинг Rs = 1.');
  }

  if (!data.storeComplexity?.size) {
    warnings.push('Лист Сложность магазинов пустой: Ks взят по категории магазина.');
  }

  const eligible = available.filter((employee) => {
    if (!hasExtraTasks(employee)) {
      return true;
    }
    warnings.push(`${employee.fio} — Доп. Задачи, исключен из preview.`);
    return false;
  });
  const assignmentCounts = new Map();
  const hardStoreCounts = new Map();
  const assignments = [];
  const shops = data.shops
    .map((shop) => getDecisionStore(shop, data))
    .sort((left, right) => right.ks - left.ks || right.priority - left.priority || left.code.localeCompare(right.code, 'ru'));

  shops.forEach((shop) => {
    const slots = requiredSlots(shop);
    const isHardStore = shop.ks >= 2.5;
    if (slots <= 0) {
      return;
    }

    const selected = [];
    for (let slot = 0; slot < slots; slot += 1) {
      const candidates = eligible
        .filter((employee) => {
          const key = employeeKey(employee);
          const assignedCount = assignmentCounts.get(key) || 0;
          const hardCount = hardStoreCounts.get(key) || 0;

          if (assignedCount >= 4) {
            return false;
          }

          return !isHardStore || hardCount === 0;
        })
        .map((employee) => {
          const key = employeeKey(employee);
          const assignedCount = assignmentCounts.get(key) || 0;
          const hardCount = hardStoreCounts.get(key) || 0;
          return {
            employee,
            effectivePs: employee.ps - assignedCount * 0.75 - hardCount * 3
          };
        });
      const employee = candidates
        .sort((left, right) => right.effectivePs - left.effectivePs || left.employee.fio.localeCompare(right.employee.fio, 'ru'))[0]?.employee;

      if (!employee) {
        warnings.push(`Не хватило сотрудников для ${shop.code}.`);
        break;
      }

      const key = employeeKey(employee);
      const nextAssignedCount = (assignmentCounts.get(key) || 0) + 1;
      assignmentCounts.set(key, nextAssignedCount);
      if (isHardStore) {
        hardStoreCounts.set(key, (hardStoreCounts.get(key) || 0) + 1);
      }
      selected.push({
        ...employee,
        assignedStoresCount: nextAssignedCount,
        hardStoresToday: hardStoreCounts.get(key) || 0
      });

      if (isHardStore && employee.daysInRow >= 2) {
        warnings.push(`${employee.fio} — ${employee.daysInRow + 1}-й день подряд на сложном магазине, нужна проверка.`);
      }

      if (isHardStore && isRestricted(employee)) {
        warnings.push(`${employee.fio} — ограниченный уровень на сложном магазине, только при нехватке людей.`);
      }

      if (nextAssignedCount === 4) {
        warnings.push(`${employee.fio} — достигнут дневной лимит 4 магазина.`);
      }
    }

    if (selected.length) {
      assignments.push({ shop, category: getShopCategory(shop), employees: selected });
    }
  });

  const reserve = eligible.filter((employee) => !assignmentCounts.has(employeeKey(employee)));

  return {
    isoDate,
    available,
    assignments,
    reserve,
    employeeLoads: [...assignmentCounts.entries()].map(([key, count]) => ({
      key,
      count,
      hardCount: hardStoreCounts.get(key) || 0
    })),
    warnings: [...new Set(warnings)]
  };
}

function buildDailyRows(available, assignments) {
  const assigned = new Map();
  assignments.forEach((assignment) => {
    assignment.employees.forEach((employee) => {
      assigned.set(employeeKey(employee), assignment);
    });
  });

  return available.map((employee) => {
    const assignment = assigned.get(employeeKey(employee));
    return [
      employee.fio,
      employee.level,
      employee.monthHyperCount,
      employee.lastHyper ? formatDisplayDate(employee.lastHyper) : '',
      employee.daysInRow,
      assignment ? CATEGORY_LABELS[assignment.category] : 'Резерв',
      assignment?.shop.code || ''
    ];
  });
}

function formatAssignmentText(result) {
  const lines = [
    `📋 Распределение на ${formatDisplayDate(result.isoDate)}`,
    `Работает сегодня: ${result.available.length} человек`,
    ''
  ];

  lines.push('🔴 ГИПЕРЫ:');
  appendAssignmentGroup(lines, result, 'hyper', true);
  lines.push('');
  lines.push('🟡 СРЕДНИЕ:');
  appendAssignmentGroup(lines, result, 'medium', false);
  lines.push('');
  lines.push('🟢 МАЛЕНЬКИЕ:');
  appendAssignmentGroup(lines, result, 'small', false);
  lines.push('');
  lines.push(`📌 Свободный резерв: ${formatReserve(result.reserve)}`);

  if (result.warnings.length) {
    lines.push('');
    lines.push('⚠️ Предупреждения:');
    result.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  lines.push('');
  lines.push('[Текст готов для копирования и отправки]');

  return lines.join('\n');
}

function appendAssignmentGroup(lines, result, category, detailed) {
  const assignments = result.assignments.filter((assignment) => assignment.category === category);
  if (!assignments.length) {
    lines.push('- Нет назначений');
    return;
  }

  assignments.forEach((assignment) => {
    const employees = assignment.employees.map((employee) => {
      if (!detailed) {
        return employee.fio;
      }
      return `${employee.fio} (${employee.level}, гиперов в месяце: ${employee.monthHyperCount})`;
    }).join(', ');
    lines.push(`- ${assignment.shop.code} — ${employees}`);
  });
}

function formatReserve(reserve) {
  if (!reserve.length) {
    return 'нет';
  }

  return reserve.map((employee) => employee.fio).join(', ');
}

function formatAnalyticsText(data) {
  if (!data.analytics.length) {
    return 'Аналитика пока пуста.';
  }

  const rows = data.analytics
    .sort((left, right) => right.points - left.points || right.hyperCount - left.hyperCount)
    .slice(0, 50)
    .map((item) => {
      const lastHyper = item.lastHyper ? `, последний гипер: ${item.lastHyper}` : '';
      return `- ${item.fio}: гиперов ${item.hyperCount}, средних ${item.mediumCount}, маленьких ${item.smallCount}, баллы ${item.points}${lastHyper}`;
    });

  return ['📊 Аналитика КСО:', '', ...rows].join('\n');
}

function formatWorkingText(data, isoDate) {
  const employees = buildAvailableEmployees(data);
  if (!employees.length) {
    return `На ${formatDisplayDate(isoDate)} никто не отмечен как работающий.`;
  }

  return [
    `Работают ${formatDisplayDate(isoDate)}: ${employees.length}`,
    '',
    ...employees.map((employee) => `- ${employee.fio} (${employee.level})`)
  ].join('\n');
}

async function loadAssignmentData(isoDate) {
  const sheetData = await getKsoAssignmentSheetData(isoDate, historySheetName(isoDate));
  return getDictionaries(sheetData, isoDate);
}

async function runKsoAssignment(isoDate) {
  try {
    const data = await loadAssignmentData(isoDate);
    const result = assignEmployees(data, isoDate);
    await writeKsoAssignmentResult(isoDate, result, data);
    return formatAssignmentText(result);
  } catch (error) {
    logError('Не удалось выполнить распределение КСО:', error);
    return GOOGLE_SHEETS_ERROR_TEXT;
  }
}

function serializeDecisionPreview(result) {
  return {
    isoDate: result.isoDate,
    date: formatDisplayDate(result.isoDate),
    availableCount: result.available.length,
    assignments: result.assignments.map((assignment) => ({
      shop: assignment.shop.code,
      category: assignment.category,
      ks: assignment.shop.ks,
      complexitySource: assignment.shop.complexitySource,
      employees: assignment.employees.map((employee) => ({
        fio: employee.fio,
        level: employee.level,
        rs: employee.rs,
        ps: employee.ps,
        coefficient: employee.employeeCoefficient,
        daysWithoutHardStore: employee.daysWithoutHardStore,
        daysInRow: employee.daysInRow,
        assignedStoresCount: employee.assignedStoresCount || 0,
        hardStoresToday: employee.hardStoresToday || 0,
        kpiPeriod: employee.kpiPeriod
      }))
    })),
    reserve: result.reserve.map((employee) => ({
      fio: employee.fio,
      level: employee.level,
      rs: employee.rs,
      ps: employee.ps
    })),
    warnings: result.warnings
  };
}

async function previewKsoDecisionAssignment(isoDate) {
  const data = await loadAssignmentData(isoDate);
  const result = assignEmployeesDecisionPreview(data, isoDate);
  return serializeDecisionPreview(result);
}

async function showKsoAnalytics(isoDate = todayIso()) {
  try {
    const data = await loadAssignmentData(isoDate);
    return formatAnalyticsText(data);
  } catch (error) {
    logError('Не удалось получить аналитику КСО:', error);
    return GOOGLE_SHEETS_ERROR_TEXT;
  }
}

async function showWorkingEmployees(isoDate) {
  try {
    const data = await loadAssignmentData(isoDate);
    return formatWorkingText(data, isoDate);
  } catch (error) {
    logError('Не удалось получить список работающих КСО:', error);
    return GOOGLE_SHEETS_ERROR_TEXT;
  }
}

async function updateScheduleStatus(userId, profile, isoDate, status) {
  try {
    await writeKsoScheduleStatus(profile, isoDate, status, historySheetName(isoDate));
    log('График КСО обновлен.', { userId, fio: profile.fio, isoDate, status });
    return `Готово: на ${formatDisplayDate(isoDate)} установлен статус ${status}.`;
  } catch (error) {
    logError('Не удалось обновить график КСО:', error);
    return GOOGLE_SHEETS_ERROR_TEXT;
  }
}

async function updateScheduleMonth(userId, profile, isoDateHours) {
  try {
    await writeKsoScheduleMonthHours(profile, isoDateHours, historySheetName(isoDateHours[0].isoDate));
    const totalHours = isoDateHours.reduce((sum, item) => sum + numberValue(item.hours, 0), 0);
    log('Месячный график КСО обновлен.', { userId, fio: profile.fio, days: isoDateHours.length, totalHours });
    return `Готово: график сохранен. Итого часов: ${totalHours}.`;
  } catch (error) {
    logError('Не удалось обновить месячный график КСО:', error);
    return GOOGLE_SHEETS_ERROR_TEXT;
  }
}

async function getScheduleMonthSummary(isoDate) {
  const data = await loadAssignmentData(isoDate);
  const [headers = [], ...rows] = data.rawSchedule || [];
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const employeesCount = rows.filter((row) => String(row[1] || row[2] || '').trim()).length;

  const days = Array.from({ length: lastDay }, (_, index) => {
    const day = index + 1;
    const date = formatIsoDate(new Date(Date.UTC(year, month - 1, day)));
    const columnIndex = headers.findIndex((header) => Number(header) === day);
    const actualIndex = columnIndex >= 0 ? columnIndex : day + 2;
    const workingCount = rows.reduce((count, row) => count + (numberValue(row[actualIndex], 0) > 0 ? 1 : 0), 0);

    return {
      date,
      day,
      workingCount,
      restCount: Math.max(0, employeesCount - workingCount)
    };
  });

  return {
    month: isoDate.slice(0, 7),
    employeesCount,
    days
  };
}

async function getScheduleMonthTable(isoDate) {
  const data = await loadAssignmentData(isoDate);
  const [headers = [], ...rows] = data.rawSchedule || [];
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: lastDay }, (_, index) => index + 1);
  const totalColumn = headers.findIndex((header) => normalizeText(header) === normalizeText('Итого'));

  return {
    month: isoDate.slice(0, 7),
    days,
    rows: rows
      .filter((row) => String(row[1] || row[2] || '').trim())
      .map((row) => {
        const dayValues = {};
        let computedTotal = 0;

        days.forEach((day) => {
          const columnIndex = headers.findIndex((header) => Number(header) === day);
          const actualIndex = columnIndex >= 0 ? columnIndex : day + 2;
          const hours = numberValue(row[actualIndex], 0);
          dayValues[String(day)] = hours > 0 ? hours : '';
          computedTotal += hours;
        });

        const tableTotal = totalColumn >= 0 ? numberValue(row[totalColumn], computedTotal) : computedTotal;

        return {
          id: String(row[0] || '').trim(),
          fio: String(row[1] || row[2] || '').trim(),
          days: dayValues,
          total: tableTotal
        };
      })
  };
}

async function applyManualAssignment(fio, shopCode, isoDate = todayIso()) {
  try {
    const data = await loadAssignmentData(isoDate);
    const employee = data.employees.find((item) => normalizeFio(item.fio).includes(normalizeFio(fio)));
    const shop = data.shops.find((item) => normalizeText(item.code) === normalizeText(shopCode));

    if (!employee) {
      return `Сотрудник "${fio}" не найден.`;
    }

    if (!shop) {
      return `Магазин "${shopCode}" не найден.`;
    }

    await writeKsoManualAssignment(isoDate, employee, shop, data);
    return `Ручное назначение зафиксировано: ${employee.fio} — ${shop.code} на ${formatDisplayDate(isoDate)}.`;
  } catch (error) {
    logError('Не удалось зафиксировать ручное назначение КСО:', error);
    return GOOGLE_SHEETS_ERROR_TEXT;
  }
}

function parseAssignmentCommandDate(args) {
  if (!args.length) {
    return todayIso();
  }

  return parseInputDate(args[0]) || null;
}

function shortEmployeeName(fio) {
  return String(fio || '').trim().split(/\s+/)[1] || String(fio || '').trim();
}

function normalizeShopCode(value) {
  const text = String(value || '').trim();
  const match = text.match(/(?:^|\s)([A-Za-zА-Яа-яЁё]+[-\s]?\d+[A-Za-zА-Яа-яЁё-]*)/);
  return (match?.[1] || text).replace(/\s+/g, '');
}

function buildInitEmployees() {
  return listEmployees()
    .filter((employee) => employee.active === 1)
    .map((employee) => {
      const profile = getProfile(employee.user_id);
      const fio = String(profile?.fio || employee.fio || '').trim();

      return {
        id: String(employee.user_id),
        fio,
        name: shortEmployeeName(fio)
      };
    })
    .filter((employee) => employee.fio)
    .sort((left, right) => left.fio.localeCompare(right.fio, 'ru'));
}

function buildInitShops() {
  return listCatalogShops()
    .map((shop) => ({
      code: normalizeShopCode(shop.name),
      category: 'Средний',
      priority: 3,
      required: 1,
      flow: [shop.region, shop.address].filter(Boolean).join(', ')
    }))
    .filter((shop) => shop.code)
    .sort((left, right) => left.code.localeCompare(right.code, 'ru', { numeric: true }));
}

async function initKsoAssignmentSheet(isoDate = todayIso()) {
  try {
    const employees = buildInitEmployees();
    const shops = buildInitShops();
    const result = await initializeKsoAssignmentSheet(isoDate, employees, shops, historySheetName(isoDate));

    return [
      'Инициализация КСО завершена.',
      '',
      `Сотрудников добавлено: ${result.employeesCount}`,
      `Магазинов добавлено: ${result.shopsCount}`,
      `Таблица распределения: ${result.spreadsheetId}`
    ].join('\n');
  } catch (error) {
    logError('Не удалось инициализировать таблицу КСО:', error);
    return GOOGLE_SHEETS_ERROR_TEXT;
  }
}

module.exports = {
  GOOGLE_SHEETS_ERROR_TEXT,
  applyManualAssignment,
  formatDisplayDate,
  getScheduleMonthSummary,
  getScheduleMonthTable,
  historySheetName,
  initKsoAssignmentSheet,
  isPastDate,
  parseAssignmentCommandDate,
  parseInputDate,
  previewKsoDecisionAssignment,
  runKsoAssignment,
  showKsoAnalytics,
  showWorkingEmployees,
  todayIso,
  updateScheduleMonth,
  updateScheduleStatus
};
