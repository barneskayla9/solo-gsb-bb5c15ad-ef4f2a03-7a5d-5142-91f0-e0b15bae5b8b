'use strict';

const { bumpConfigVersion, getConfigVersion, translateDbError } = require('./db');
const { computeLoads, defaultWindow } = require('./load');
const { ApiError } = require('./errors');

function listCircuits(db) {
  return db.prepare(
    'SELECT id, parent_id AS parentId, name, rated_kw AS ratedKw, position FROM circuits ORDER BY position, id'
  ).all();
}

function listDevices(db) {
  const devs = db.prepare(
    'SELECT id, circuit_id AS circuitId, name, power_kw AS powerKw FROM devices ORDER BY id'
  ).all();
  const periods = db.prepare(
    'SELECT id, device_id AS deviceId, start_ms AS startMs, end_ms AS endMs FROM periods ORDER BY start_ms'
  ).all();
  const byDevice = new Map(devs.map((d) => [d.id, []]));
  for (const p of periods) {
    if (byDevice.has(p.deviceId)) {
      byDevice.get(p.deviceId).push({ id: p.id, startMs: p.startMs, endMs: p.endMs });
    }
  }
  for (const d of devs) d.periods = byDevice.get(d.id) || [];
  return devs;
}

/** 组装负载引擎所需的内部行结构 */
function loadContext(db, { effectiveCircuitOf = null, window = null } = {}) {
  const circuits = db.prepare(
    'SELECT id, parent_id, name, rated_kw FROM circuits'
  ).all();
  const devices = db.prepare(
    'SELECT id, circuit_id, name, power_kw FROM devices'
  ).all();
  const periodsRows = db.prepare('SELECT device_id, start_ms, end_ms FROM periods').all();
  const periodsByDevice = new Map(devices.map((d) => [d.id, []]));
  for (const r of periodsRows) {
    if (periodsByDevice.has(r.device_id)) periodsByDevice.get(r.device_id).push([r.start_ms, r.end_ms]);
  }
  const win = window || defaultWindow(periodsByDevice);
  let loads;
  try {
    loads = computeLoads({ circuits, devices, periodsByDevice, effectiveCircuitOf, window: win });
  } catch (e) {
    if (e && e.code === 'CIRCULAR_TREE') {
      throw new ApiError(400, 'CIRCULAR_TREE', e.message);
    }
    throw e;
  }
  return { circuits, devices, periodsByDevice, window: win, loads };
}

/** 在一个事务中执行配置写操作：异常即整体回滚，成功后推进配置版本号 */
function mutate(db, fn) {
  const tx = db.transaction((...args) => fn(...args));
  return (...args) => {
    try {
      const out = tx(...args);
      bumpConfigVersion(db);
      return out;
    } catch (e) {
      translateDbError(e);
    }
  };
}

function replacePeriods(db, deviceId, intervals) {
  const del = db.prepare('DELETE FROM periods WHERE device_id = ?');
  const ins = db.prepare('INSERT INTO periods(device_id, start_ms, end_ms) VALUES (?, ?, ?)');
  del.run(deviceId);
  for (const [s, e] of intervals) ins.run(deviceId, s, e);
}

module.exports = {
  listCircuits,
  listDevices,
  loadContext,
  mutate,
  replacePeriods,
  getConfigVersion,
};
