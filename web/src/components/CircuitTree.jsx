import React, { useMemo, useState } from 'react';

/** 左侧"回路树"页签：树 + 挂接设备 + 每回路峰值占用率 */
export default function CircuitTree({
  circuits, devices, analysisById,
  selectedId, onSelect,
  onAddCircuit, onEditCircuit, onDeleteCircuit,
  onAddDevice, onEditDevice, onMoveDevice,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const { byParent, devicesByCircuit } = useMemo(() => {
    const byParent = new Map();
    for (const c of circuits) {
      const key = c.parentId ?? 0;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(c);
    }
    const devicesByCircuit = new Map();
    for (const d of devices) {
      if (!devicesByCircuit.has(d.circuitId)) devicesByCircuit.set(d.circuitId, []);
      devicesByCircuit.get(d.circuitId).push(d);
    }
    return { byParent, devicesByCircuit };
  }, [circuits, devices]);

  const roots = byParent.get(0) || [];
  const toggle = (id) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  if (circuits.length === 0) {
    return (
      <div className="empty">
        还没有任何回路。<br />点击下方"新增回路"先创建根级配电箱。
      </div>
    );
  }

  return (
    <div>
      {roots.map((c) => (
        <Node
          key={c.id}
          c={c}
          depth={0}
          byParent={byParent}
          devicesByCircuit={devicesByCircuit}
          collapsed={collapsed}
          toggle={toggle}
          analysisById={analysisById}
          selectedId={selectedId}
          onSelect={onSelect}
          onAddCircuit={onAddCircuit}
          onEditCircuit={onEditCircuit}
          onDeleteCircuit={onDeleteCircuit}
          onAddDevice={onAddDevice}
          onEditDevice={onEditDevice}
          onMoveDevice={onMoveDevice}
        />
      ))}
    </div>
  );
}

function Node(props) {
  const {
    c, depth, byParent, devicesByCircuit, collapsed, toggle,
    analysisById, selectedId, onSelect,
    onAddCircuit, onEditCircuit, onDeleteCircuit,
    onAddDevice, onEditDevice, onMoveDevice,
  } = props;
  const children = byParent.get(c.id) || [];
  const devs = devicesByCircuit.get(c.id) || [];
  const isCollapsed = collapsed.has(c.id);
  const a = analysisById.get(c.id);
  const ratio = a ? a.maxLoad / c.ratedKw : 0;
  const cls = ratio > 1 ? 'ratio-bad' : ratio >= 0.8 ? 'ratio-warn' : 'ratio-ok';

  return (
    <div className="tree-node">
      <div className={`tree-row ${selectedId === c.id ? 'selected' : ''}`} onClick={() => onSelect(c.id)}>
        <button
          className={`tree-toggle ${children.length === 0 ? 'leaf' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggle(c.id); }}
          title={isCollapsed ? '展开' : '收起'}
        >
          {isCollapsed ? '▸' : '▾'}
        </button>
        <span className="tree-name" title={c.name}>
          <span className="depth-marker">{'┊'.repeat(Math.min(depth, 4))}</span>{c.name}
        </span>
        <span className="tree-rated">{fmtKw(c.ratedKw)}kW</span>
        {a && <span className={`tree-ratio ${cls}`}>{Math.round(ratio * 100)}%</span>}
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="在此回路下新增子回路" onClick={() => onAddCircuit(c.id)}>＋柜</button>
          <button className="icon-btn" title="在此回路上接入设备" onClick={() => onAddDevice(c.id)}>＋设备</button>
          <button className="icon-btn" title="编辑回路" onClick={() => onEditCircuit(c)}>改</button>
          <button className="icon-btn danger" title="删除回路" onClick={() => onDeleteCircuit(c)}>删</button>
        </span>
      </div>

      {!isCollapsed && (
        <>
          {children.length > 0 && (
            <div className="tree-children">
              {children.map((ch) => (
                <Node key={ch.id} {...props} c={ch} depth={depth + 1} />
              ))}
            </div>
          )}
          {devs.length > 0 && (
            <div className="tree-devices">
              {devs.map((d) => (
                <div className="device-chip" key={d.id}>
                  <span title={d.name}>🔌</span>
                  <span className="dname">{d.name}</span>
                  <span className="dpow">{fmtKw(d.powerKw)}kW</span>
                  <button className="dmover" onClick={() => onMoveDevice(d)}>改接</button>
                  <button className="icon-btn" onClick={() => onEditDevice(d)}>改</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtKw(n) {
  return (Math.round(n * 100) / 100).toString();
}
