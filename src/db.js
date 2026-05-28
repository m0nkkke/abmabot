const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { ROLES } = require('./constants');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    fio TEXT NOT NULL,
    shop TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    user_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    data TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS consents (
    user_id TEXT PRIMARY KEY,
    policy_version TEXT NOT NULL,
    text TEXT NOT NULL,
    accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS employees (
    user_id TEXT PRIMARY KEY,
    fio TEXT,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
  );

  CREATE TABLE IF NOT EXISTS access_requests (
    user_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    approved_by TEXT
  );

  CREATE TABLE IF NOT EXISTS recent_shops (
    user_id TEXT NOT NULL,
    region TEXT NOT NULL,
    shop TEXT NOT NULL,
    selected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, region, shop)
  );
`);

const employeeColumns = db.pragma('table_info(employees)').map((column) => column.name);
if (!employeeColumns.includes('role')) {
  db.exec(`ALTER TABLE employees ADD COLUMN role TEXT NOT NULL DEFAULT '${ROLES.EMPLOYEE}'`);
}

const profileColumns = db.pragma('table_info(profiles)').map((column) => column.name);
if (!profileColumns.includes('region')) {
  db.exec("ALTER TABLE profiles ADD COLUMN region TEXT NOT NULL DEFAULT ''");
}

const getProfileStmt = db.prepare('SELECT user_id, fio, region, shop, created_at FROM profiles WHERE user_id = ?');
const upsertProfileStmt = db.prepare(`
  INSERT INTO profiles (user_id, fio, region, shop)
  VALUES (@userId, @fio, @region, @shop)
  ON CONFLICT(user_id) DO UPDATE SET
    fio = excluded.fio,
    region = excluded.region,
    shop = excluded.shop
`);
const deleteProfileStmt = db.prepare('DELETE FROM profiles WHERE user_id = ?');

const getSessionStmt = db.prepare('SELECT user_id, state, data FROM sessions WHERE user_id = ?');
const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (user_id, state, data)
  VALUES (@userId, @state, @data)
  ON CONFLICT(user_id) DO UPDATE SET
    state = excluded.state,
    data = excluded.data
`);
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');

const getConsentStmt = db.prepare('SELECT user_id, policy_version, text, accepted_at FROM consents WHERE user_id = ?');
const upsertConsentStmt = db.prepare(`
  INSERT INTO consents (user_id, policy_version, text)
  VALUES (@userId, @policyVersion, @text)
  ON CONFLICT(user_id) DO UPDATE SET
    policy_version = excluded.policy_version,
    text = excluded.text,
    accepted_at = CURRENT_TIMESTAMP
`);
const deleteConsentStmt = db.prepare('DELETE FROM consents WHERE user_id = ?');

const getEmployeeStmt = db.prepare('SELECT user_id, fio, phone, role, active, created_at, created_by FROM employees WHERE user_id = ?');
const listEmployeesStmt = db.prepare('SELECT user_id, fio, phone, role, active, created_at, created_by FROM employees ORDER BY created_at DESC');
const upsertEmployeeStmt = db.prepare(`
  INSERT INTO employees (user_id, fio, phone, role, active, created_by)
  VALUES (@userId, @fio, @phone, @role, @active, @createdBy)
  ON CONFLICT(user_id) DO UPDATE SET
    fio = COALESCE(excluded.fio, employees.fio),
    phone = COALESCE(excluded.phone, employees.phone),
    role = excluded.role,
    active = excluded.active,
    created_by = COALESCE(excluded.created_by, employees.created_by)
`);
const setEmployeeActiveStmt = db.prepare('UPDATE employees SET active = ? WHERE user_id = ?');
const updateEmployeeFioStmt = db.prepare('UPDATE employees SET fio = ? WHERE user_id = ?');
const updateProfileFioStmt = db.prepare('UPDATE profiles SET fio = ? WHERE user_id = ?');
const updateProfileShopStmt = db.prepare('UPDATE profiles SET region = ?, shop = ? WHERE user_id = ?');

const upsertAccessRequestStmt = db.prepare(`
  INSERT INTO access_requests (user_id, status)
  VALUES (?, 'pending')
  ON CONFLICT(user_id) DO UPDATE SET
    status = CASE
      WHEN status = 'approved' THEN status
      ELSE 'pending'
    END,
    requested_at = CASE
      WHEN status = 'approved' THEN requested_at
      ELSE CURRENT_TIMESTAMP
    END
`);
const approveAccessRequestStmt = db.prepare(`
  INSERT INTO access_requests (user_id, status, approved_at, approved_by)
  VALUES (@userId, 'approved', CURRENT_TIMESTAMP, @approvedBy)
  ON CONFLICT(user_id) DO UPDATE SET
    status = 'approved',
    approved_at = CURRENT_TIMESTAMP,
    approved_by = excluded.approved_by
`);
const denyAccessRequestStmt = db.prepare(`
  INSERT INTO access_requests (user_id, status)
  VALUES (?, 'denied')
  ON CONFLICT(user_id) DO UPDATE SET
    status = 'denied'
`);
const listPendingAccessRequestsStmt = db.prepare(`
  SELECT user_id, status, requested_at, approved_at, approved_by
  FROM access_requests
  WHERE status = 'pending'
  ORDER BY requested_at ASC
`);
const upsertRecentShopStmt = db.prepare(`
  INSERT INTO recent_shops (user_id, region, shop, selected_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(user_id, region, shop) DO UPDATE SET
    selected_at = CURRENT_TIMESTAMP
`);
const listRecentShopsStmt = db.prepare(`
  SELECT region, shop, selected_at
  FROM recent_shops
  WHERE user_id = ?
  ORDER BY selected_at DESC
  LIMIT ?
`);
const deleteOldRecentShopsStmt = db.prepare(`
  DELETE FROM recent_shops
  WHERE user_id = ?
    AND (region || char(31) || shop) NOT IN (
      SELECT region || char(31) || shop
      FROM recent_shops
      WHERE user_id = ?
      ORDER BY selected_at DESC
      LIMIT ?
    )
`);

function getProfile(userId) {
  return getProfileStmt.get(String(userId));
}

function saveProfile(userId, fio, region = '', shop = '') {
  upsertProfileStmt.run({ userId: String(userId), fio, region, shop });
}

function deleteProfile(userId) {
  deleteProfileStmt.run(String(userId));
}

function getSession(userId) {
  const row = getSessionStmt.get(String(userId));
  if (!row) {
    return null;
  }

  let data = {};
  try {
    data = JSON.parse(row.data || '{}');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка разбора JSON сессии:`, error);
  }

  return {
    userId: row.user_id,
    state: row.state,
    data
  };
}

function saveSession(userId, state, data = {}) {
  upsertSessionStmt.run({
    userId: String(userId),
    state,
    data: JSON.stringify(data)
  });
}

function deleteSession(userId) {
  deleteSessionStmt.run(String(userId));
}

function getConsent(userId) {
  return getConsentStmt.get(String(userId));
}

function saveConsent(userId, policyVersion, text) {
  upsertConsentStmt.run({
    userId: String(userId),
    policyVersion,
    text
  });
}

function deleteConsent(userId) {
  deleteConsentStmt.run(String(userId));
}

function deleteUserLocalData(userId) {
  const remove = db.transaction((id) => {
    deleteProfileStmt.run(id);
    deleteSessionStmt.run(id);
    deleteConsentStmt.run(id);
  });

  remove(String(userId));
}

function getEmployee(userId) {
  return getEmployeeStmt.get(String(userId));
}

function isAllowedUser(userId) {
  const employee = getEmployee(userId);
  return Boolean(employee && employee.active === 1);
}

function saveEmployee(userId, fio = null, phone = null, active = true, createdBy = null, role = ROLES.EMPLOYEE) {
  upsertEmployeeStmt.run({
    userId: String(userId),
    fio,
    phone,
    role,
    active: active ? 1 : 0,
    createdBy: createdBy ? String(createdBy) : null
  });
}

function getUserRole(userId) {
  const employee = getEmployee(userId);
  if (!employee || employee.active !== 1) {
    return null;
  }

  return employee.role || ROLES.EMPLOYEE;
}

function updateEmployeeFio(userId, fio) {
  const update = db.transaction((id, nextFio) => {
    updateEmployeeFioStmt.run(nextFio, id);
    updateProfileFioStmt.run(nextFio, id);
  });

  update(String(userId), fio);
}

function updateEmployeeShop(userId, region, shop) {
  const result = updateProfileShopStmt.run(region, shop, String(userId));
  return result.changes > 0;
}

function blockEmployee(userId) {
  const result = setEmployeeActiveStmt.run(0, String(userId));
  return result.changes > 0;
}

function listEmployees() {
  return listEmployeesStmt.all();
}

function createAccessRequest(userId) {
  upsertAccessRequestStmt.run(String(userId));
}

function approveAccessRequest(userId, approvedBy) {
  const approve = db.transaction((id, adminId) => {
    saveEmployee(id, null, null, true, adminId);
    approveAccessRequestStmt.run({ userId: String(id), approvedBy: String(adminId) });
  });

  approve(String(userId), String(approvedBy));
}

function denyAccessRequest(userId) {
  denyAccessRequestStmt.run(String(userId));
}

function listPendingAccessRequests() {
  return listPendingAccessRequestsStmt.all();
}

function rememberRecentShop(userId, region, shop, limit = 5) {
  const save = db.transaction((id, shopRegion, shopName, maxItems) => {
    upsertRecentShopStmt.run(id, shopRegion, shopName);
    deleteOldRecentShopsStmt.run(id, id, maxItems);
  });

  save(String(userId), region, shop, limit);
}

function listRecentShops(userId, limit = 5) {
  return listRecentShopsStmt.all(String(userId), limit);
}

function closeDb() {
  db.close();
}

module.exports = {
  getProfile,
  saveProfile,
  deleteProfile,
  getSession,
  saveSession,
  deleteSession,
  getConsent,
  saveConsent,
  deleteConsent,
  deleteUserLocalData,
  getEmployee,
  getUserRole,
  isAllowedUser,
  saveEmployee,
  updateEmployeeFio,
  updateEmployeeShop,
  blockEmployee,
  listEmployees,
  createAccessRequest,
  approveAccessRequest,
  denyAccessRequest,
  listPendingAccessRequests,
  rememberRecentShop,
  listRecentShops,
  closeDb
};
