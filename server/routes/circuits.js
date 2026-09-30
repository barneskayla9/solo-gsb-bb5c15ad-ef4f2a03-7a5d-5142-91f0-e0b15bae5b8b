'use strict';

const express = require('express');
const { listCircuits, mutate, getConfigVersion } = require('../repo');
const { parseName, parsePositiveKw, parseParentId, assertNoCycle, ApiError } = require('../validation');

function router(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    res.json({ configVersion: getConfigVersion(db), circuits: listCircuits(db) });
  });

  // 新增回路（上级可空 => 根/配电箱）
  r.post('/', (req, res) => {
    const body = req.body || {};
    const name = parseName(body, 'name', '回路名称');
    const ratedKw = parsePositiveKw(body, 'ratedKw', '额定功率');
    const all = new Set(listCircuits(db).map((c) => c.id));
    const parentId = parseParentId(body, all);

    const run = mutate(db, () =>
      db.prepare('INSERT INTO circuits(parent_id, name, rated_kw, position) VALUES (?, ?, ?, ?)').run(
        parentId,
        name,
        ratedKw,
        nextPosition(db, parentId)
      )
    );
    const info = run();
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // 修改回路（改名 / 调额定功率 / 调整挂接）
  r.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const circuits = listCircuits(db);
    // 归一化为 snake_case，供环路检查与数据库更新共用
    const byId = new Map(
      circuits.map((c) => [c.id, { id: c.id, parent_id: c.parentId, name: c.name, rated_kw: c.ratedKw }])
    );
    const target = byId.get(id);
    if (!target) throw new ApiError(404, 'NOT_FOUND', `回路不存在（id=${id}）`);

    const body = req.body || {};
    const fields = [];
    const values = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(parseName(body, 'name', '回路名称'));
    }
    if (body.ratedKw !== undefined) {
      fields.push('rated_kw = ?');
      values.push(parsePositiveKw(body, 'ratedKw', '额定功率'));
    }
    const parentProvided = body.parentId !== undefined || body.parent_id !== undefined;
    let newParentId = target.parentId;
    if (parentProvided) {
      const rawBody = { parent_id: body.parentId !== undefined ? body.parentId : body.parent_id };
      newParentId = parseParentId(rawBody, new Set(circuits.map((c) => c.id)));
      if (newParentId !== target.parentId) assertNoCycle(byId, id, newParentId);
      fields.push('parent_id = ?');
      values.push(newParentId);
    }
    if (fields.length === 0) throw new ApiError(400, 'NO_CHANGE', '没有需要修改的字段');

    values.push(id);
    mutate(db, () => db.prepare(`UPDATE circuits SET ${fields.join(', ')} WHERE id = ?`).run(...values))();
    res.json({ ok: true });
  });

  // 删除回路：仍有下级回路或挂接设备时拒绝（保证不留下悬挂引用）
  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const target = listCircuits(db).find((c) => c.id === id);
    if (!target) throw new ApiError(404, 'NOT_FOUND', `回路不存在（id=${id}）`);

    const child = db.prepare('SELECT id FROM circuits WHERE parent_id = ? LIMIT 1').get(id);
    if (child) {
      throw new ApiError(409, 'CIRCUIT_HAS_CHILDREN', '该回路下仍有下级回路，请先删除或移走下级回路', {
        childId: child.id,
      });
    }
    const dev = db.prepare('SELECT id FROM devices WHERE circuit_id = ? LIMIT 1').get(id);
    if (dev) {
      throw new ApiError(409, 'CIRCUIT_HAS_DEVICES', '该回路上仍接有设备，请先删除或改接设备', {
        deviceId: dev.id,
      });
    }
    mutate(db, () => db.prepare('DELETE FROM circuits WHERE id = ?').run(id))();
    res.json({ ok: true });
  });

  return r;
}

function nextPosition(db, parentId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM circuits WHERE parent_id IS ?')
    .get(parentId);
  return row.p;
}

module.exports = router;
