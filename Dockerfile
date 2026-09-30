# ---- 构建前端 ----
FROM node:20-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ---- 后端运行镜像 ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# better-sqlite3 预编译二进制通常可直接命中 node20/linux；
# 保留构建工具链作为兜底（预编译不可用时从源码编译）。
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY server/ ./server/
COPY scripts/ ./scripts/
# 前端构建产物（Express 在生产模式下直接托管）
COPY --from=web-build /app/web/dist ./web/dist

# SQLite 数据目录（compose 中挂载为命名卷）
RUN mkdir -p /app/data
ENV SQLITE_PATH=/app/data/app.db \
    PORT=8080 \
    HOST=0.0.0.0
VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=4s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

# 容器启动时自动建表、写入演示数据（库为空时），随后启动服务
CMD ["node", "server/server.js"]
