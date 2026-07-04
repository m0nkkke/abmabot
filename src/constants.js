const MAX_API_BASE_URL = process.env.MAX_API_BASE_URL || 'https://platform-api2.max.ru';
const SHOP_BUTTONS_PER_ROW = 3;
const SHOPS_PER_PAGE = 9;
const MAX_PHOTOS_PER_RECORD = 10;
const POLLING_TIMEOUT_SECONDS = 30;
const POLLING_REQUEST_TIMEOUT_MS = (POLLING_TIMEOUT_SECONDS + 10) * 1000;
const CONSENT_VERSION = '2026-05-15';

const ROLES = {
  EMPLOYEE: 'employee',
  OPERATOR: 'operator',
  ADMIN: 'admin'
};

const EVENT_TYPES = {
  THEFT: 'Кража',
  MISSED_THEFT: 'Упущенная кража',
  VIOLATION: 'Нарушение'
};

const VIOLATION_TYPES = {
  SHORTAGE: 'Недобитие',
  OVERCHARGE: 'Перебитие',
  BAG: 'Пакет',
  CONTAINER: 'Контейнер',
  RESORT: 'Пересорт',
  WRONG_BARCODE: 'Неверная штриховка'
};

const BOT_COMMANDS = [
  { name: 'start', description: 'Открыть меню действий' },
  { name: 'report', description: 'Отправить текстовый отчет' },
  { name: 'id', description: 'Показать мой MAX user_id' },
  { name: 'help', description: 'Показать справку по командам' },
  { name: 'profile', description: 'Изменить ФИО' },
  { name: 'password', description: 'Сменить роль по паролю доступа' },
  { name: 'privacy', description: 'Информация об обработке персональных данных' },
  { name: 'revoke', description: 'Отозвать согласие и удалить локальные данные' },
  { name: 'sheet', description: 'Ссылка на Google Таблицу' },
  { name: 'employees', description: 'Список сотрудников' },
  { name: 'message', description: 'Админ: рассылка сообщения пользователям' },
  { name: 'admin', description: 'Админ: управление регионами и магазинами' },
  { name: 'distribution', description: 'Админ: распределение сотрудников КСО' },
  { name: 'initkso', description: 'Админ: инициализация таблицы КСО' },
  { name: 'kso_analytics', description: 'Админ: аналитика КСО' },
  { name: 'who_works', description: 'Админ: список работающих КСО' },
  { name: 'manual', description: 'Админ: ручное назначение КСО' },
  { name: 'kso_help', description: 'Команды КСО' },
  { name: 'setfio', description: 'Админ: изменить ФИО сотрудника' },
  { name: 'block', description: 'Админ: отключить доступ сотруднику' }
];

module.exports = {
  MAX_API_BASE_URL,
  MAX_PHOTOS_PER_RECORD,
  SHOP_BUTTONS_PER_ROW,
  SHOPS_PER_PAGE,
  POLLING_TIMEOUT_SECONDS,
  POLLING_REQUEST_TIMEOUT_MS,
  CONSENT_VERSION,
  ROLES,
  EVENT_TYPES,
  VIOLATION_TYPES,
  BOT_COMMANDS
};
