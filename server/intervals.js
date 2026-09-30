'use strict';

/**
 * 一组左闭右开区间求并集（输入 [[start,end], ...]，end 严格大于 start）。
 * 相邻（a.end === b.start）与重叠都会合并。返回按起点排序的不相交区间。
 * 同一设备多个重叠时段只计一次，靠的就是这一步。
 */
function unionIntervals(intervals) {
  const sorted = intervals
    .filter(([s, e]) => s < e)
    .map(([s, e]) => [s, e])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

module.exports = { unionIntervals };
