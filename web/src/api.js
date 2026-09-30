/** 后端 REST 封装：统一解析 {error:{code,message,details}}，抛出带中文信息的 Error */
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const e = new Error(data?.error?.message || `请求失败（HTTP ${res.status}）`);
    e.code = data?.error?.code || 'HTTP_ERROR';
    e.details = data?.error?.details || null;
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  getCircuits: () => request('GET', '/api/circuits'),
  createCircuit: (payload) => request('POST', '/api/circuits', payload),
  updateCircuit: (id, payload) => request('PATCH', `/api/circuits/${id}`, payload),
  deleteCircuit: (id) => request('DELETE', `/api/circuits/${id}`),

  getDevices: () => request('GET', '/api/devices'),
  createDevice: (payload) => request('POST', '/api/devices', payload),
  updateDevice: (id, payload) => request('PATCH', `/api/devices/${id}`, payload),
  deleteDevice: (id) => request('DELETE', `/api/devices/${id}`),

  getAnalysis: (from, to) => {
    const qs = from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : '';
    return request('GET', `/api/analysis${qs}`);
  },

  rehearse: (deviceId, targetCircuitId) =>
    request('POST', '/api/moves', { deviceId, targetCircuitId }),
  confirmMove: (token) => request('POST', `/api/moves/${token}/confirm`),
  discardMove: (token) => request('DELETE', `/api/moves/${token}`),
};
