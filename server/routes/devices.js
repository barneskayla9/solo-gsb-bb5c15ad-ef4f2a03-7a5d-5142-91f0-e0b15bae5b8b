'use strict';

const express = require('express');
const { listCircuits, listDevices, mutate, replacePeriods } = require('../repo');
const {
  parseName,
  parsePositiveKw,
  parsePeriods,
  parseCircuitId,
  requireCircuitExists,
  ApiError,
} = require('../validation');

function router(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    res.json({ devices: listDevices(db) });
  });

  // 新增设备：指定接入回路、额定功率与初始运行时段
  r.post('/', (req, res) => {
    const body = req.body || {};
    const name = parseName(body, 'name', '设备名称');
    const powerKw = parsePositiveKw(body, 'powerKw', '设备功率');
    const circuits = listCircuits(db);
    const circuitId = parseCircuitId(body.circuitId ?? body.circuit_id, new Set(circuits.map((c) => c.id)));
    requireCircuitExists(circuits.find((c) => c.id === circuitId), circuitId);
    const periods = parsePeriods(body.periods);

    const run = mutate(db, () => {
      const id = db
        .prepare('INSERT INTO devices(circuit_id, name, power_kw) VALUES (?, ?, ?)')
        .run(circuitId, name, powerKw).lastInsertRowid;
      replacePeriods(db, id, periods);
      return id;
    });
    const id = run();
    res.status(201).json({ id });
  });

  // 修改设备：改名 / 改功率 / 整体替换运行时段。
  // 注意：不允许通过此接口直接改接回路——改接必须走 /moves 预演+确认流程。
  r.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    if (!device) throw new ApiError(404, 'NOT_FOUND', `设备不存在（id=${id}）`);
    const body = req.body || {};

    if (body.circuitId !== undefined || body.circuit_id !== undefined) {
      throw new ApiError(
        400,
        'MOVE_REQUIRES_REHEARSAL',
        '设备改接必须先预演再确认，请使用“改接”功能（POST /api/moves）'
      );
    }

    const fields = [];
    const values = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(parseName(body, 'name', '设备名称'));
    }
    if (body.powerKw !== undefined) {
      fields.push('power_kw = ?');
      values.push(parsePositiveKw(body, 'powerKw', '设备功率'));
    }
    let newPeriods = null;
    if (body.periods !== undefined) newPeriods = parsePeriods(body.periods);
    if (fields.length === 0 && newPeriods === null) {
      throw new ApiError(400, 'NO_CHANGE', '没有需要修改的字段');
    }

    const run = mutate(db, () => {
      if (fields.length > 0) {
        values.push(id);
        db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }
      if (newPeriods !== null) replacePeriods(db, id, newPeriods);
    });
    run();
    res.json({ ok: true });
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(id);
    if (!device) throw new ApiError(404, 'NOT_FOUND', `设备不存在（id=${id}）`);
    mutate(db, () => db.prepare('DELETE FROM devices WHERE id = ?').run(id))();
    res.json({ ok: true });
  });

  return r;
}

module.exports = router;
