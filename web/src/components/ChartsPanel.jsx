import React from 'react';
import LoadChart from './LoadChart.jsx';

/** 右栏：所有回路的负载时间轴与超限区间 */
export default function ChartsPanel({ analysis, selectedId, onSelect }) {
  if (!analysis) return <div className="loading"><span className="spin" />正在计算负载…</div>;
  const { circuits, window } = analysis;
  // 选中回路排最前；其余按树顺序
  const ordered = [...circuits].sort((a, b) => {
    if (a.id === selectedId) return -1;
    if (b.id === selectedId) return 1;
    return 0;
  });

  return (
    <>
      <div className="legend">
        <span><i style={{ background: 'rgba(77,163,255,0.5)' }} />回路负载</span>
        <span><i style={{ background: 'rgba(240,95,88,0.6)' }} />超限区间</span>
        <span><i style={{ background: 'transparent', borderTop: '2px dashed #e0a637', borderRadius: 0 }} />额定功率</span>
      </div>
      <div className="charts">
        {ordered.map((c) => (
          <div
            key={c.id}
            className={`chart-block${c.overloaded ? ' over' : ''}`}
            style={c.id === selectedId ? { outline: '1px solid rgba(77,163,255,0.55)' } : undefined}
            onClick={() => onSelect(c.id)}
          >
            <div className="chart-head">
              <span className="cname">{c.name}</span>
              <span className="cstat">
                峰值 {fmtKw(c.maxLoad)} / {fmtKw(c.ratedKw)} kW · {(c.loadRatio * 100).toFixed(0)}%
              </span>
              <span className="spacer" />
              <span className={`badge ${c.overloaded ? 'bad' : 'ok'}`}>
                {c.overloaded ? `超限 ${c.overload.length} 段` : '正常'}
              </span>
            </div>
            <LoadChart circuit={c} window={window} />
          </div>
        ))}
      </div>
    </>
  );
}

function fmtKw(n) {
  return (Math.round(n * 100) / 100).toString();
}
