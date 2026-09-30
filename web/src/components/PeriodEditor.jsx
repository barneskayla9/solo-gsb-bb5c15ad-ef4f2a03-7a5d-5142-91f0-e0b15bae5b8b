import React from 'react';

/** 时段动态编辑器：多行 [起点 — 终点 删除] + "添加时段"；左闭右开 */
export default function PeriodEditor({ periods, onChange, error }) {
  const update = (i, key, value) => {
    const next = periods.map((p, j) => (j === i ? { ...p, [key]: value } : p));
    onChange(next);
  };
  const remove = (i) => onChange(periods.filter((_, j) => j !== i));
  const add = () => {
    const lastEnd = periods.length ? periods[periods.length - 1].end : '';
    onChange([
      ...periods,
      { start: lastEnd || '', end: '' },
    ]);
  };

  return (
    <div>
      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 4 }}>
        运行时段（左闭右开，起点须早于终点；重叠时段自动按并集只计一次）
      </span>
      {periods.length === 0 && <div className="hint" style={{ marginBottom: 6 }}>尚无运行时段，设备不会产生负载。</div>}
      {periods.map((p, i) => (
        <div className="period-row" key={i}>
          <input
            type="datetime-local"
            value={p.start}
            onChange={(e) => update(i, 'start', e.target.value)}
          />
          <span className="dash">—</span>
          <input
            type="datetime-local"
            value={p.end}
            onChange={(e) => update(i, 'end', e.target.value)}
          />
          <button type="button" className="icon-btn danger rm" onClick={() => remove(i)}>删</button>
        </div>
      ))}
      {error && <div className="form-error">{error}</div>}
      <button type="button" className="btn sm" onClick={add}>+ 添加时段</button>
    </div>
  );
}
