'use strict';

// 改接预演端到端冒烟脚本：通过 HTTP 验证预演拒绝、通过、失效重演规则
const BASE = process.env.BASE || 'http://127.0.0.1:8080';

async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log('PASS', msg);
  } else {
    failures += 1;
    console.error('FAIL', msg);
  }
}

async function main() {
  // 1) 把"主屏LED"（8kW，17-23）从 LED屏回路(7, rated12, 当前峰值13) 改接到备用动力回路(9, rated5)
  //    备用回路 17-23 将达 8kW > 5kW，且动力柜/主配电箱负载只是重新分布（总量不变）
  let r = await call('POST', '/api/moves', { deviceId: 6, targetCircuitId: 9 });
  check(r.status === 200, '预演请求返回 200');
  check(r.json.feasible === false, '超额改接被拒绝');
  const v = r.json.violations.find((x) => x.circuitId === 9);
  check(!!v, '违规清单指出备用动力回路');
  check(v && v.ratedKw === 5, '指出额定值 5kW');
  check(v && v.intervals.length === 1 && v.intervals[0].peakKw === 8, '指出时段与峰值 8kW');
  const badToken = r.json.token;
  let c = await call('POST', `/api/moves/${badToken}/confirm`);
  check(c.status === 409 && c.json.error.code === 'REHEARSAL_INFEASIBLE', '不通过的预演不能确认');

  // 2) 改接到舞台机械回路(8, rated7)：设备 17-23 运行 8kW；机械 20-21 有 6kW 升降机械
  //    -> 20-21 合计 14kW > 7kW；另 17-20/21-23 为 8kW 也超 => 应拒绝并指出多段峰值
  r = await call('POST', '/api/moves', { deviceId: 6, targetCircuitId: 8 });
  check(r.json.feasible === false, '改接到舞台机械回路被拒绝');
  const v8 = r.json.violations.find((x) => x.circuitId === 8);
  check(!!v8, '指出舞台机械回路');
  check(v8 && v8.intervals.some((i) => i.peakKw === 14), '指出 20-21 峰值 14kW（含两台设备）');

  // 3) 可行改接：主屏LED -> 音响回路？9.5+8=17.5>9 不行；改接"观众厅通道灯"(id3,1.2kW,17-23:30) 到备用回路(5)
  //    峰值 1.2 < 5，动力柜减 0、照明柜减 1.2、备用加 1.2 => 全绿
  r = await call('POST', '/api/moves', { deviceId: 3, targetCircuitId: 9 });
  check(r.json.feasible === true, '通道灯改接到备用回路预演通过');
  const token = r.json.token;
  check(r.json.configVersion !== undefined, '返回配置版本号');

  // 4) 预演后改动配置（加一个回路即可推进版本号），确认必须失效
  const add = await call('POST', '/api/circuits', { name: '临时回路-冒烟', ratedKw: 10 });
  check(add.status === 201, '插入另一项配置变更');
  c = await call('POST', `/api/moves/${token}/confirm`);
  check(c.status === 409 && c.json.error.code === 'REHEARSAL_STALE', '配置变化后旧确认失效');

  // 5) 重新预演 -> 通过 -> 确认成功
  r = await call('POST', '/api/moves', { deviceId: 3, targetCircuitId: 9 });
  check(r.json.feasible === true, '重新预演通过');
  c = await call('POST', `/api/moves/${r.json.token}/confirm`);
  check(c.status === 200 && c.json.ok === true, '确认改接成功');
  const devs = await call('GET', '/api/devices');
  const d3 = devs.json.devices.find((d) => d.id === 3);
  check(d3 && d3.circuitId === 9, '设备已挂到目标回路');

  // 6) 确认后 token 一次性作废
  c = await call('POST', `/api/moves/${r.json.token}/confirm`);
  check(c.status === 404, '预演一次性，重复确认返回 404');

  // 7) 祖先视角：改接后备用回路 17-23:30 峰值 1.2，动力柜负载不变（通道灯本属照明柜，应使照明柜下降）
  const an = await call('GET', '/api/analysis');
  const spare = an.json.circuits.find((x) => x.id === 9);
  check(spare.maxLoad === 1.2 && spare.overloaded === false, '备用回路现负载峰值 1.2kW 且不超限');

  // 清理临时数据
  await call('DELETE', '/api/circuits/' + add.json.id);

  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
