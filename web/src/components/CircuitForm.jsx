import React, { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { useToast } from '../toast.jsx';

/** 回路新增/编辑弹窗。circuit=null 为新增 */
export default function CircuitForm({ circuits, circuit, defaultParentId, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(circuit?.name ?? '');
  const [ratedKw, setRatedKw] = useState(circuit ? String(circuit.ratedKw) : '');
  const [parentId, setParentId] = useState(
    circuit ? String(circuit.parentId ?? '') : String(defaultParentId ?? '')
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 下拉按树缩进；编辑自身时排除自身及其后代（否则与后端环路校验冲突，前端先挡）
  const options = useMemo(() => buildOptions(circuits, circuit?.id), [circuits, circuit]);

  const submit = async () => {
    setError('');
    const payload = {
      name: name.trim(),
      ratedKw: ratedKw === '' ? undefined : Number(ratedKw),
      parentId: parentId === '' ? null : Number(parentId),
    };
    setBusy(true);
    try {
      if (circuit) {
        await api.updateCircuit(circuit.id, payload);
        toast(`回路「${payload.name}」已更新`, 'ok');
      } else {
        await api.createCircuit(payload);
        toast(`回路「${payload.name}」已创建`, 'ok');
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
      title={circuit ? `编辑回路：${circuit.name}` : '新增回路 / 配电箱'}
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
        <span>名称（配电箱、柜或末级回路）</span>
        <input type="text" value={name} placeholder="例如：主配电箱 / 音响回路" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>额定功率（kW，必须为正数）</span>
        <input type="number" step="0.1" min="0" value={ratedKw} placeholder="例如：30" onChange={(e) => setRatedKw(e.target.value)} />
      </label>
      <label className="field">
        <span>上级回路（留空表示根级配电箱）</span>
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— 无（作为根） —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{'　'.repeat(o.depth)}{o.name}</option>
          ))}
        </select>
      </label>
    </Modal>
  );
}

function buildOptions(circuits, excludeSelfId) {
  const byParent = new Map();
  for (const c of circuits) {
    const key = c.parentId ?? 0;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  }
  const excluded = new Set();
  if (excludeSelfId !== undefined) {
    excluded.add(excludeSelfId);
    let added = true;
    while (added) {
      added = false;
      for (const c of circuits) {
        if (!excluded.has(c.id) && excluded.has(c.parentId)) {
          excluded.add(c.id);
          added = true;
        }
      }
    }
  }
  const out = [];
  const walk = (pid, depth) => {
    for (const c of byParent.get(pid) || []) {
      if (excluded.has(c.id)) continue;
      out.push({ id: c.id, name: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}
