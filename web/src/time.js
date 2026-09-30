/** 时间工具：后端统一用毫秒时间戳；表单使用浏览器本地时区的 datetime-local */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** ms -> "YYYY-MM-DDTHH:mm"（datetime-local 控件值，本地时区，精确到分钟） */
export function toLocalInput(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" -> ms；空串返回 null */
export function fromLocalInput(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

/** ms -> "MM-DD HH:mm" */
export function fmtShort(ms) {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ms -> "HH:mm"（同一天时用） */
export function fmtHM(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 时段展示："09:00–12:30"，跨日时加日期前缀 */
export function fmtPeriod(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  const sameDay =
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay) return `${fmtHM(start)}–${fmtHM(end)}`;
  return `${fmtShort(start)} → ${fmtShort(end)}`;
}

/** 单设备时段的友好校验，提交前在前端先挡一层 */
export function validatePeriod(p) {
  if (!p.start || !p.end) return '时段的起点和终点都必须填写';
  const s = Date.parse(p.start);
  const e = Date.parse(p.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '时段时间格式不正确';
  if (!(s < e)) return '时段必须左闭右开：起点要严格早于终点';
  return null;
}

/** 构造以"明天 00:00"为基准日的时间输入值 */
export function defaultDayInput(offsetDays = 1) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const ms = d.getTime();
  return { startInput: toLocalInput(ms + 18 * 3600000), endInput: toLocalInput(ms + 22 * 3600000) };
}
