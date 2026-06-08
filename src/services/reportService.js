const {
  appendKsoReportRow,
  appendTechReportRow,
  appendTextReportRow
} = require('../sheets');
const { isValidDate } = require('../validators');

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function validateSimpleReport({ fio, date, text }, message) {
  const normalized = {
    fio: normalizeText(fio),
    date: normalizeText(date),
    text: normalizeText(text)
  };

  if (!normalized.fio || !isValidDate(normalized.date) || !normalized.text) {
    throw createValidationError(message);
  }

  return normalized;
}

async function createTextReport(data) {
  const report = validateSimpleReport(data, 'Заполните ФИО, дату и текст отчета');
  await appendTextReportRow([report.fio, report.date, report.text]);
}

async function createKsoReport(data) {
  const report = validateSimpleReport(data, 'Заполните ФИО, дату и текст отписки КСО');
  await appendKsoReportRow([report.fio, report.date, report.text]);
}

async function createTechReport(data) {
  const report = validateSimpleReport(data, 'Заполните ФИО, дату и описание технической неполадки');
  await appendTechReportRow([report.fio, report.date, report.text]);
}

module.exports = {
  createKsoReport,
  createTechReport,
  createTextReport
};
