'use strict';

const express = require('express');
const { loadContext, getConfigVersion } = require('../repo');
const { parseTimeMs, ApiError } = require('../validation');

/**
 * 计算并返回全量排演数据：
 * GET /api/analysis?from=<ISO>&to=<ISO> （from/to 可省略，默认覆盖全部运行时段）
 */
function router(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    let window = null;
    if (req.query.from !== undefined || req.query.to !== undefined) {
      const from = parseTimeMs(req.query.from, '时间窗口起点');
      const to = parseTimeMs(req.query.to, '时间窗口终点');
      if (!(from < to)) {
        throw new ApiError(400, 'INVALID_WINDOW', '时间窗口非法：起点必须早于终点', { from, to });
      }
      window = [from, to];
    }
    const ctx = loadContext(db, { window });
    const circuits = ctx.circuits.map((c) => serializeCircuitResult(c, ctx.loads.get(c.id)));
    const allOverloaded = circuits.some((c) => c.overload.length > 0);
    res.json({
      configVersion: getConfigVersion(db),
      window: { from: ctx.window[0], to: ctx.window[1] },
      allOverloaded,
      circuits,
    });
  });

  return r;
}

function serializeCircuitResult(c, r) {
  return {
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
    ratedKw: c.rated_kw,
    maxLoad: r.maxLoad,
    loadRatio: r.maxLoad / c.rated_kw,
    overloaded: r.overload.length > 0,
    peak: r.peak,
    timeline: r.timeline,
    overload: r.overload.map((seg) => ({
      start: seg.start,
      end: seg.end,
      peakKw: seg.load,
      deviceNames: seg.deviceNames,
    })),
  };
}

module.exports = router;
