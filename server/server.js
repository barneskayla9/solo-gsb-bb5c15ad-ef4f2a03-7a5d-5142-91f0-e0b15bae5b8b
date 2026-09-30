'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { openDb } = require('./db');
const { errorHandler } = require('./errors');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.db');

const db = openDb(DB_PATH);

const app = express();
app.use(express.json({ limit: '1mb' }));

// 健康检查（供 Docker HEALTHCHECK 使用）
app.get('/api/health', (req, res) => {
  const row = db.prepare('SELECT 1 AS ok').get();
  res.json({ ok: !!row.ok, time: new Date().toISOString() });
});

app.use('/api/circuits', require('./routes/circuits')(db));
app.use('/api/devices', require('./routes/devices')(db));
app.use('/api/analysis', require('./routes/analysis')(db));
app.use('/api/moves', require('./routes/moves')(db));

// 404（未匹配的 /api 路径）
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `接口不存在：${req.method} ${req.path}` } });
});

// 生产环境：托管前端构建产物（dist），并对非 /api 路由做 SPA 回退
const distDir = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use(errorHandler);

app.listen(PORT, HOST, () => {
  console.log(`[power-load-rehearsal] listening on http://${HOST}:${PORT}`);
  console.log(`[power-load-rehearsal] sqlite at ${DB_PATH}`);
});
