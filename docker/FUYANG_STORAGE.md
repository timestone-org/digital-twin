# 阜阳光伏远程存储

本地应用运行在 `localhost:8080`，存储运行在 `172.31.31.234`。
只迁移阜阳光伏；保定空调、北京项目的数据保留在原本地数据库。

| 存储 | 新容器 | 服务器端口 |
| --- | --- | --- |
| PostgreSQL / TimescaleDB | `fuyang-pv-postgres` | 25432 |
| Redis | `fuyang-pv-redis` | 26379 |
| MinIO S3 | `fuyang-pv-minio` | 19000 |
| MinIO 控制台 | 同上 | 19001 |

数据库账号为 `postgres`，库名为 `digital_twin`；数据库密码、MinIO 凭据与桶名
沿用原远端服务。Redis 同样沿用原配置。实际秘密在服务器的 `.env` 和本机的
私有部署配置中，不放进本仓库。

## 启动

服务器部署目录为 `C:\Users\FUy\fuyang-pv-storage`，使用该目录中的
`compose.yml` 部署副本与私有 `.env`：

```powershell
docker compose --project-directory C:\Users\FUy\fuyang-pv-storage up -d --pull never
```

PostgreSQL 与 Redis 使用已校验的镜像摘要。MinIO 使用本仓
`docker/minio/Dockerfile` 从固定官方源码构建的 amd64 镜像，并保留镜像版本与 SHA；
镜像已导入服务器。需要恢复旧部署文件时，从提交
`5718db01bc7e28e1f378d42b11bfc1b056178b72` 读取
`docker/compose.fuyang-storage.yml` 和 `docker/fuyang-storage.env.example`。
新基础设施使用 [compose.storage.yml](compose.storage.yml)。现有数据库采用原镜像、
主版本和数据卷挂载路径，升级需单独迁移。

本地使用已更新的私有配置启动同一套应用角色：

```bash
docker compose -f docker/compose.no-ai.yml \
  -f docker/.env.no-ai.local.compose.yml \
  --env-file docker/.env.no-ai up -d --no-build
```

该覆盖文件把本地内置存储放进未启用的 profile，并指定包含光伏新增节点与素材修复的
新版应用镜像。API、worker、publisher、collector、认证与实时通道均连接远程新库。
对象地址继续使用 `/oss/`，由本地边缘代理到远程 MinIO。

## 迁移与校验

大屏保留原 ID、节点、绑定、素材引用、采集点位身份与台账列键；测试备份也保留。
台账保留原始值、计算值、修正、样本数与录入信息。旧原始归档以六小时时间窗迁移，
逐批校验数量并压缩历史块；切换期间补齐迟到数据，再合并本地采集归档。

同一测点与时间戳存在不同值时，主归档优先保留本地新版采集值；两种值成对存入
远程 MinIO 的私有 `migration-audit/fuyang-20261117/` 前缀。该前缀不在匿名读取白名单。
Redis 租约与实时快照由新进程重建，刷新令牌吊销记录保留其剩余有效期迁移。

本次操作记录、分批校验、配置备份与最终报告在本机
`~/Downloads/fuyang-server-migration-2026-11-17/`，服务器部署目录也保存历史迁移进度。
数据库与数据卷均独立于旧容器。原容器与本地原库保留，供核验或恢复。

本机 `6152` 代理可经 SSH 反向转发供服务器临时访问网络：

```bash
ssh -N -R 127.0.0.1:16152:127.0.0.1:6152 DLSE@172.31.31.234
```

代理仅用于联网准备，不是存储运行依赖。
