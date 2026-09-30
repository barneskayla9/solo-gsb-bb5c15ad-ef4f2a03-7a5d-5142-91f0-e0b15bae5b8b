import React, { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import LoadChart from './LoadChart.jsx';
import { api } from '../api.js';
import { useToast } from '../toast.jsx';
import { fmtPeriod } from '../time.js';

/**
 * 设备改接弹窗：
 * 1) 选择目标回路 → 2) 预演（只读计算，不改配置）→ 3) 通过且未失效才可确认
 * 预演后任何配置变化（currentConfigVersion 与预演版本不一致）都会让确认失效，须重新预演。
 */
export default function MoveModal({ device, circuits, currentConfigVersion, onClose, onConfirmed }) {
  const toast = useToast();
  const [targetId, setTargetId] = useState('');
  const [rehearsal, setRehearsal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(() => buildOptions(circuits), [circuits]);
  const nameOf = useMemo(() => new Map(circuits.map((c) => [c.id, c.name])), [circuits]);

  const targetChanged = rehearsal && rehearsal.move.toCircuitId !== Number(targetId);
  const stale = !!rehearsal && rehearsal.configVersion !== currentConfigVersion;
  const canConfirm = !!rehearsal && rehearsal.feasible && !stale && !targetChanged && !busy;

  const doRehearse = async () => {
    setError('');
    if (!targetId) return setError('请选择改接的目标回路');
    if (Number(targetId) === device.circuitId) return setError('目标回路与当前回路相同，无需改接');
    setBusy(true);
    try {
      const r = await api.rehearse(device.id, Number(targetId));
      setRehearsal(r);
      toast(r.feasible ? '预演通过，可以确认改接' : '预演未通过：存在祖先回路超额', r.feasible ? 'ok' : 'err', 3200);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async () => {
    setError('');
    setBusy(true);
    try {
      await api.confirmMove(rehearsal.token);
      toast(`「${device.name}」已确认改接到「${nameOf.get(Number(targetId))}」`, 'ok');
      onConfirmed();
      onClose();
    } catch (e) {
      setError(e.message);
      if (e.code === 'REHEARSAL_STALE') setRehearsal(null);
    } finally {
      setBusy(false);
    }
  };

  const doDiscard = async () => {
    if (rehearsal) {
      try { await api.discardMove(rehearsal.token); } catch { /* 忽略：作废是尽力而为 */ }
    }
    onClose();
  };

  return (
    <Modal
      wide
      title={`设备改接：${device.name}`}
      onClose={doDiscard}
      footer={
        <>
          <button className="btn" onClick={doDiscard}>作废并关闭</button>
          <button className="btn" disabled={busy || !targetId || Number(targetId) === device.circuitId} onClick={doRehearse}>
            {busy ? '计算中…' : rehearsal ? '重新预演' : '预演'}
          </button>
          <button className="btn ok" disabled={!canConfirm} onClick={doConfirm} title={!rehearsal ? '请先预演' : stale ? '预演已失效，请重新预演' : ''}>
            确认改接
          </button>
        </>
      }
    >
      <div className="move-meta">
        <span className="mdev">{device.name}</span>
        <span className="mpow">{fmtKw(device.powerKw)} kW</span>
        <span className="hint">从</span>
        <span>{nameOf.get(device.circuitId)}</span>
        <span className="arrow">──▶</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ width: 220 }}>
          <option value="">— 选择目标回路 —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === device.circuitId}>
              {'　'.repeat(o.depth)}{o.name}{o.id === device.circuitId ? '（当前）' : ''}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="form-error">{error}</div>}

      {!rehearsal && !error && (
        <div className="empty">
          选择目标回路后点击「预演」：系统会按改接后的虚拟配置重算所有时段的负载，
          只要任一祖先回路在任一时段超额，整次改接将被拒绝。
        </div>
      )}

      {rehearsal && (
        <>
          {targetChanged && (
            <div className="stale-banner">目标回路已更改，请重新预演。</div>
          )}
          {stale && (
            <div className="stale-banner">
              ⚠ 预演后配置已发生变化（版本 {rehearsal.configVersion} → {currentConfigVersion}），确认已失效，请重新预演。
            </div>
          )}

          <div className={`verdict ${rehearsal.feasible ? 'ok' : 'bad'}`}>
            {rehearsal.feasible
              ? `✓ ${rehearsal.message}`
              : `✕ ${rehearsal.message}`}
          </div>

          {!rehearsal.feasible && (
            <div style={{ marginBottom: 14 }}>
              {rehearsal.violations.map((v) => (
                <div className="violation-box" key={v.circuitId}>
                  <div className="vh">
                    回路「{v.circuitName}」超额（额定 {fmtKw(v.ratedKw)} kW，共 {v.intervals.length} 个超额时段）
                  </div>
                  <ul>
                    {v.intervals.map((it, i) => (
                      <li key={i}>
                        {fmtPeriod(it.start, it.end)}　峰值 {fmtKw(it.peakKw)} kW
                        （超 {fmtKw(it.peakKw - v.ratedKw)} kW）
                        {it.deviceNames.length > 0 && <div className="hint" style={{ fontFamily: 'inherit' }}>
                          运行设备：{it.deviceNames.join('、')}
                        </div>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <AffectedTable affected={rehearsal.affected} />

          {targetId && (
            <div style={{ marginTop: 14 }}>
              <div className="hint" style={{ marginBottom: 4 }}>目标回路「{rehearsal.move.toCircuitName}」时间轴对比</div>
              {(() => {
                const target = rehearsal.affected.find((a) => a.id === Number(targetId));
                if (!target) return null;
                const win = { from: rehearsal.window.from, to: rehearsal.window.to };
                return (
                  <div>
                    <div className="hint">改接前</div>
                    <LoadChart
                      circuit={{
                        ratedKw: target.ratedKw,
                        maxLoad: target.before.maxLoad,
                        timeline: target.before.timeline,
                        overload: target.before.overload,
                      }}
                      window={win}
                    />
                    <div className="hint" style={{ marginTop: 8 }}>改接后（虚拟）</div>
                    <LoadChart
                      circuit={{
                        ratedKw: target.ratedKw,
                        maxLoad: target.after.maxLoad,
                        timeline: target.after.timeline,
                        overload: target.after.overload,
                      }}
                      window={win}
                    />
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function AffectedTable({ affected }) {
  const fmt = (r) => {
    const cls = r.overloaded ? 'pill over' : 'pill safe';
    const txt = r.overloaded ? `${fmtKw(r.maxLoad)} 超限` : fmtKw(r.maxLoad);
    return <span className={cls}>{txt}</span>;
  };
  return (
    <table className="aff">
      <thead>
        <tr>
          <th>受影响回路（设备当前祖先 ∪ 目标祖先）</th>
          <th className="num">额定 kW</th>
          <th className="num">改接前峰值</th>
          <th className="num">改接后峰值</th>
        </tr>
      </thead>
      <tbody>
        {affected.map((a) => (
          <tr key={a.id}>
            <td>{a.name}</td>
            <td className="num">{fmtKw(a.ratedKw)}</td>
            <td className="num">{fmt(a.before)}</td>
            <td className="num">{fmt(a.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildOptions(circuits) {
  const byParent = new Map();
  for (const c of circuits) {
    const key = c.parentId ?? 0;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  }
  const out = [];
  const walk = (pid, depth) => {
    for (const c of byParent.get(pid) || []) {
      out.push({ id: c.id, name: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

function fmtKw(n) {
  return (Math.round(n * 100) / 100).toString();
}
