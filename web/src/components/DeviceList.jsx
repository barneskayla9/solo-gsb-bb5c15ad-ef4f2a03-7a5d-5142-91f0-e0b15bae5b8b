import React from 'react';
import { fmtPeriod } from '../time.js';

/** 左侧"设备"页签：设备卡片（功率、所属回路、运行时段） */
export default function DeviceList({ devices, circuits, onEdit, onDelete, onMove }) {
  const nameOf = new Map(circuits.map((c) => [c.id, c.name]));
  if (devices.length === 0) {
    return <div className="empty">还没有设备。可在"回路树"里选择回路后点击"＋设备"接入。</div>;
  }
  return (
    <div>
      {devices.map((d) => (
        <div className="dev-card" key={d.id}>
          <div className="top">
            <span className="dname">{d.name}</span>
            <span className="dpow">{fmtKw(d.powerKw)} kW</span>
            <span className="dcirc" title="接入回路">↳ {nameOf.get(d.circuitId) ?? `#${d.circuitId}（已丢失）`}</span>
          </div>
          <div className="dev-periods">
            {d.periods.length === 0 && <span className="period-tag">无运行时段</span>}
            {d.periods.map((p) => (
              <span className="period-tag" key={p.id ?? `${p.startMs}-${p.endMs}`}>
                {fmtPeriod(p.startMs, p.endMs)}
              </span>
            ))}
          </div>
          <div className="ops">
            <button className="btn sm" onClick={() => onMove(d)}>改接</button>
            <button className="btn sm" onClick={() => onEdit(d)}>编辑</button>
            <button className="btn sm danger" onClick={() => onDelete(d)}>删除</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtKw(n) {
  return (Math.round(n * 100) / 100).toString();
}
