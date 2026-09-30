import React, { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import PeriodEditor from './PeriodEditor.jsx';
import { api } from '../api.js';
import { useToast } from '../toast.jsx';
import { toLocalInput, validatePeriod, defaultDayInput } from '../time.js';

/** 设备新增/编辑弹窗。device=null 为新增；编辑时不可在此改接（改接走改接预演） */
export default function DeviceForm({ circuits, device, circuitName, defaultCircuitId, onClose, onSaved }) {
  const toast = useToast();
  const defaults = useMemo(() => defaultDayInput(1), []);
  const [name, setName] = useState(device?.name ?? '');
  const [powerKw, setPowerKw] = useState(device ? String(device.powerKw) : '');
  const [circuitId, setCircuitId] = useState(
    String(device?.circuitId ?? defaultCircuitId ?? '')
  );
  const [periods, setPeriods] = useState(() => {
    if (device) return device.periods.map((p) => ({ start: toLocalInput(p.startMs), end: toLocalInput(p.endMs) }));
    return [{ start: defaults.startInput, end: defaults.endInput }];
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => buildOptions(circuits), [circuits]);

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('设备名称不能为空');
    const pw = Number(powerKw);
    if (!Number.isFinite(pw) || pw <= 0) return setError('设备功率必须是大于 0 的数字');
    if (!circuitId) return setError('必须指定设备接入的回路');
    for (const p of periods) {
      const err = validatePeriod(p);
      if (err) return setError(err);
    }
    const payload = {
      name: name.trim(),
      powerKw: pw,
      periods: periods.map((p) => ({ start: Date.parse(p.start), end: Date.parse(p.end) })),
    };
    setBusy(true);
    try {
      if (device) {
        await api.updateDevice(device.id, payload);
        toast(`设备「${payload.name}」已保存`, 'ok');
      } else {
        await api.createDevice({ ...payload, circuitId: Number(circuitId) });
        toast(`设备「${payload.name}」已创建`, 'ok');
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={device ? `编辑设备：${device.name}` : '新增设备'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? '提交中…' : '保存'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <label className="field">
        <span>设备名称</span>
        <input type="text" value={name} placeholder="例如：主扩声音响" onChange={(e) => setName(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 12 }}>
        <label className="field" style={{ flex: 1 }}>
          <span>设备功率（kW，必须为正数）</span>
          <input type="number" step="0.1" min="0" value={powerKw} onChange={(e) => setPowerKw(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>接入回路{device ? '（改接请使用“改接”）' : ''}</span>
          <select value={circuitId} disabled={!!device} onChange={(e) => setCircuitId(e.target.value)}>
            <option value="">— 请选择 —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{'　'.repeat(o.depth)}{o.name}</option>
            ))}
          </select>
        </label>
      </div>
      {device && (
        <div className="hint" style={{ marginBottom: 10 }}>
          当前接入：{circuitName ?? circuitId}。修改接入回路必须通过“改接 → 预演 → 确认”流程。
        </div>
      )}
      <PeriodEditor periods={periods} onChange={setPeriods} />
    </Modal>
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
  winfo;
  walk(0, 0);
  return out;
}
