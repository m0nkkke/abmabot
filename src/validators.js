function todayMskPlus5() {
  const now = new Date();
  const utcPlus8Ms = now.getTime() + 8 * 60 * 60 * 1000;
  const date = new Date(utcPlus8Ms);

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();

  return `${day}.${month}.${year}`;
}

function isValidDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);

  if (month < 1 || month > 12) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function parseAmount(text) {
  const normalized = text.replace(',', '.').trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  const amount = parseFloat(normalized);
  if (Number.isNaN(amount)) {
    return null;
  }

  return amount;
}

module.exports = { isValidDate, parseAmount, todayMskPlus5 };
