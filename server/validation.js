'use strict';

const { ApiError } = require('./errors');

/** 读取必填字段 */
function requireField(body, key, label) {
  const v = body ? body[key] : undefined;
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new ApiError(400, 'MISSING_FIELD', `${label || key}不能为空`);
  }
  return v;
}

/** 名称：去首尾空格，限 1..64 字符 */
function parseName(body, key, label) {
  const raw = requireField(body, key, label);
  const name = String(raw).trim();
  if (name.length === 0) throw new ApiError(400, 'INVALID_NAME', `${label || key}不能为空`);
  if (name.length > 64) throw new ApiError(400, 'INVALID_NAME', `${label || key}长度不能超过 64 个字符`);
  return name;
}

/** 功率必须为有限的、严格为正的数值 */
function parsePositiveKw(body, key, label) {
  const raw = requireField(body, key, label);
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(n)) {
    throw new ApiError(400, 'INVALID_POWER', `${label || key}必须是数字`);
  }
  if (n <= 0) {
    throw new ApiError(400, 'NON_POSITIVE_POWER', `${label || key}必须为正数（功率必须大于 0）`, {
      field: key,
      received: raw,
    });
  }
  if (n > 1000000) {
    throw new ApiError(400, 'INVALID_POWER', `${label || key}数值过大`);
  }
  return Math.round(n * 1000) / 1000;
}

/**
 * 把时间输入解析为毫秒时间戳。
 * 接受：数字（毫秒）、ISO 8601 字符串（含 datetime-local 提交的 "YYYY-MM-DDTHH:mm"）。
 */
function parseTimeMs(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ApiError(400, 'INVALID_TIME', `${label}不能为空`);
  }
  let ms;
  if (typeof value === 'number' || /^-?\d+$/.test(String(value).trim())) {
    ms = Number(value);
  } else {
    ms = Date.parse(value);
  }
  if (!Number.isFinite(ms)) {
    throw new ApiError(400, 'INVALID_TIME', `${label}不是合法时间，应为 ISO 8601 或毫秒时间戳`, { received: value });
  }
  return ms;
}

/**
 * 解析设备运行时段数组 [{start,end}]：
 * - 时段左闭右开，且起点必须严格早于终点
 * - 允许同一设备多个时段相互重叠（负载计算时按并集只计一次），这里只做合法性校验
 * 返回归一化并按起点排序的 [startMs, endMs] 数组
 */
function parsePeriods(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, 'INVALID_PERIODS', '运行时段必须是数组');
  }
  const out = raw.map((p, i) => {
    if (!p || typeof p !== 'object') {
      throw new ApiError(400, 'INVALID_PERIOD', `第 ${i + 1} 个时段格式不正确`);
    }
    const start = parseTimeMs(p.start ?? p.start_ms, `第 ${i + 1} 个时段起点`);
    const end = parseTimeMs(p.end ?? p.end_ms, `第 ${i + 1} 个时段终点`);
    if (!(start < end)) {
      throw new ApiError(
        400,
        'INVALID_PERIOD_RANGE',
        `第 ${i + 1} 个时段非法：左闭右开时段要求起点严格早于终点`,
        { index: i, start, end }
      );
    }
    return [start, end];
  });
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

/** 可选父回路：null/空串表示根；否则必须为正整数 */
function parseParentId(body, allCircuitIds) {
  const raw = body.parent_id ?? body.parentId;
  return parseNullableId(raw, allCircuitIds, '上级回路 id');
}

/** 设备接入/改接的目标回路 id：必填 */
function parseCircuitId(value, allCircuitIds, label = '接入回路') {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ApiError(400, 'MISSING_FIELD', `必须指定${label}`);
  }
  return parseNullableId(value, allCircuitIds, label);
}

function parseNullableId(raw, allCircuitIds, label) {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'INVALID_PARENT', `${label} id 必须为正整数`);
  }
  if (allCircuitIds && !allCircuitIds.has(id)) {
    throw new ApiError(400, 'MISSING_CIRCUIT', `${label}不存在（id=${id}），请先创建该回路`, { circuitId: id });
  }
  return id;
}

/** 校验目标回路存在（用于设备接入/改接） */
function requireCircuitExists(circuit, id) {
  if (!circuit) {
    throw new ApiError(400, 'MISSING_CIRCUIT', `回路不存在（id=${id}），可能已被删除`, { circuitId: id });
  }
}

/**
 * 检测把回路 parentId 改为 newParentId 是否构成环（含把自己设为自己父级）。
 * existingParent：当前 parent_id（编辑自身时跳过原边）
 */
function assertNoCycle(circuitById, nodeId, newParentId) {
  if (newParentId === null) return;
  if (newParentId === nodeId) {
    throw new ApiError(400, 'CIRCULAR_TREE', '不能把回路挂到自身下面，这会形成环路');
  }
  let cur = newParentId;
  const seen = new Set();
  while (cur !== null && cur !== undefined) {
    if (cur === nodeId) {
      throw new ApiError(400, 'CIRCULAR_TREE', '该挂接会形成环路：目标回路是当前回路的后代');
    }
    if (seen.has(cur)) {
      // 库里本不该有环，防御性处理
      throw new ApiError(400, 'CIRCULAR_TREE', '回路树中检测到已有环路，请检查数据');
    }
    seen.add(cur);
    const node = circuitById.get(cur);
    if (!node) {
      throw new ApiError(400, 'MISSING_CIRCUIT', `上级回路不存在（id=${cur}）`);
    }
    cur = node.parent_id;
  }
}

module.exports = {
  ApiError,
  requireField,
  parseName,
  parsePositiveKw,
  parseTimeMs,
  parsePeriods,
  parseParentId,
  parseCircuitId,
  requireCircuitExists,
  assertNoCycle,
};
