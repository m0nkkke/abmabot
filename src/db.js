const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');
const { ROLES } = require('./constants');
const seedShops = require('./shops.json');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
const shopNameCollator = new Intl.Collator('ru', {
  numeric: true,
  sensitivity: 'base'
});

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

  CREATE TABLE IF NOT EXISTS recent_fixations (
    fixation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS catalog_regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS catalog_shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    UNIQUE(region_id, name),
    FOREIGN KEY(region_id) REFERENCES catalog_regions(id)
  );

  CREATE TABLE IF NOT EXISTS catalog_migrations (
    name TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS miniapp_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS kso_schedule_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    fio TEXT NOT NULL,
    month TEXT NOT NULL,
    request_type TEXT NOT NULL DEFAULT 'month',
    status TEXT NOT NULL DEFAULT 'draft',
    entries TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME,
    reviewed_at DATETIME,
    reviewed_by TEXT,
    archived_at DATETIME
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

const ksoScheduleRequestColumns = db.pragma('table_info(kso_schedule_requests)').map((column) => column.name);
if (!ksoScheduleRequestColumns.includes('archived_at')) {
  db.exec('ALTER TABLE kso_schedule_requests ADD COLUMN archived_at DATETIME');
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
const insertMiniAppSessionStmt = db.prepare(`
  INSERT INTO miniapp_sessions (token, user_id, created_at, expires_at)
  VALUES (@token, @userId, @createdAt, @expiresAt)
`);
const getMiniAppSessionStmt = db.prepare(`
  SELECT token, user_id, created_at, expires_at, used_at
  FROM miniapp_sessions
  WHERE token = ?
`);
const markMiniAppSessionUsedStmt = db.prepare(`
  UPDATE miniapp_sessions
  SET used_at = COALESCE(used_at, @usedAt)
  WHERE token = @token
`);
const deleteExpiredMiniAppSessionsStmt = db.prepare('DELETE FROM miniapp_sessions WHERE expires_at <= ?');

const insertKsoScheduleRequestStmt = db.prepare(`
  INSERT INTO kso_schedule_requests (
    id, user_id, fio, month, request_type, status, entries, comment, submitted_at
  )
  VALUES (
    @id, @userId, @fio, @month, @requestType, @status, @entries, @comment,
    CASE WHEN @status = 'submitted' THEN CURRENT_TIMESTAMP ELSE NULL END
  )
`);
const updateKsoScheduleRequestStmt = db.prepare(`
  UPDATE kso_schedule_requests
  SET
    fio = @fio,
    month = @month,
    request_type = @requestType,
    status = @status,
    entries = @entries,
    comment = @comment,
    updated_at = CURRENT_TIMESTAMP,
    submitted_at = CASE
      WHEN @status = 'submitted' AND submitted_at IS NULL THEN CURRENT_TIMESTAMP
      WHEN @status = 'draft' THEN NULL
      ELSE submitted_at
    END
  WHERE id = @id
    AND user_id = @userId
    AND status IN ('draft', 'rejected')
    AND archived_at IS NULL
`);
const getKsoScheduleRequestStmt = db.prepare(`
  SELECT id, user_id, fio, month, request_type, status, entries, comment, created_at, updated_at, submitted_at, reviewed_at, reviewed_by, archived_at
  FROM kso_schedule_requests
  WHERE id = ?
`);
const listKsoScheduleRequestsStmt = db.prepare(`
  SELECT id, user_id, fio, month, request_type, status, entries, comment, created_at, updated_at, submitted_at, reviewed_at, reviewed_by, archived_at
  FROM kso_schedule_requests
  WHERE archived_at IS NULL
  ORDER BY updated_at DESC
  LIMIT ?
`);
const reviewKsoScheduleRequestStmt = db.prepare(`
  UPDATE kso_schedule_requests
  SET status = @status,
      entries = COALESCE(@entries, entries),
      reviewed_at = CURRENT_TIMESTAMP,
      reviewed_by = @reviewedBy,
      updated_at = CURRENT_TIMESTAMP,
      comment = COALESCE(@comment, comment)
  WHERE id = @id
    AND status = 'submitted'
`);
const archiveKsoScheduleRequestStmt = db.prepare(`
  UPDATE kso_schedule_requests
  SET archived_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
    AND status = 'rejected'
    AND archived_at IS NULL
`);
const updateApprovedKsoScheduleRequestStmt = db.prepare(`
  UPDATE kso_schedule_requests
  SET entries = @entries,
      reviewed_by = @reviewedBy,
      updated_at = CURRENT_TIMESTAMP,
      comment = COALESCE(@comment, comment)
  WHERE id = @id
    AND status = 'approved'
    AND request_type = 'month'
    AND archived_at IS NULL
`);

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
const upsertRecentFixationStmt = db.prepare(`
  INSERT INTO recent_fixations (fixation_id, user_id, data, updated_at)
  VALUES (@fixationId, @userId, @data, CURRENT_TIMESTAMP)
  ON CONFLICT(fixation_id) DO UPDATE SET
    user_id = excluded.user_id,
    data = excluded.data,
    updated_at = CURRENT_TIMESTAMP
`);
const listRecentFixationsStmt = db.prepare(`
  SELECT fixation_id, data, updated_at
  FROM recent_fixations
  WHERE user_id = ?
  ORDER BY updated_at DESC
  LIMIT ?
`);
const listCatalogRegionsStmt = db.prepare('SELECT id, name FROM catalog_regions ORDER BY name COLLATE NOCASE');
const getCatalogRegionStmt = db.prepare('SELECT id, name FROM catalog_regions WHERE id = ?');
const insertCatalogRegionStmt = db.prepare('INSERT INTO catalog_regions (name) VALUES (?)');
const updateCatalogRegionStmt = db.prepare('UPDATE catalog_regions SET name = ? WHERE id = ?');
const deleteCatalogRegionStmt = db.prepare('DELETE FROM catalog_regions WHERE id = ?');
const countCatalogRegionShopsStmt = db.prepare('SELECT COUNT(*) AS count FROM catalog_shops WHERE region_id = ?');
const listCatalogShopsStmt = db.prepare(`
  SELECT shops.id, shops.name, shops.address, regions.id AS region_id, regions.name AS region
  FROM catalog_shops shops
  JOIN catalog_regions regions ON regions.id = shops.region_id
  ORDER BY regions.name COLLATE NOCASE, shops.name COLLATE NOCASE
`);
const listCatalogShopsByRegionStmt = db.prepare(`
  SELECT shops.id, shops.name, shops.address, regions.id AS region_id, regions.name AS region
  FROM catalog_shops shops
  JOIN catalog_regions regions ON regions.id = shops.region_id
  WHERE shops.region_id = ?
  ORDER BY shops.name COLLATE NOCASE
`);
const getCatalogShopStmt = db.prepare(`
  SELECT shops.id, shops.name, shops.address, regions.id AS region_id, regions.name AS region
  FROM catalog_shops shops
  JOIN catalog_regions regions ON regions.id = shops.region_id
  WHERE shops.id = ?
`);
const insertCatalogShopStmt = db.prepare('INSERT INTO catalog_shops (region_id, name, address) VALUES (?, ?, ?)');
const insertCatalogShopIfMissingStmt = db.prepare('INSERT OR IGNORE INTO catalog_shops (region_id, name, address) VALUES (?, ?, ?)');
const updateCatalogShopStmt = db.prepare('UPDATE catalog_shops SET name = ?, address = ? WHERE id = ?');
const deleteCatalogShopStmt = db.prepare('DELETE FROM catalog_shops WHERE id = ?');
const hasCatalogMigrationStmt = db.prepare('SELECT 1 FROM catalog_migrations WHERE name = ?');
const insertCatalogMigrationStmt = db.prepare('INSERT INTO catalog_migrations (name) VALUES (?)');
const updateRecentShopRegionStmt = db.prepare('UPDATE recent_shops SET region = ? WHERE region = ?');
const updateRecentShopNameStmt = db.prepare('UPDATE recent_shops SET shop = ? WHERE region = ? AND shop = ?');
const deleteRecentShopRefsStmt = db.prepare('DELETE FROM recent_shops WHERE region = ? AND shop = ?');
const deleteRecentShopRegionRefsStmt = db.prepare('DELETE FROM recent_shops WHERE region = ?');

const initializeCatalog = db.transaction(() => {
  const existingRegions = listCatalogRegionsStmt.all();
  if (existingRegions.length) {
    return;
  }

  const regionIds = new Map();
  for (const shop of seedShops) {
    const regionName = shop.region || 'Республика Бурятия';
    let regionId = regionIds.get(regionName);
    if (!regionId) {
      regionId = insertCatalogRegionStmt.run(regionName).lastInsertRowid;
      regionIds.set(regionName, regionId);
    }
    insertCatalogShopStmt.run(regionId, shop.name, shop.address || '');
  }
});

initializeCatalog();

const applyCatalogMigrations = db.transaction(() => {
  const migrationName = '2026-06-add-buryatia-secondary-shops';
  if (hasCatalogMigrationStmt.get(migrationName)) {
    return;
  }

  let region = listCatalogRegionsStmt.all().find((item) => item.name === 'Республика Бурятия');
  if (!region) {
    const regionId = insertCatalogRegionStmt.run('Республика Бурятия').lastInsertRowid;
    region = { id: regionId };
  }

  const shopNames = [
    'АП-1',
    'МАГ-1',
    'МАГ-2',
    'МАГ-5',
    'МАГ-7',
    'МАГ-8',
    'МАГ-9',
    'МАГ-10',
    'МАГ-11',
    'МАГ-12',
    'Ф1',
    'Ф4'
  ];
  for (const shopName of shopNames) {
    insertCatalogShopIfMissingStmt.run(region.id, shopName, '');
  }

  insertCatalogMigrationStmt.run(migrationName);
});

applyCatalogMigrations();

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

function createMiniAppSession(token, userId, expiresAt) {
  const now = Date.now();
  insertMiniAppSessionStmt.run({
    token: String(token),
    userId: String(userId),
    createdAt: now,
    expiresAt: Number(expiresAt)
  });

  return {
    token: String(token),
    userId: String(userId),
    createdAt: now,
    expiresAt: Number(expiresAt),
    usedAt: null
  };
}

function getMiniAppSession(token) {
  const row = getMiniAppSessionStmt.get(String(token));
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at
  };
}

function markMiniAppSessionUsed(token) {
  const usedAt = Date.now();
  markMiniAppSessionUsedStmt.run({
    token: String(token),
    usedAt
  });
  return usedAt;
}

function deleteExpiredMiniAppSessions(now = Date.now()) {
  return deleteExpiredMiniAppSessionsStmt.run(Number(now)).changes;
}

function parseKsoScheduleRequest(row) {
  if (!row) {
    return null;
  }

  let entries = [];
  try {
    entries = JSON.parse(row.entries || '[]');
  } catch (error) {
    entries = [];
  }

  return {
    id: row.id,
    userId: row.user_id,
    fio: row.fio,
    month: row.month,
    requestType: row.request_type,
    status: row.status,
    entries,
    comment: row.comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    archivedAt: row.archived_at
  };
}

function saveKsoScheduleRequest(data) {
  const id = data.id || randomUUID();
  const payload = {
    id,
    userId: String(data.userId),
    fio: data.fio,
    month: data.month,
    requestType: data.requestType || 'month',
    status: data.status || 'draft',
    entries: JSON.stringify(data.entries || []),
    comment: data.comment || ''
  };

  if (data.id) {
    const updated = updateKsoScheduleRequestStmt.run(payload);
    if (updated.changes > 0) {
      return getKsoScheduleRequest(id);
    }
  }

  insertKsoScheduleRequestStmt.run(payload);
  return getKsoScheduleRequest(id);
}

function getKsoScheduleRequest(id) {
  return parseKsoScheduleRequest(getKsoScheduleRequestStmt.get(String(id)));
}

function listKsoScheduleRequests({ userId = null, statuses = null, limit = 100 } = {}) {
  return listKsoScheduleRequestsStmt.all(Number(limit))
    .map(parseKsoScheduleRequest)
    .filter((request) => request
      && (!userId || request.userId === String(userId))
      && (!statuses || statuses.includes(request.status)));
}

function reviewKsoScheduleRequest(id, status, reviewedBy, comment = '', entries = null) {
  const result = reviewKsoScheduleRequestStmt.run({
    id: String(id),
    status,
    reviewedBy: String(reviewedBy),
    comment,
    entries: entries ? JSON.stringify(entries) : null
  });

  return result.changes > 0 ? getKsoScheduleRequest(id) : null;
}

function archiveKsoScheduleRequest(id) {
  const result = archiveKsoScheduleRequestStmt.run({ id: String(id) });
  return result.changes > 0;
}

function updateApprovedKsoScheduleRequest(id, reviewedBy, entries, comment = '') {
  const result = updateApprovedKsoScheduleRequestStmt.run({
    id: String(id),
    reviewedBy: String(reviewedBy),
    entries: JSON.stringify(entries || []),
    comment
  });

  return result.changes > 0 ? getKsoScheduleRequest(id) : null;
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

function saveRecentFixation(userId, fixationId, data) {
  upsertRecentFixationStmt.run({
    userId: String(userId),
    fixationId: String(fixationId),
    data: JSON.stringify(data)
  });
}

function listRecentFixations(userId, limit = 5) {
  return listRecentFixationsStmt.all(String(userId), limit).map((row) => {
    let data = {};
    try {
      data = JSON.parse(row.data || '{}');
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Ошибка разбора JSON недавней фиксации:`, error);
    }

    return {
      fixationId: row.fixation_id,
      updatedAt: row.updated_at,
      data
    };
  });
}

function listCatalogRegions() {
  return listCatalogRegionsStmt.all();
}

function getCatalogRegion(regionId) {
  return getCatalogRegionStmt.get(Number(regionId)) || null;
}

function addCatalogRegion(name) {
  return Number(insertCatalogRegionStmt.run(String(name).trim()).lastInsertRowid);
}

function renameCatalogRegion(regionId, name) {
  const region = getCatalogRegion(regionId);
  const nextName = String(name).trim();
  if (!region) {
    return false;
  }

  const rename = db.transaction(() => {
    updateCatalogRegionStmt.run(nextName, Number(regionId));
    updateRecentShopRegionStmt.run(nextName, region.name);
  });
  rename();
  return true;
}

function deleteCatalogRegion(regionId) {
  const id = Number(regionId);
  const region = getCatalogRegion(id);
  if (!region) {
    return false;
  }
  if (countCatalogRegionShopsStmt.get(id).count > 0) {
    return false;
  }

  const remove = db.transaction(() => {
    deleteCatalogRegionStmt.run(id);
    deleteRecentShopRegionRefsStmt.run(region.name);
  });
  remove();
  return true;
}

function listCatalogShops() {
  return listCatalogShopsStmt.all().sort((left, right) => shopNameCollator.compare(left.name, right.name));
}

function listCatalogShopsByRegion(regionId) {
  return listCatalogShopsByRegionStmt
    .all(Number(regionId))
    .sort((left, right) => shopNameCollator.compare(left.name, right.name));
}

function getCatalogShop(shopId) {
  return getCatalogShopStmt.get(Number(shopId)) || null;
}

function addCatalogShop(regionId, name, address = '') {
  return Number(insertCatalogShopStmt.run(Number(regionId), String(name).trim(), String(address).trim()).lastInsertRowid);
}

function updateCatalogShop(shopId, name, address = '') {
  const shop = getCatalogShop(shopId);
  const nextName = String(name).trim();
  if (!shop) {
    return false;
  }

  const update = db.transaction(() => {
    updateCatalogShopStmt.run(nextName, String(address).trim(), Number(shopId));
    updateRecentShopNameStmt.run(nextName, shop.region, shop.name);
  });
  update();
  return true;
}

function deleteCatalogShop(shopId) {
  const shop = getCatalogShop(shopId);
  if (!shop) {
    return false;
  }

  const remove = db.transaction(() => {
    deleteCatalogShopStmt.run(Number(shopId));
    deleteRecentShopRefsStmt.run(shop.region, shop.name);
  });
  remove();
  return true;
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
  createMiniAppSession,
  getMiniAppSession,
  markMiniAppSessionUsed,
  deleteExpiredMiniAppSessions,
  saveKsoScheduleRequest,
  getKsoScheduleRequest,
  listKsoScheduleRequests,
  reviewKsoScheduleRequest,
  archiveKsoScheduleRequest,
  updateApprovedKsoScheduleRequest,
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
  saveRecentFixation,
  listRecentFixations,
  listCatalogRegions,
  getCatalogRegion,
  addCatalogRegion,
  renameCatalogRegion,
  deleteCatalogRegion,
  listCatalogShops,
  listCatalogShopsByRegion,
  getCatalogShop,
  addCatalogShop,
  updateCatalogShop,
  deleteCatalogShop,
  closeDb
};
