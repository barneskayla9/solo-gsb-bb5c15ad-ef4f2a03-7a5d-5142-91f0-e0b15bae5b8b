'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { ApiError } = require('./errors');

/**
 * 打开并初始化 SQLite 数据库。
 * - 外键约束开启：删除回路时其下级回路/设备的引用完整性由数据库保护
 * - 表结构首次启动时自动建立，并写入一份演示数据（仅当库为空）
 */
function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
  CREATE TABLE IF NOT EXISTS circuits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id   INTEGER REFERENCES circuits(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL UNIQUE,
    rated_kw    REAL NOT NULL CHECK (rated_kw > 0),
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    circuit_id  INTEGER NOT NULL REFERENCES circuits(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL UNIQUE,
    power_kw    REAL NOT NULL CHECK (power_kw > 0),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS periods (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    CHECK (start_ms < end_ms)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 改接预演结果暂存：确认时校验 config_version 是否仍与预演时一致
  CREATE TABLE IF NOT EXISTS move_rehearsals (
    token            TEXT PRIMARY KEY,
    device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    from_circuit_id  INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
    to_circuit_id    INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
    config_version   INTEGER NOT NULL,
    feasible         INTEGER NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  initConfigVersion(db);
  seedIfEmpty(db);
  return db;
}

function initConfigVersion(db) {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES('config_version', '0')
     ON CONFLICT(key) DO NOTHING`
  ).run();
}

/** 任一配置写操作后调用：使旧的改接预演失效 */
function bumpConfigVersion(db) {
  db.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key='config_version'`).run();
}

function getConfigVersion(db) {
  return Number(db.prepare(`SELECT value FROM meta WHERE key='config_version'`).get().value);
}

/**
 * 首次启动写入演示配电结构，便于开箱即用看到负载与超限：
 * 主配电箱 -> 照明柜 / 动力柜（动力柜下 4 条末级回路）。
 */
function seedIfEmpty(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM circuits').get().n;
  if (count > 0) return;

  const tx = db.transaction(() => {
    const insCircuit = db.prepare(
      'INSERT INTO circuits(parent_id, name, rated_kw, position) VALUES (?, ?, ?, ?)'
    );
    const main = insCircuit.run(null, '主配电箱', 50, 0).lastInsertRowid;
    const lightCab = insCircuit.run(main, '照明柜', 15, 0).lastInsertRowid;
    const powerCab = insCircuit.run(main, '动力柜', 30, 1).lastInsertRowid;

    const lightStage = insCircuit.run(lightCab, '舞台灯光回路', 8, 0).lastInsertRowid;
    const lightAisle = insCircuit.run(lightCab, '通道照明回路', 4, 1).lastInsertRowid;
    const audio = insCircuit.run(powerCab, '音响回路', 9, 0).lastInsertRowid;
    const led = insCircuit.run(powerCab, 'LED屏回路', 12, 1).lastInsertRowid;
    const rig = insCircuit.run(powerCab, '舞台机械回路', 7, 2).lastInsertRowid;
    const spare = insCircuit.run(powerCab, '备用动力回路', 5, 3).lastInsertRowid;

    const D = 24 * 3600 * 1000;
    // 以明天 00:00（本地时区）为排演基准日
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const t0 = base.getTime() + D;
    const h = (hh, mm = 0) => t0 + (hh * 60 + mm) * 60000;

    addDevice(db, '面光阵列', lightStage, 5.2, [[h(18), h(23)]]);
    addDevice(db, '电脑摇头灯组', lightStage, 4.0, [[h(19), h(22, 30)], [h(20), h(21, 30)]]); // 段内重叠
    addDevice(db, '观众厅通道灯', lightAisle, 1.2, [[h(17), h(23, 30)]]);
    addDevice(db, '主扩声音响', audio, 6.5, [[h(16), h(23)]]);
    addDevice(db, '返听音响', audio, 3.0, [[h(18), h(22, 30)]]);
    addDevice(db, '主屏LED', led, 8.0, [[h(17), h(23)]]);
    addDevice(db, '侧屏LED', led, 5.0, [[h(18), h(22)]]);
    addDevice(db, '升降机械', rig, 6.0, [[h(8), h(9)], [h(20), h(21)]]);
    bumpConfigVersion(db);
  });
  tx();
}

function addDevice(db, name, circuitId, power, periods) {
  const id = db.prepare(
    'INSERT INTO devices(circuit_id, name, power_kw) VALUES (?, ?, ?)'
  ).run(circuitId, name, power).lastInsertRowid;
  const insP = db.prepare('INSERT INTO periods(device_id, start_ms, end_ms) VALUES (?, ?, ?)');
  for (const [s, e] of periods) insP.run(id, s, e);
  return id;
}

/** 把数据库约束错误翻译成带中文说明的 ApiError */
function translateDbError(err) {
  if (!(err && typeof err.message === 'string')) throw err;
  if (/UNIQUE constraint failed: circuits\.name/.test(err.message)) {
    throw new ApiError(409, 'NAME_DUPLICATED', '回路名称已存在，请换一个名称');
  }
  if (/UNIQUE constraint failed: devices\.name/.test(err.message)) {
    throw new ApiError(409, 'NAME_DUPLICATED', '设备名称已存在，请换一个名称');
  }
  if (/FOREIGN KEY constraint failed/.test(err.message)) {
    throw new ApiError(400, 'BAD_REFERENCE', '引用的回路或设备不存在（可能已被删除）');
  }
  throw err;
}

module.exports = { openDb, bumpConfigVersion, getConfigVersion, translateDbError };
