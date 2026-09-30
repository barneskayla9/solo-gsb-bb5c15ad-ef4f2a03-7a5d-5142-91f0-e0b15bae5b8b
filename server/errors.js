'use strict';

/** 统一的 API 错误：携带 HTTP 状态码、机器可读 code、中文提示与细节 */
class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Express 错误处理中间件：ApiError 输出结构化 JSON，其余错误回退为 500 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  // express.json() 解析失败（畸形 JSON / 字符集不支持等）
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.type === 'encoding.unsupported')) {
    const message = err.type === 'entity.too.large'
      ? '请求体过大'
      : '请求体不是合法的 JSON，请检查 Content-Type 与报文格式';
    return res.status(400).json({ error: { code: 'BAD_JSON', message } });
  }
  // better-sqlite3 / 其它异常不应把内部细节直接暴露给用户
  const status = err && err.statusCode === 400 ? 400 : 500;
  const message = status === 400 ? String(err.message) : '服务器内部错误';
  if (status === 500) console.error(err);
  res.status(status).json({ error: { code: 'INTERNAL', message } });
}

module.exports = { ApiError, errorHandler };
