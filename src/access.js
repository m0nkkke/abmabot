const { ROLES } = require('./constants');
const {
  blockEmployee,
  getEmployee,
  getProfile,
  getUserRole,
  listEmployees,
  saveEmployee,
  updateEmployeeFio
} = require('./db');
const { sendMessage } = require('./maxClient');

const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((userId) => userId.trim())
  .filter(Boolean);

const ROLE_PASSWORDS = [
  { role: ROLES.ADMIN, password: process.env.ADMIN_ACCESS_PASSWORD || '' },
  { role: ROLES.OPERATOR, password: process.env.OPERATOR_ACCESS_PASSWORD || '' },
  { role: ROLES.EMPLOYEE, password: process.env.EMPLOYEE_ACCESS_PASSWORD || '' }
].filter((item) => item.password);

const ROLE_LABELS = {
  [ROLES.EMPLOYEE]: 'сотрудник',
  [ROLES.OPERATOR]: 'оператор',
  [ROLES.ADMIN]: 'администратор'
};

function isBootstrapAdmin(userId) {
  return ADMIN_USER_IDS.includes(String(userId));
}

function isAdmin(userId) {
  return isBootstrapAdmin(userId) || getUserRole(userId) === ROLES.ADMIN;
}

function hasConfiguredPasswords() {
  return ROLE_PASSWORDS.length > 0;
}

function getRoleByPassword(password) {
  const normalized = String(password || '').trim();
  const found = ROLE_PASSWORDS.find((item) => item.password === normalized);
  return found?.role || null;
}

function grantAccessByPassword(userId, password) {
  const role = getRoleByPassword(password);
  if (!role) {
    return null;
  }

  saveEmployee(userId, null, null, true, userId, role);
  return role;
}

function parseCommand(text) {
  const [command, ...args] = text.trim().split(/\s+/);
  return {
    command: command.toLowerCase(),
    args
  };
}

function formatEmployees(employees) {
  if (!employees.length) {
    return 'Список сотрудников пуст.';
  }

  return [
    'Сотрудники:',
    '',
    ...employees.slice(0, 50).map((employee) => {
      const profile = getProfile(employee.user_id);
      const status = employee.active === 1 ? 'активен' : 'заблокирован';
      const role = ROLE_LABELS[employee.role] || employee.role || ROLES.EMPLOYEE;
      const fio = profile?.fio || employee.fio || 'ФИО не указано';
      return `${employee.user_id} — ${status}, ${role}, ${fio}`;
    })
  ].join('\n');
}

async function handleAdminCommand(chatId, userId, text, googleSheetUrl) {
  const { command, args } = parseCommand(text);

  if (!isAdmin(userId)) {
    return false;
  }

  if (command === '/employees') {
    await sendMessage(chatId, formatEmployees(listEmployees()));
    return true;
  }

  if (command === '/sheet') {
    await sendMessage(
      chatId,
      googleSheetUrl
        ? `Google Таблица: ${googleSheetUrl}`
        : 'Ссылка на Google Таблицу не настроена. Заполните GOOGLE_SHEET_URL или GOOGLE_SHEET_ID в .env.'
    );
    return true;
  }

  if (command === '/setfio') {
    const targetUserId = args[0];
    const fio = args.slice(1).join(' ').trim();

    if (!targetUserId || !fio) {
      await sendMessage(chatId, 'Укажите user_id и новое ФИО: /setfio <user_id> <ФИО>');
      return true;
    }

    if (!getEmployee(targetUserId)) {
      await sendMessage(chatId, `Пользователь ${targetUserId} не найден в списке сотрудников.`);
      return true;
    }

    updateEmployeeFio(targetUserId, fio);
    await sendMessage(chatId, `ФИО пользователя ${targetUserId} обновлено: ${fio}`);
    return true;
  }

  if (command === '/setshop') {
    await sendMessage(chatId, 'Команда /setshop больше не используется: регион и магазин выбираются при каждой фиксации.');
    return true;
  }

  if (command === '/block') {
    const targetUserId = args[0];
    if (!targetUserId) {
      await sendMessage(chatId, 'Укажите user_id: /block <user_id>');
      return true;
    }

    const blocked = blockEmployee(targetUserId);
    await sendMessage(
      chatId,
      blocked
        ? `Доступ отключён для user_id ${targetUserId}.`
        : `Сотрудник с user_id ${targetUserId} не найден.`
    );
    return true;
  }

  return false;
}

module.exports = {
  grantAccessByPassword,
  hasConfiguredPasswords,
  handleAdminCommand,
  isAdmin,
  ROLE_LABELS
};
