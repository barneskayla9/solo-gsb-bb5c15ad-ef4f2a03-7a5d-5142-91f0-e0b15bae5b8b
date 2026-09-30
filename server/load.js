'use strict';

const { unionIntervals } = require('./intervals');

/**
 * 负载引擎（纯函数，不读数据库），便于为"改接预演"构造虚拟配置。
 *
 * 输入：
 * - circuits：回路行数组（含 parent_id / rated_kw）
 * - devices：设备行数组
 * - periodsByDevice：deviceId -> [[startMs,endMs], ...]（原始时段，内部会再求并集）
 * - effectiveCircuitOf：可选 Map(deviceId -> circuitId)，改接预演时把某设备虚拟挂到新回路
 * - window：[fromMs, toMs]，裁剪返回区间；null 表示不裁剪
 *
 * 每个回路的负载 = 所有"运行中"的后代设备（设备接在该回路自身或任意后代回路上）功率之和。
 */
function computeLoads({ circuits, devices, periodsByDevice, effectiveCircuitOf = null, window = null }) {
  const byId = new Map(circuits.map((c) => [c.id, c]));

  // 祖先链：回路 -> 从自身到根的全部回路 id（沿 parent_id 上行）
  const ancestorChains = new Map();
  function chainOf(id) {
    if (ancestorChains.has(id)) return ancestorChains.get(id);
    const chain = [];
    let cur = id;
    const seen = new Set();
    while (cur !== null && cur !== undefined) {
      if (seen.has(cur)) {
        const err = new Error('回路树存在环路，无法汇总负载');
        err.code = 'CIRCULAR_TREE';
        throw err;
      }
      seen.add(cur);
      chain.push(cur);
      cur = byId.has(cur) ? byId.get(cur).parent_id : null;
    }
    ancestorChains.set(id, chain);
    return chain;
  }

  // 每回路的事件列表：[time, deltaPower, deviceId, startsHere]
  const eventsByCircuit = new Map(circuits.map((c) => [c.id, []]));
  for (const dev of devices) {
    const cid = effectiveCircuitOf && effectiveCircuitOf.has(dev.id)
      ? effectiveCircuitOf.get(dev.id)
      : dev.circuit_id;
    if (!byId.has(cid)) continue; // 虚拟配置不应出现；防御性跳过
    const raw = periodsByDevice.get(dev.id) || [];
    const intervals = unionIntervals(raw); // 同设备重叠时段只计一次
    if (intervals.length === 0) continue;
    const chain = chainOf(cid);
    for (const cid2 of chain) {
      const list = eventsByCircuit.get(cid2);
      for (const [s, e] of intervals) {
        list.push([s, dev.power_kw, dev.id, true, dev.name]);
        list.push([e, -dev.power_kw, dev.id, false, dev.name]);
      }
    }
  }

  const result = new Map();
  for (const c of circuits) {
    const rawTimeline = sweep(eventsByCircuit.get(c.id) || []);
    const timeline = window ? clampTimeline(rawTimeline, window[0], window[1]) : rawTimeline;
    let maxLoad = 0;
    let peak = null;
    const overload = [];
    for (const seg of timeline) {
      if (seg.load > maxLoad) {
        maxLoad = seg.load;
        peak = seg;
      }
      if (seg.load > c.rated_kw) overload.push(seg);
    }
    result.set(c.id, {
      circuitId: c.id,
      ratedKw: c.rated_kw,
      timeline,
      maxLoad,
      peak: maxLoad > 0
        ? { start: peak.start, end: peak.end, load: peak.load, deviceNames: peak.deviceNames }
        : null,
      overload,
    });
  }
  return result;
}

/** 扫描线：同一时刻先处理全部事件再切段，得到逐段恒定负载 */
function sweep(events) {
  if (events.length === 0) return [];
  events.sort((a, b) => a[0] - b[0]);
  const segments = [];
  const active = new Map(); // deviceId -> {power,name}
  let load = 0;
  let cursor = events[0][0];

  let i = 0;
  while (i < events.length) {
    const t = events[i][0];
    if (t > cursor) {
      segments.push(makeSegment(cursor, t, load, active));
    }
    // 处理 t 时刻的全部开关事件（左闭右开：起点加入、终点移出）
    while (i < events.length && events[i][0] === t) {
      const [, delta, devId, startsHere, devName] = events[i];
      if (startsHere) {
        active.set(devId, { power: delta, name: devName });
      } else {
        active.delete(devId);
      }
      load = round3(load + delta);
      i += 1;
    }
    cursor = t;
  }
  // 合并相邻且负载、活动设备集合完全相同的段（同一时刻多设备启停会产生零长度抖动，天然被规避）
  return mergeSame(segments);
}

function makeSegment(start, end, load, active) {
  const deviceIds = [...active.keys()].sort((a, b) => a - b);
  return {
    start,
    end,
    load: round3(load),
    deviceIds,
    deviceNames: deviceIds.map((id) => active.get(id).name),
  };
}

function mergeSame(segments) {
  const out = [];
  for (const seg of segments) {
    if (seg.end <= seg.start) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.end === seg.start &&
      prev.load === seg.load &&
      prev.deviceIds.length === seg.deviceIds.length &&
      prev.deviceIds.every((id, k) => id === seg.deviceIds[k])
    ) {
      prev.end = seg.end;
    } else {
      out.push({ ...seg, deviceIds: [...seg.deviceIds], deviceNames: [...seg.deviceNames] });
    }
  }
  return out;
}

/** 把全量时间线与 [from,to] 求交，窗口内无负载的前后缀补零段 */
function clampTimeline(segments, from, to) {
  if (to <= from) return [];
  const inside = [];
  for (const s of segments) {
    const start = Math.max(s.start, from);
    const end = Math.min(s.end, to);
    if (start < end) {
      inside.push({ ...s, start, end, deviceIds: [...s.deviceIds], deviceNames: [...s.deviceNames] });
    }
  }
  // 补零：窗口内无覆盖的时间段负载视为 0
  const withZeros = [];
  let cursor = from;
  for (const s of inside) {
    if (s.start > cursor) withZeros.push(zeroSegment(cursor, s.start));
    withZeros.push(s);
    cursor = s.end;
  }
  if (cursor < to) withZeros.push(zeroSegment(cursor, to));
  return withZeros;
}

function zeroSegment(start, end) {
  return { start, end, load: 0, deviceIds: [], deviceNames: [] };
}

/** 全部设备运行时段覆盖的最小包围窗口；无任何时段时回退到"明天 00:00–24:00" */
function defaultWindow(periodsByDevice) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const intervals of periodsByDevice.values()) {
    for (const [s, e] of intervals) {
      if (s < lo) lo = s;
      if (e > hi) hi = e;
    }
  }
  if (Number.isFinite(lo) && hi > lo) return [lo, hi];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const t0 = base.getTime() + 24 * 3600 * 1000;
  return [t0, t0 + 24 * 3600 * 1000];
}

function round3(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

module.exports = { computeLoads, defaultWindow, unionIntervals };
