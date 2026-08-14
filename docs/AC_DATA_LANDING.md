# 空调数据面上线计划

`feature/ac-predict` → `main` 的落地顺序、部署步骤与冒烟检查。

本文是**照着做的清单**，不是叙述。规模上限见
[engineering-workflow §3.1](agents/engineering-workflow.md)，闸门口径见
[ci-gates](agents/ci-gates.md)。

---

## 0. 先看这一条

分支相对 `main` 有 **24 个提交**（含一次从 main 的合并），分两波：

| 波次 | 内容 | 提交 | 行数（不含生成物与锁文件） |
|---|---|---|---|
| **A 波** | 空调台账与空间配置（先于本期） | 6 个 | ≈ 7 650 |
| **B 波** | 空调数据面（本期） | 17 个 | ≈ 6 100 |

⚠ **按 400 行的上限，这个分支拆不成「几个」PR，而是四十个上下。** 原因不是提交
写得大，而是每个功能提交里测试占 50–70%，而测试规范要求它们同批进来（增量覆盖
≥ 90%，缺陷修复必须先有必红用例）。把源码与测试拆成两个 PR 会让第一个 PR 的增量
覆盖直接红。

三条出路，**由用户拍板，本文不替他决定**：

1. **照拆**：按第 2 节的清单拆到 40+ 个 PR，串行评审。最贵但完全合规。
2. **记录在案的例外**：按功能单元合并成 14 个 PR（第 2 节的分组），每个 400–800
   行，在 PR 描述里写明超限行数与理由。⚠ §3.1 的「机械化改动」例外**不适用**——
   那条只覆盖重命名、格式化与自动生成，本期是新逻辑。这是一次**新的、需要显式
   批准**的例外，不能借用旧条款。
3. **改口径**：把测试文件排除出 `check_pr_policy` 的行数统计。400 行的理由是
   「评审质量随规模断崖式下降」，而测试的评审方式与源码不同。这是改规范，不是
   改本次落地，应单独提。

---

## 1. 不可协商的顺序

四条。每条都写了**违反后会怎样**，因为这四种失败的现象都与原因隔得很远。

### 1.1 `lib[mssql]` + 锁文件 → 早于任何选它的 PR

`server/lib/pyproject.toml` 的 `mssql` extra 与 `server/uv.lock` 必须先落，
platform-server 的 `lib[auth,db,mssql,web]` 才装得出 pymssql。

> 违反：platform-server 的 CI 在 `uv sync` 阶段就失败，报的是找不到 pymssql，
> 而不是「你少合了一个 PR」。

### 1.2 许可证闸修复 → 早于**装上** pymssql 的那个 PR

`2755b9a` 必须先合。注意分界不在「加 extra」而在「选 extra」：extra 加进 lib 时
没人选它，pymssql 不会被装，闸门看不见它；platform-server 选上之后才装。

> 违反：`check_licenses` 判 pymssql 传染性许可证并阻断。它的 `License` 字段塞的是
> 整份 LGPL 正文，闸门在首行修复之前会命中正文里的 “the Lesser GPL”。

### 1.3 auth-server 的 `PUT` 规则 → **合并且重跑种子**，才轮到 platform 的覆盖式写面

`f3296c0` 给 `/api/v1/platform/*` 补了 `PUT` 规则。规则表存在**数据库里**，
只合代码不重跑 `scripts.seed` 等于没加。

> 违反：`PUT …/data-bindings/{dataset}` 与 `PUT …/metric-limits` 经边缘一律 403，
> 而直连 8005 端口完全正常。现象看起来像「前端坏了」。
> ⚠ **这是本次上线最可能踩的一脚。**

### 1.4 迁移只做扩展步 —— 已确认成立

`8f4a1c9e2b7d`（down_revision `c3d81f60a4b2`）的 `upgrade()` 只有两条
`create_table` 与两条 `create_index`，**没有任何 ALTER / DROP 触及既有表**。

因此「新结构 + 旧代码」天然可用：旧代码根本不认识 `hvac_ac_data_bindings` 与
`hvac_ac_metric_limits`，两张空表放在那里对它没有任何影响。**迁移可以先于代码
上线。**

---

## 2. PR 序列

服务维度的上限只统计 `server/services/*`，`web/` 与 `docker/` 不受「一个 PR 一个
服务」约束（仍受 400 行 / 20 文件约束）。

### 2.1 B 波（本期，按依赖排序）

`⚠` = 超 400 行，需按第 0 节的三条出路之一处理。

| # | PR | 携带提交 | 行数 | 依赖 |
|---|---|---|---|---|
| 1 | fix(ci): 许可证闸认全称 | `2755b9a` | 27 | —— |
| 2 | docs(hvac): 数据面设计与 ADR-0009 | `2e02483` | 424 ⚠ | —— |
| 3 | build(lib): mssql extra + 锁 | `28701b6` | 1 + 锁 | —— |
| 4 | feat(lib/web): 游标分页 | `957d5a6` 的 `pagination.py` `web/__init__` 与两份测试 | 277 | —— |
| 5 | feat(lib/config): SqlServerSettings | `957d5a6` 的 `config/*` 与 `test_config` | 83 | 3 |
| 6 | feat(lib/db): 标识符白名单与连接档位 | `957d5a6` 的 `quote_identifier` / `SourceProfile` 及其用例 | ≈ 110 | 3 |
| 7 | feat(lib/db): ReadOnlySqlSource | `957d5a6` 余下部分 | ≈ 340 | 6 |
| 8 | feat(auth): platform 的 PUT 规则 | `f3296c0` | 7 | —— |
| 9 | feat(platform/hvac): 两张表与迁移 | `977b3b5` 的 migration / models / errors | 301 | —— |
| 10 | feat(platform/hvac): 数据集与指标目录 | `977b3b5` 的 `datasets.py` 与用例 | 295 | 9 |
| 11 | build(platform): 外库配置与连接 | `c4f3965` | 108 + 锁 | 3,5,7,1 |
| 12 | feat(platform/hvac): 绑定与达标范围的 schema/crud | `887f301` 的 schemas + crud | ≈ 230 | 9,10 |
| 13 | feat(platform/hvac): 绑定读写面 | `887f301` 的绑定部分 | ≈ 390 | 12 |
| 14 | feat(platform/hvac): 达标范围读写面 | `887f301` 的达标范围部分 | ≈ 390 | 12 |
| 15 | feat(platform/hvac): 外库适配层 | `312d5d3` 的 `ac_source_reader` 与用例 | 458 ⚠ | 7,11 |
| 16 | feat(platform/hvac): 取数服务 | `312d5d3` 的 `ac_reading_service` + schemas + 单测 | 675 ⚠ | 15 |
| 17 | feat(platform/hvac): 三个端点与装配 | `312d5d3` 的 api/deps/errors/conftest/契约 | 358 | 16 |
| 18 | feat(platform/hvac): 取数面集成测试 | `312d5d3` 的 `test_ac_reading_api` | 324 | 17 |
| 19 | style/docs(platform): 压制理由与格式 | `6cf28ab` `eef18c5` | 26 | 17 |
| 20 | build(web/ui): echarts 依赖 + 锁 | `cc5e119` | 7 + 锁 | —— |
| 21 | feat(web/ui): DtDateTimeInput | `7b03db9` 的日期输入部分 | ≈ 500 ⚠ | —— |
| 22 | feat(web/ui): DtLineChart | `7b03db9` 的图表部分 | ≈ 1 070 ⚠ | 20 |
| 23 | feat(web): 数据面契约与接口封装 | `b95daf8` | 409 ⚠ | 17 |
| 24 | feat(web): 台账页的数据与达标弹窗 | `be5430a` | 1 255 ⚠ | 23 |
| 25 | docs(platform/deploy): 上下文、地图与部署 | `696d057` `a0b2417` | 233 | 17 |

**B 波 25 个 PR，其中 7 个仍超 400 行。** 15/16 与 21/22/24 若继续拆，只能把源码
与它的测试分到两个 PR——那会让前一个 PR 的增量覆盖闸红，得不偿失。

### 2.2 A 波（先于本期，同样的问题、更大的量级）

| 提交 | 行数 | 说明 |
|---|---|---|
| `351eebe` | 71 | ✅ 直接成 PR |
| `806e63b` | 35 | ✅ |
| `dcf8964` | 135 | ✅ |
| `33c8d72` | 395 | ✅（贴着上限） |
| `fc50ddb` | 3 842 | ⚠ 新建整个服务，至少要拆 10 个 PR |
| `68ed11a` | 3 172 | ⚠ 两个页面，至少要拆 8 个 PR |

A 波应当**先于 B 波整体落地**：B 波的每一个 platform PR 都建立在 `fc50ddb` 造出
的服务骨架上。

### 2.3 ⚠ 锁文件规则与「加依赖」自相矛盾

`check_lockfile_stands_alone` 的判定是「PR 里同时出现锁文件与任何可评审文件即
违规」。而 `uv lock --check` 要求 `pyproject.toml` 与 `uv.lock` **同批变更**，否则
锁文件失同步。

于是 PR 3、11、20 无论怎么拆都过不了：拆开 → `uv lock --check` 红；不拆 →
`check_lockfile_stands_alone` 红。

**这是闸门自身的矛盾，不是本次落地的问题。** 需要先修闸门（把 `pyproject.toml` /
`package.json` 排除出「其它可评审文件」），或对这三个 PR 明确豁免。

---

## 3. 部署跑单

前置：A 波与 B 波都已合入 `main`，镜像已构建。

```bash
# 1) 配置——四个新必配项，缺一即拒绝启动
#    ACSOURCE_HOST / ACSOURCE_USER / ACSOURCE_PASSWORD / ACSOURCE_DB
cd docker && vi .env
```
检查：`docker compose config | grep PLATFORM_SQLSERVER` 六项都有值，没有 `${...}` 残留。

```bash
# 2) 迁移——扩展步，可以先于代码上线
cd server/services/platform-server && uv run alembic upgrade head
```
检查：`\dt platform.*` 能看到 `hvac_ac_data_bindings` 与 `hvac_ac_metric_limits`。

```bash
# 3) ⚠ 重跑种子——不跑的话覆盖式写面经边缘一律 403
cd server/services/auth-server && uv run python -m scripts.seed
```
检查：规则表里有 `/api/v1/platform/*` 的 `PUT` 一条，`priority=900`、码为 `ac:manage`。

```bash
# 4) 重启服务
cd docker && docker compose up -d --build platform-server auth-server edge-gateway
```
检查：`/api/v1/platform/ready` 返回 200。⚠ 外库不可达**不影响就绪**，见 §4.2。

```bash
# 5) 看一眼启动自检
docker compose logs platform-server | grep selfcheck
```
期望：`startup_selfcheck_passed` 与 `ac_source_selfcheck_passed` 各一条。
若是 `ac_source_selfcheck_failed`，说明外库配置或网络不通——**服务照常起来**，
只有数据面会 503。

### 3.1 回滚

⚠ **代码能回滚，数据库不能。**

- **回滚镜像**：把 platform-server 换回上一版即可。两张新表留在库里，旧代码不
  认识它们，**没有任何影响**（§1.4）。这是安全且推荐的回滚方式。
- ⚠ **绝不要跑 `alembic downgrade`**：`downgrade()` 是两条 `drop_table`，会把
  已经配好的全部绑定与达标范围**连数据一起删掉**，且不可恢复。
- 回滚后若要再上线，重跑第 4 步即可，迁移已经是 head，不需要再动。
- auth-server 的规则**不需要回滚**：多一条 `PUT` 规则对旧代码无害，它只是让一个
  当时还不存在的端点有权限口径。

---

## 4. 上线后冒烟

⚠ 全部**经边缘**（默认 8080）打，不要直连 8005——直连会跳过闸 1，恰好绕开最容易
出问题的那一层。

### 4.1 覆盖式 PUT 必须经边缘验（第 1.3 条的实测）

```bash
curl -i -X PUT "$EDGE/api/v1/platform/ac-units/$UNIT/data-bindings/raw_minute" \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"source_object":"KTStartData_K01"}'
```
期望 **200**。若是 **403**，就是种子没重跑（第 3 步）——直连 8005 会返回 200，
这正是它难查的原因。

### 4.2 外库不可用时就绪探针仍然通过

```bash
curl -s "$EDGE/api/v1/platform/ready"                         # 期望 200 {"status":"ready"}
curl -s "$EDGE/api/v1/platform/ac-datasets" -H "Authorization: Bearer $TOKEN"   # 期望 200，不碰外库
```

### 4.3 时区：取回来的必须是 UTC，且对得上已知的当地时数据

先在外库直接确认一行，例如当地时 `10:00` 有 `workshop_temp_avg=29.3287`，然后：

```bash
curl -s "$EDGE/api/v1/platform/ac-units/$UNIT/raw-samples?from=2026-08-12T02:00:00Z&to=2026-08-12T02:03:00Z" \
     -H "Authorization: Bearer $TOKEN"
```
期望首行 `ts` 为 `2026-08-12T02:00:00.000Z`、`workshop_temp_avg` 为 `29.3287`。

⚠ **换算方向反了也会返回数据**，只是整体差 8 小时，且不报任何错。所以这条必须
拿一行**已知的**当地时数据来对，不能只看「有没有返回」。

### 4.4 发现只列形状齐备的对象

```bash
curl -s "$EDGE/api/v1/platform/ac-datasets/raw_minute/source-objects" \
     -H "Authorization: Bearer $TOKEN"
```
期望 17 条 `KTStartData_K01`…`K17`；⚠ `06A699` / `6D139C` / `D5A3FA` **不应出现**
——它们只有 4 列、没有时间列。出现了说明发现退化成了按名字前缀过滤。

### 4.5 游标严格前进

连翻两页，`limit=5`：第二页首行的 `ts` 必须**严格晚于**第一页末行，且两页无重复。

### 4.6 外库不可用时是 503 不是 500

停掉到外库的网络或填一个不通的地址，`raw-samples` 应返回 **503 / `code=51601`**，
且响应体里没有连接串、库名与 SQL。

---

## 5. 评审时会看到的红灯（不是本次引入）

| 红灯 | 是什么 | 处置 |
|---|---|---|
| `test_unmanaged_path_is_denied_rather_than_allowed` | 探的路径已被 `{platform}/*` 兜住，属陈旧用例 | 等用户拍板，建议改探一个真正无规则的路径，**不要把 403 改成 200** |
| `test_new_rule_takes_effect_on_the_next_verify` | 同上；⚠ 只改 `before` 断言会变成永久假绿 | 等用户拍板，建议换到 `/api/v1/unknown/guarded` |
| `test_permission_catalog_is_readable_and_grouped` | 目录新增 `hvac` 分组，精确集合断言过时 | 等用户拍板，建议改成包含式断言 |
| `check_comments` 报两份 `web/app/tests/pages/System/*probe*.spec.ts` | 未跟踪的临时探针文件 | 删掉或补 `@fileoverview` |

三条 auth-server 用例在本分支任何改动之前就已经红（已用 stash 复核）。分析与
建议见提交 `a0b2417` 之后的调查报告。

---

## 6. 遗留

- `check_python_naming` 的 `UNIT_SUFFIX` 收 `_min` 不收 `_minutes`，故契约字段
  `interval_minutes` 只能靠 `PositiveInt` 绕开。建议给正则补上 `minutes`。
- `check_lockfile_stands_alone` 与「加依赖」自相矛盾，见 §2.3。
- `row_count_hint` 恒为 `null`（视图没有行数统计）。字段保留在契约里。
