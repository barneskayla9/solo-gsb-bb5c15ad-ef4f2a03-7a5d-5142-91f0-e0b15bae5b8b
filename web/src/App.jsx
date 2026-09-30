import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastProvider, useToast } from './toast.jsx';
import { api } from './api.js';
import CircuitTree from './components/CircuitTree.jsx';
import DeviceList from './components/DeviceList.jsx';
import ChartsPanel from './components/ChartsPanel.jsx';
import CircuitForm from './components/CircuitForm.jsx';
import DeviceForm from './components/DeviceForm.jsx';
import MoveModal from './components/MoveModal.jsx';
import { toLocalInput, fromLocalInput, fmtShort } from './time.js';

function Workspace() {
  const toast = useToast();
  const [circuits, setCircuits] = useState([]);
  const [devices, setDevices] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [tab, setTab] = useState('tree');
  const [selectedId, setSelectedId] = useState(null);

  const [winInput, setWinInput] = useState({ from: '', to: '' });
  const [winApplied, setWinApplied] = useState(null); // [ms,ms] | null

  const [modal, setModal] = useState(null);

  const refreshAll = useCallback(async () => {
    const [c, d] = await Promise.all([api.getCircuits(), api.getDevices()]);
    setCircuits(c.circuits);
    setDevices(d.devices);
    return c.configVersion;
  }, []);

  const refreshAnalysis = useCallback(async (win = winApplied) => {
    let a;
    if (win) {
      a = await api.getAnalysis(new Date(win[0]).toISOString(), new Date(win[1]).toISOString());
    } else {
      a = await api.getAnalysis();
      setWinInput({ from: toLocalInput(a.window.from), to: toLocalInput(a.window.to) });
    }
    setAnalysis(a);
    return a.configVersion;
  }, [winApplied]);

  useEffect(() => {
    (async () => {
      try {
        await refreshAll();
        await refreshAnalysis(null);
      } catch (e) {
        toast(`初始化失败：${e.message}`, 'err', 0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据变化后重新拉取（保留当前窗口）
  const reloadAfterChange = useCallback(async () => {
    await refreshAll();
    await refreshAnalysis();
  }, [refreshAll, refreshAnalysis]);

  const analysisById = useMemo(
    () => new Map((analysis?.circuits || []).map((c) => [c.id, c])),
    [analysis]
  );
  const circuitNameById = useMemo(() => new Map(circuits.map((c) => [c.id, c.name])), [circuits]);
  const configVersion = analysis?.configVersion ?? 0;

  // ---------- 回路操作 ----------
  const handleDeleteCircuit = async (c) => {
    if (!window.confirm(`确认删除回路「${c.name}」？\n（存在下级回路或挂接设备时会被拒绝）`)) return;
    try {
      await api.deleteCircuit(c.id);
      toast(`回路「${c.name}」已删除`, 'ok');
      await reloadAfterChange();
    } catch (e) {
      toast(e.message, 'err', 6000);
    }
  };

  // ---------- 设备操作 ----------
  const handleDeleteDevice = async (d) => {
    if (!window.confirm(`确认删除设备「${d.name}」及其全部运行时段？`)) return;
    try {
      await api.deleteDevice(d.id);
      toast(`设备「${d.name}」已删除`, 'ok');
      await reloadAfterChange();
    } catch (e) {
      toast(e.message, 'err', 6000);
    }
  };

  // ---------- 时间窗口 ----------
  const applyWindow = () => {
    const from = fromLocalInput(winInput.from);
    const to = fromLocalInput(winInput.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(from < to)) {
      toast('时间窗口非法：起点必须早于终点', 'err');
      return;
    }
    setWinApplied([from, to]);
    refreshAnalysis([from, to]).catch((e) => toast(e.message, 'err'));
  };
  const resetWindow = () => {
    setWinApplied(null);
    refreshAnalysis(null).catch((e) => toast(e.message, 'err'));
  };

  const overloadCount = analysis?.allOverloaded
    ? analysis.circuits.reduce((n, c) => n + (c.overload.length > 0 ? 1 : 0), 0)
    : 0;

  return (
    <>
      <div className="topbar">
        <h1>⚡ 活动配电负载排演</h1>
        <span className="sub">配电箱 → 末级回路 · 时段负载汇总 · 改接先预演后确认</span>
        <span className="spacer" />
        {overloadCount > 0 && <span className="badge bad">{overloadCount} 条回路超限</span>}
        <span className="version-badge" title="配置版本：任何配置变更后旧预演失效">配置版本 #{configVersion}</span>
      </div>

      <div className="layout">
        <div className="col col-left">
          <div className="tabs">
            <button className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>回路树</button>
            <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>
              设备（{devices.length}）
            </button>
          </div>
          <div className="tab-body">
            {tab === 'tree' ? (
              <CircuitTree
                circuits={circuits}
                devices={devices}
                analysisById={analysisById}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddCircuit={(parentId) => setModal({ type: 'circuit-new', parentId })}
                onEditCircuit={(c) => setModal({ type: 'circuit-edit', circuit: c })}
                onDeleteCircuit={handleDeleteCircuit}
                onAddDevice={(circuitId) => setModal({ type: 'device-new', circuitId })}
                onEditDevice={(d) => setModal({ type: 'device-edit', device: d })}
                onMoveDevice={(d) => setModal({ type: 'move', device: d })}
              />
            ) : (
              <DeviceList
                devices={devices}
                circuits={circuits}
                onEdit={(d) => setModal({ type: 'device-edit', device: d })}
                onDelete={handleDeleteDevice}
                onMove={(d) => setModal({ type: 'move', device: d })}
              />
            )}
          </div>
          <div className="add-bar" style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" onClick={() => setModal({ type: 'circuit-new', parentId: null })}>＋ 新增回路</button>
            <button className="btn sm" onClick={() => setModal({ type: 'device-new', circuitId: selectedId })}>＋ 新增设备</button>
          </div>
        </div>

        <div className="col">
          <div className="right-head">
            <h2>回路负载时间轴</h2>
            <span className="cstat" style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              {analysis && `窗口 ${fmtShort(analysis.window.from)} → ${fmtShort(analysis.window.to)}`}
            </span>
            <span className="spacer" />
            <div className="window-inputs">
              <input type="datetime-local" value={winInput.from} onChange={(e) => setWinInput((w) => ({ ...w, from: e.target.value }))} />
              <span>→</span>
              <input type="datetime-local" value={winInput.to} onChange={(e) => setWinInput((w) => ({ ...w, to: e.target.value }))} />
              <button className="btn sm" onClick={applyWindow}>应用窗口</button>
              <button className="btn sm" onClick={resetWindow} title="恢复为覆盖全部运行时段">重置</button>
            </div>
          </div>
          <ChartsPanel analysis={analysis} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>

      {modal?.type === 'circuit-new' && (
        <CircuitForm
          circuits={circuits}
          circuit={null}
          defaultParentId={modal.parentId}
          onClose={() => setModal(null)}
          onSaved={reloadAfterChange}
        />
      )}
      {modal?.type === 'circuit-edit' && (
        <CircuitForm
          circuits={circuits}
          circuit={modal.circuit}
          onClose={() => setModal(null)}
          onSaved={reloadAfterChange}
        />
      )}
      {modal?.type === 'device-new' && (
        <DeviceForm
          circuits={circuits}
          device={null}
          defaultCircuitId={modal.circuitId}
          onClose={() => setModal(null)}
          onSaved={async () => { await reloadAfterChange(); setTab('devices'); }}
        />
      )}
      {modal?.type === 'device-edit' && (
        <DeviceForm
          circuits={circuits}
          device={modal.device}
          circuitName={circuitNameById.get(modal.device.circuitId)}
          onClose={() => setModal(null)}
          onSaved={reloadAfterChange}
        />
      )}
      {modal?.type === 'move' && (
        <MoveModal
          device={modal.device}
          circuits={circuits}
          currentConfigVersion={configVersion}
          onClose={() => setModal(null)}
          onConfirmed={reloadAfterChange}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}
