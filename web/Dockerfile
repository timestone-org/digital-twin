# 在镜像内构建前端，运行时由现有边缘网关模板提供反向代理。
FROM node:24.18.0-bookworm-slim AS builder

WORKDIR /src
RUN npm install --global pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json app/package.json
COPY packages/ packages/
RUN pnpm install --frozen-lockfile
COPY . .

ARG VITE_AI_ENABLED=true
ENV VITE_AI_ENABLED=${VITE_AI_ENABLED}
RUN pnpm build

FROM nginx:1.27-alpine AS runtime
RUN touch /var/run/nginx.pid \
 && chown -R nginx:nginx /var/cache/nginx /etc/nginx /var/run/nginx.pid
COPY --from=builder /src/app/dist/ /usr/share/nginx/html/
USER nginx
