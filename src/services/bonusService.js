const { getEmployee, getProfile } = require('../db');
const { getBonusSheetRows } = require('../sheets');

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFio(value) {
  return normalizeText(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().replace(/ё/g, 'е').replace(/[\s_]+/g, '');
}

function parseMoney(value) {
  const normalized = normalizeText(value)
    .replace(/\s+/g, '')
    .replace(/₽/g, '')
    .replace(/руб\.?/gi, '')
    .replace(/р\.?/gi, '')
    .replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function parseDateParts(value) {
  const text = normalizeText(value);
  const ru = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (ru) {
    return {
      day: Number(ru[1]),
      month: Number(ru[2]),
      year: Number(ru[3])
    };
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return {
      day: Number(iso[3]),
      month: Number(iso[2]),
      year: Number(iso[1])
    };
  }

  return null;
}

function monthKeyFromText(value) {
  const text = normalizeText(value);
  const numeric = /^(\d{1,2})[.\-/](\d{4})$/.exec(text);
  if (numeric) {
    return `${numeric[2]}-${String(Number(numeric[1])).padStart(2, '0')}`;
  }

  const iso = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}`;
  }

  return text || '';
}

function buildMonthKey(dateValue, monthValue) {
  const date = parseDateParts(dateValue);
  if (date) {
    return `${date.year}-${String(date.month).padStart(2, '0')}`;
  }

  return monthKeyFromText(monthValue);
}

function buildMonthLabel(monthKey, fallback = '') {
  const parsed = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!parsed) {
    return fallback || monthKey || 'Без месяца';
  }

  const monthIndex = Number(parsed[2]) - 1;
  return `${MONTH_NAMES[monthIndex] || parsed[2]} ${parsed[1]}`;
}

function dateSortValue(value) {
  const date = parseDateParts(value);
  if (!date) {
    return 0;
  }

  return date.year * 10000 + date.month * 100 + date.day;
}

function getColumnIndexes(headers) {
  const normalized = headers.map(normalizeHeader);
  const find = (names, fallback) => {
    const index = normalized.findIndex((header) => names.includes(header));
    return index >= 0 ? index : fallback;
  };

  return {
    month: find(['месяц'], 0),
    date: find(['дата'], 1),
    fio: find(['фио'], 2),
    type: find(['тип'], 3),
    amount: find(['сумма'], 4),
    fixationId: find(['idфиксации', 'idfixation', 'фиксация'], 5),
    bonus: find(['премия'], 6)
  };
}

function mapBonusRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const hasHeader = rows[0].some((cell) => ['месяц', 'дата', 'фио', 'премия'].includes(normalizeHeader(cell)));
  const indexes = getColumnIndexes(hasHeader ? rows[0] : []);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((row, index) => {
      const month = normalizeText(row[indexes.month]);
      const date = normalizeText(row[indexes.date]);
      const monthKey = buildMonthKey(date, month);

      return {
        rowNumber: index + (hasHeader ? 2 : 1),
        month,
        monthKey,
        monthLabel: buildMonthLabel(monthKey, month),
        date,
        fio: normalizeText(row[indexes.fio]),
        type: normalizeText(row[indexes.type]),
        amount: parseMoney(row[indexes.amount]),
        amountText: normalizeText(row[indexes.amount]),
        fixationId: normalizeText(row[indexes.fixationId]),
        bonus: parseMoney(row[indexes.bonus]),
        bonusText: normalizeText(row[indexes.bonus]),
        sortValue: dateSortValue(date)
      };
    })
    .filter((row) => row.fio);
}

function buildBonusSummary(rows, fio, selectedMonth = '') {
  const employeeFio = normalizeFio(fio);
  const employeeRows = mapBonusRows(rows)
    .filter((row) => normalizeFio(row.fio) === employeeFio);

  const monthMap = new Map();
  employeeRows.forEach((row) => {
    if (!row.monthKey) {
      return;
    }
    if (!monthMap.has(row.monthKey)) {
      monthMap.set(row.monthKey, {
        value: row.monthKey,
        label: row.monthLabel,
        sortValue: row.monthKey
      });
    }
  });

  const months = Array.from(monthMap.values())
    .sort((left, right) => String(right.sortValue).localeCompare(String(left.sortValue)));
  const month = selectedMonth && monthMap.has(selectedMonth)
    ? selectedMonth
    : months[0]?.value || '';
  const monthRows = month ? employeeRows.filter((row) => row.monthKey === month) : [];
  const totalBonus = monthRows.reduce((sum, row) => sum + row.bonus, 0);
  const recentFixations = [...employeeRows]
    .sort((left, right) => right.sortValue - left.sortValue || right.rowNumber - left.rowNumber)
    .slice(0, 10);

  return {
    fio: normalizeText(fio),
    selectedMonth: month,
    selectedMonthLabel: months.find((item) => item.value === month)?.label || '',
    months,
    totalBonus,
    rowsInMonth: monthRows.length,
    recentFixations
  };
}

async function getMiniAppBonusSummary(userId, selectedMonth = '') {
  const profile = userId ? getProfile(userId) : null;
  const employee = userId ? getEmployee(userId) : null;
  const fio = profile?.fio || employee?.fio || '';

  if (!fio) {
    const error = new Error('Не удалось определить ФИО сотрудника для расчета премии.');
    error.statusCode = 400;
    throw error;
  }

  const rows = await getBonusSheetRows();
  return buildBonusSummary(rows, fio, selectedMonth);
}

module.exports = {
  buildBonusSummary,
  getMiniAppBonusSummary,
  mapBonusRows,
  parseMoney
};
