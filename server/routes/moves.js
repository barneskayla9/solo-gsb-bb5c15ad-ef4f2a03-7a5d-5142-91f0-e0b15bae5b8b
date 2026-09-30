'use strict';

const crypto = require('crypto');
const express = require('express');
const { listCircuits, loadContext, mutate, getConfigVersion } = require('../repo');
const { parseCircuitId, ApiError } = require('../validation');

/**
 * 设备改接：先 POST 预演（不写配置），再 POST /:token/confirm 确认落库。
 * 预演快照带 config_version；预演后若配置发生任何变化，确认将被拒绝，必须重新预演。
 */
function router(db) {
  const r = express.Router();

  // 创建预演
  r.post('/', (req, res) => {
    const body = req.body || {};
    const deviceId = parseId(body.deviceId, '设备 id');
    const circuitIds = new Set(listCircuits(db).map((c) => c.id));
    const targetCircuitId = parseCircuitId(
      body.targetCircuitId ?? body.target_circuit_id,
      circuitIds,
      '目标回路'
    );
    const device = db.prepare('SELECT id, circuit_id, name FROM devices WHERE id = ?').get(deviceId);
    if (!device) throw new ApiError(404, 'NOT_FOUND', `设备不存在（id=${deviceId}）`);
    if (device.circuit_id === targetCircuitId) {
      throw new ApiError(400, 'NO_CHANGE', '设备已经接在该回路上，无需改接');
    }

    const ctx = loadContext(db);
    const chainOf = (cid) => {
      const chain = [];
      let cur = cid;
      while (cur !== null && cur !== undefined) {
        chain.push(cur);
        const c = ctx.circuits.find((x) => x.id === cur);
        cur = c ? c.parent_id : null;
      }
      return chain;
    };
    const affectedIds = [...new Set([...chainOf(device.circuit_id), ...chainOf(targetCircuitId)])];

    // 用"虚拟挂接映射"重算，配置本身不做任何改动
    const virtual = new Map([[deviceId, targetCircuitId]]);
    const ctxAfter = loadContext(db, { effectiveCircuitOf: virtual, window: ctx.window });

    const nameOf = new Map(ctx.circuits.map((c) => [c.id, c.name]));
    const affected = affectedIds
      .map((cid) => serializeAffected(cid, nameOf.get(cid), ctx.loads.get(cid), ctxAfter.loads.get(cid)))
      .sort((a, b) => b.after.overload.length - a.after.overload.length || a.id - b.id);

    const violations = affected
      .filter((a) => a.after.overload.length > 0)
      .map((a) => ({
        circuitId: a.id,
        circuitName: a.name,
        ratedKw: a.ratedKw,
        intervals: a.after.overload.map((o) => ({
          start: o.start,
          end: o.end,
          peakKw: o.peakKw,
          deviceNames: o.deviceNames,
        })),
      }));

    const feasible = violations.length === 0;
    const configVersion = getConfigVersion(db);
    const token = crypto.randomUUID();
    // 同一设备仅保留最新一个待确认预演，旧预演自动作废
    db.prepare('DELETE FROM move_rehearsals WHERE device_id = ?').run(deviceId);
    db.prepare(
      `INSERT INTO move_rehearsals(token, device_id, from_circuit_id, to_circuit_id, config_version, feasible)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, deviceId, device.circuit_id, targetCircuitId, configVersion, feasible ? 1 : 0);

    res.status(200).json({
      token,
      configVersion,
      feasible,
      window: { from: ctx.window[0], to: ctx.window[1] },
      move: {
        deviceId,
        deviceName: device.name,
        fromCircuitId: device.circuit_id,
        fromCircuitName: nameOf.get(device.circuit_id),
        toCircuitId: targetCircuitId,
        toCircuitName: nameOf.get(targetCircuitId),
      },
      violations,
      affected,
      message: feasible
        ? '预演通过：改接后所有祖先回路在全部时段均不超额，可确认改接。'
        : '预演被拒绝：改接后存在祖先回路超额，已指出回路、时段与峰值。',
    });
  });

  // 查询预演（前端恢复用）
  r.get('/:token', (req, res) => {
    const row = getRehearsal(db, req.params.token);
    res.json({
      token: row.token,
      deviceId: row.device_id,
      fromCircuitId: row.from_circuit_id,
      toCircuitId: row.to_circuit_id,
      configVersion: row.config_version,
      feasible: !!row.feasible,
      stale: row.config_version !== getConfigVersion(db),
      currentVersion: getConfigVersion(db),
    });
  });

  // 作废预演
  r.delete('/:token', (req, res) => {
    db.prepare('DELETE FROM move_rehearsals WHERE token = ?').run(req.params.token);
    res.json({ ok: true });
  });

  // 确认改接：必须通过预演、目标未变、配置版本未变
  r.post('/:token/confirm', (req, res) => {
    const row = getRehearsal(db, req.params.token);
    if (!row.feasible) {
      throw new ApiError(409, 'REHEARSAL_INFEASIBLE', '该预演因超额未通过，不能确认改接');
    }
    const currentVersion = getConfigVersion(db);
    if (row.config_version !== currentVersion) {
      throw new ApiError(
        409,
        'REHEARSAL_STALE',
        `预演后配置已变化（版本 ${row.config_version} → ${currentVersion}），确认已失效，请重新预演`,
        { rehearsalVersion: row.config_version, currentVersion }
      );
    }
    const device = db.prepare('SELECT circuit_id FROM devices WHERE id = ?').get(row.device_id);
    if (!device) {
      throw new ApiError(404, 'NOT_FOUND', '待改接的设备已不存在');
    }
    if (device.circuit_id !== row.from_circuit_id) {
      throw new ApiError(
        409,
        'REHEARSAL_STALE',
        '设备在预演后已被改接到其他回路，确认已失效，请重新预演'
      );
    }
    if (!db.prepare('SELECT 1 FROM circuits WHERE id = ?').get(row.to_circuit_id)) {
      throw new ApiError(404, 'MISSING_CIRCUIT', '目标回路已不存在，请重新预演');
    }

    const run = mutate(db, () => {
      db.prepare('UPDATE devices SET circuit_id = ? WHERE id = ?').run(row.to_circuit_id, row.device_id);
      db.prepare('DELETE FROM move_rehearsals WHERE token = ?').run(row.token);
    });
    run();
    res.json({ ok: true, deviceId: row.device_id, circuitId: row.to_circuit_id, configVersion: getConfigVersion(db) });
  });

  return r;
}

function getRehearsal(db, token) {
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) {
    throw new ApiError(404, 'NOT_FOUND', '预演不存在或已失效');
  }
  const row = db.prepare('SELECT * FROM move_rehearsals WHERE token = ?').get(token);
  if (!row) throw new ApiError(404, 'NOT_FOUND', '预演不存在或已失效（可能已确认或被作废）');
  return row;
}

function parseId(raw, label) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'INVALID_ID', `${label}必须为正整数`);
  }
  return id;
}

function serializeAffected(circuitId, name, before, after) {
  return {
    id: circuitId,
    name,
    ratedKw: before.ratedKw,
    before: summarize(before),
    after: summarize(after),
  };
}

function summarize(r) {
  return {
    maxLoad: r.maxLoad,
    loadRatio: r.maxLoad / r.ratedKw,
    overloaded: r.overload.length > 0,
    peak: r.peak,
    overload: r.overload.map((seg) => ({
      start: seg.start,
      end: seg.end,
      peakKw: seg.load,
      deviceNames: seg.deviceNames,
    })),
    timeline: r.timeline,
  };
}

module.exports = router;
