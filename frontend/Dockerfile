# ---------- 构建阶段：node:20-alpine 安装依赖并执行类型检查 + 生产构建 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 内网/镜像加速：默认 npmmirror，可用 --build-arg NPM_REGISTRY=... 覆盖
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "$NPM_REGISTRY"

# 先只拷贝依赖清单，利用 Docker 层缓存加速重复构建
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# 再拷贝源码与构建配置
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# npm run build 内含 TypeScript 类型检查（零错误）
RUN npm run build

# ---------- 运行阶段：nginx:alpine 托管静态产物 ----------
FROM nginx:alpine AS runner

# 自定义 nginx 配置：SPA fallback + gzip
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 覆盖默认站点产物
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html

# 权限归一化：COPY 以 root 执行会原样保留宿主文件权限位，若交付目录里的静态资源
# （如 public/favicon.svg）是 0600，nginx worker（uid=101 nginx）读不到就会返回 403。
# 这里统一放开读权限与目录遍历权限，保证静态资源一定可被 worker 读取。
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
