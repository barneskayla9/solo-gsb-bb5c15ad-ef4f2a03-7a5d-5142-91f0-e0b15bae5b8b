import React, { useMemo, useState } from 'react';
import { fmtHM, fmtShort, fmtPeriod } from '../time.js';

const W = 1000;
const H = 64;
const PAD_TOP = 8;

/**
 * 单回路负载时间轴（SVG 阶梯面积图）：
 * - 每段按该时段恒定负载绘制成矩形阶梯；超限段填充红色
 * - 虚线为额定功率
 * - 悬停显示时段、负载与正在运行的设备
 * - 下方 HTML 时间刻度（等间隔）
 */
export default function LoadChart({ circuit, window, showOverloadStrip = true }) {
  const [tip, setTip] = useState(null);
  const { timeline, ratedKw, maxLoad } = circuit;

  const scale = useMemo(() => {
    const yMax = Math.max(ratedKw * 1.15, maxLoad * 1.05, 0.001);
    const span = Math.max(1, window.to - window.from);
    const x = (ms) => ((ms - window.from) / span) * W;
    const y = (kw) => H - PAD_TOP - (kw / yMax) * (H - PAD_TOP - 4);
    return { x, y, yMax };
  }, [window, ratedKw, maxLoad]);

  const areaPath = useMemo(() => {
    if (!timeline.length) return '';
    let d = `M 0 ${H - PAD_TOP}`;
    let cursor = window.from;
    for (const s of timeline) {
      d += ` L ${scale.x(Math.max(s.start, cursor)).toFixed(2)} ${(H - PAD_TOP).toFixed(2)}`;
      d += ` L ${scale.x(s.start).toFixed(2)} ${scale.y(s.load).toFixed(2)}`;
      d += ` L ${scale.x(s.end).toFixed(2)} ${scale.y(s.load).toFixed(2)}`;
      cursor = s.end;
    }
    d += ` L ${W} ${H - PAD_TOP} Z`;
    return d;
  }, [timeline, scale, window.from]);

  const ticks = useMemo(() => buildTicks(window.from, window.to), [window]);

  return (
    <div className="chart">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setTip(null)}
      >
        {/* 额定功率虚线 */}
        <line
          x1="0" x2={W}
          y1={scale.y(ratedKw)} y2={scale.y(ratedKw)}
          stroke="#e0a637" strokeWidth="1.4" strokeDasharray="7 5"
          vectorEffect="non-scaling-stroke"
        />
        {/* 负载面积（安全部分） */}
        <path d={areaPath} fill="rgba(77,163,255,0.30)" stroke="#4da3ff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {/* 超限红带 */}
        {timeline.filter((s) => s.load > ratedKw).map((s, i) => (
          <rect
            key={`ov-${i}`}
            x={scale.x(s.start)} y={scale.y(s.load)}
            width={Math.max(1, scale.x(s.end) - scale.x(s.start))}
            height={(H - PAD_TOP) - scale.y(s.load)}
            fill="rgba(240,95,88,0.42)"
            stroke="#f05f58" strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* 悬停热区 */}
        {timeline.map((s, i) => (
          <rect
            key={`hit-${i}`}
            x={scale.x(s.start)} y="0"
            width={Math.max(2, scale.x(s.end) - scale.x(s.start))}
            height={H}
            fill="transparent"
            onMouseMove={(e) => setTip({ evt: e, seg: s, over: s.load > ratedKw })}
          />
        ))}
      </svg>

      <div className="chart-ticks">
        {ticks.map((t, i) => (
          <span key={i} style={{ left: `${((t - window.from) / (window.to - window.from)) * 100}%` }}>
            {fmtTick(t, ticks[i - 1])}
          </span>
        ))}
      </div>

      {showOverloadStrip && circuit.overload.length > 0 && (
        <div className="overload-strip">
          {circuit.overload.map((o, i) => (
            <span className="ov-tag" key={i}>
              {fmtPeriod(o.start, o.end)}　峰值 {fmtKw(o.peakKw)} / {fmtKw(ratedKw)} kW
            </span>
          ))}
        </div>
      )}

      {tip && <Tip tip={tip} ratedKw={ratedKw} />}
    </div>
  );
}

function Tip({ tip, ratedKw }) {
  const { evt, seg, over } = tip;
  return (
    <div
      className="svg-tip"
      style={{ left: Math.min(evt.clientX + 14, window.innerWidth - 340), top: Math.min(evt.clientY + 12, window.innerHeight - 150) }}
    >
      <div className="t-title">{fmtPeriod(seg.start, seg.end)}</div>
      <div className={over ? 't-warn' : 't-mono'}>
        负载 {fmtKw(seg.load)} kW / 额定 {fmtKw(ratedKw)} kW{over ? '　超限' : ''}
      </div>
      {seg.deviceNames.length > 0 && (
        <div className="t-devs">运行中：{seg.deviceNames.join('、')}</div>
      )}
    </div>
  );
}

function fmtKw(n) {
  return (Math.round(n * 100) / 100).toString();
}

/** 生成至多 9 个等间隔整点（或整 30 分钟）刻度 */
function buildTicks(from, to) {
  const span = to - from;
  const targets = [1, 2, 3, 4, 6, 8, 12].map((h) => h * 3600000);
  let step = targets[0];
  for (const t of targets) {
    if (span / t <= 9) { step = t; break; }
    step = t;
  }
  const start = Math.ceil(from / step) * step;
  const out = [];
  for (let t = start; t < to; t += step) out.push(t);
  return out;
}

function fmtTick(ms, prevMs) {
  if (prevMs === undefined) return fmtShort(ms).replace('-', '/');
  const a = new Date(prevMs);
  const b = new Date(ms);
  const dayChanged = a.getDate() !== b.getDate() || a.getMonth() !== b.getMonth();
  return dayChanged ? fmtShort(ms).replace('-', '/') : fmtHM(ms);
}
