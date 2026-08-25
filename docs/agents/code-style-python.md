# 代码风格：Python

适用于本仓所有 Python 服务。TypeScript / Vue 见 [`code-style-typescript.md`](code-style-typescript.md)，两份的原则一致，只是落到各自语言的写法。

管的是**代码本身**怎么写。注释怎么写见 [`comment-style-python.md`](comment-style-python.md)，代码放哪见 [`project-structure-python.md`](project-structure-python.md)。

格式化交给 `black`（line-length 80），本文不重复它能自动做的事——只写**工具管不了、但会真实造成缺陷**的那些。

---

## 1. 命名

| 对象 | 约定 | 例 |
|---|---|---|
| 模块 | `snake_case`，名词 | `archive_buffer.py` |
| 类 | `PascalCase` | `SnapshotStore` |
| 函数/方法/变量 | `snake_case`，**动词开头**表示动作 | `resolve_effective()` `build_plan()` |
| 常量 | `UPPER_SNAKE` | `MAX_RETRY` |
| 私有 | 单下划线前缀 | `_normalize()` |
| 布尔 | `is_` / `has_` / `should_` 前缀 | `is_leader` `has_pending` |
| 集合 | 复数 | `nodes` `bindings` |
| 带单位的量 | 后缀单位 | `timeout_s` `size_mb` `interval_ms` |
| 异步函数 | **不加 `async_` 前缀** | `await fetch()`，不是 `await async_fetch()` |

三条硬规则：

- **不用单字母变量**，`i`/`k`/`v` 只在两行内的推导式里允许。
- **不用缩写**，除非是领域内公认的（`opcua`、`ws`、`id`、`db`）。`cfg`、`mgr`、`svc`、`res` 不算。
- **名字里不带类型**：`node_list` 写成 `nodes`，`config_dict` 写成 `config`。类型标注已经说了。

⚠ **同一个概念在全仓只能有一个名字。** 一处叫 `node_key`、另一处叫 `point_id`、第三处叫 `tag`，是缺陷的温床——读代码的人会以为它们是三种东西。领域词表见 [`domain.md`](domain.md)。

---

## 2. 类型标注

### 2.1 严格度

**`pyright` 跑 `strict` 模式，全仓无例外。** 这是新项目的红利：没有历史包袱，一开始就严格的成本接近零，事后收紧的成本极高。

必须标注：全部函数参数与返回值、类属性、模块级常量。局部变量在类型不显然时标注。

### 2.2 `Any` 的规则

`Any` 会让类型检查在它经过的每一处**静默失效**——它不是"暂时不标"，是"关掉这一段的检查"。

| 允许 | 做法 |
|---|---|
| 真正的动态数据边界（外部 JSON、第三方库的无标注返回） | 在**边界处立刻收敛**成 Pydantic 模型或 `TypedDict`，不让 `Any` 流进业务代码 |
| 泛型的类型参数尚未确定 | 用 `TypeVar`，不用 `Any` |

**不允许**：为了让类型检查过关而写 `Any`。这种情况用 `cast()` 并在旁边写一行理由——`cast` 至少是显式的、可搜索的。

同理，`# type: ignore` 必须带具体错误码与理由：`# type: ignore[arg-type]  # 第三方库标注有误，见 upstream #123`。裸 `# type: ignore` 在评审中直接打回。

### 2.3 写法

- 用 `X | None`，不用 `Optional[X]`；用 `list[X]`，不用 `List[X]`。
- **参数用抽象类型、返回值用具体类型**：接收 `Sequence[Node]`（调用方传什么都行），返回 `list[Node]`（调用方知道能索引）。
- 只用于标注的导入放进 `if TYPE_CHECKING:`，避免运行时的循环导入与加载开销。
- 领域标识用 `NewType`（`NodeId = NewType("NodeId", UUID)`），别让 `UUID` 满天飞——它防的是"把大屏 id 传给了需要点位 id 的参数"这类类型检查看不出的错。

---

## 3. 规模上限

超限不是"写得不好"，是**代码在告诉你它承担了多件事**：

| 对象 | 上限 | 超了怎么办 |
|---|---|---|
| 函数 | **50 行** | 抽子函数 |
| 函数参数 | **5 个** | 相关参数聚成一个 dataclass |
| 圈复杂度 | **10** | 拆分支，或用分派表代替 if 链 |
| 嵌套深度 | **4 层** | 卫语句提前返回 |
| 类 | 500 行 | 职责拆分 |
| 模块 | 600 行 | 拆模块 |
| 路由函数 | **20 行** | 超了几乎一定是业务漏进了 HTTP 层 |

上限由 lint 强制（`ruff` 的复杂度规则），不靠自觉。

---

## 4. 导入

- **一律绝对导入**，不用相对导入（`from ..services import x`）——相对导入让文件移动时静默指向别的东西。
- **禁止 `from x import *`**：它让"这个名字从哪来的"不可回答，也让静态检查失效。
- **禁止在函数内 import 来打破循环依赖。**

⚠ 最后一条是硬规则。函数内 import **不解决**循环依赖，只是把编译期的环藏到运行期——环还在，而且现在只在特定调用路径上才炸。出现循环依赖时，正确做法是**把公共部分下沉**或**重新划分模块边界**，见 [`project-structure-python.md`](project-structure-python.md) §7。

允许函数内 import 的**唯一**理由是启动开销：某个重依赖（`sklearn`、`trimesh`）只有一条路径用得到，顶层导入会让不走那条路径的进程也付出加载成本。这种情况要在 import 旁边写明理由。

---

## 5. 异步

这一节是本项目最容易出性能事故的地方。

### 5.1 ⚠ `async` 函数里禁止阻塞调用

事件循环是**单线程**的。在 `async def` 里做一次同步阻塞调用（同步 HTTP、同步数据库、文件读写、`time.sleep`、CPU 密集计算），会让**整个进程的所有并发请求**一起卡住——不是慢一点，是全部停止。

| 阻塞的事 | 正确做法 |
|---|---|
| HTTP 请求 | `httpx.AsyncClient` |
| 数据库 | `asyncpg` / SQLAlchemy 异步会话 |
| Redis | 异步客户端 |
| 文件 IO | `run_in_executor` 或 `anyio.to_thread` |
| `time.sleep` | `await asyncio.sleep` |
| **CPU 密集**（渲染、训练、几何处理） | **进程池**，且只在 worker 角色里（见 [ADR-0002](../adr/0002-重任务用运行角色而非独立服务.md)） |

⚠ CPU 密集不能用线程池：GIL 让它照样阻塞事件循环，只是换了个地方阻塞。

### 5.2 任务引用必须保存

```python
# ❌ 任务可能在执行中途被垃圾回收，且不留任何痕迹
asyncio.create_task(do_something())

# ✅ 保存强引用直到完成
task = asyncio.create_task(do_something())
self._tasks.add(task)
task.add_done_callback(self._tasks.discard)
```

事件循环只持有任务的**弱引用**。丢掉引用的任务可能在任何时刻消失，表现为"这段代码有时候执行有时候不执行"。

### 5.3 并发与异常

- `asyncio.gather` 默认在第一个异常时返回，但**其余任务仍在跑**——要么 `return_exceptions=True` 自己处理，要么用 `TaskGroup`（它会取消同组任务）。
- 后台常驻循环必须**捕获并记录异常后继续**，否则一次偶发错误会让循环永久停止，而进程看起来还活着（健康检查照样通过）。
- 每个 `await` 都是一个可能被取消的点。持有资源时要用 `try/finally` 或上下文管理器保证释放。

---

## 6. 数据结构选型

三类模型职责不重叠，**不许互相兼任**：

| 用途 | 用什么 | 边界 |
|---|---|---|
| 外部输入/输出（HTTP、消息、配置） | **Pydantic 模型** | 只在 `api/`、`schemas/`、消息编解码处 |
| 进程内的值对象与参数聚合 | **`@dataclass(frozen=True)`** | 业务逻辑内部 |
| 持久化 | **ORM 模型** | 只在 `models/`、`crud/` |

⚠ **绝不把 ORM 模型直接返回给 HTTP 层**。它会：把数据库结构泄漏成对外契约（改列名就是破坏性 API 变更）、在序列化时触发意料之外的惰性加载（N+1）、把不该暴露的列一起发出去。转换在 `services/` 边界完成。

---

## 7. 状态与副作用

- **禁止模块级可变状态**（模块级的 `list`/`dict`/计数器）。多副本部署下它是不一致的，测试之间它是互相污染的。需要共享状态时走 Redis 或数据库。
- **进程内单例**只允许用于无状态的工具对象（客户端连接池）。任何"全局只能有一个"的**业务**语义，必须靠租约选主实现（见 [`runtime-resilience.md`](runtime-resilience.md) §6.2）——进程内单例在多 worker 下会变成 N 个。
- **禁止可变默认参数**（`def f(items: list = [])`）：它在函数定义时求值一次，然后被所有调用共享。
- **禁止 import 时的副作用**：模块顶层不许连数据库、不许起线程、不许注册全局钩子。装配在组合根显式做。

---

## 8. 明确禁止

| 禁止 | 理由 |
|---|---|
| `eval` / `exec` 处理外部输入 | 任意代码执行 |
| `pickle` 反序列化外部数据 | 任意代码执行 |
| 猴子补丁第三方库 | 升级时静默失效，且没人知道行为被改过 |
| 裸 `except:` 或 `except Exception: pass` | 吞掉包括 `KeyboardInterrupt` 在内的一切，故障静默消失 |
| 用异常做正常控制流 | 掩盖真实错误 |
| `assert` 做运行时校验 | `python -O` 下 assert 被移除，校验凭空消失。校验用显式 `if ... raise` |
| 字符串拼接 SQL | 注入面 |
| `print` | 用日志器（见 [`observability.md`](observability.md)） |
| `datetime.now()` 不带 tz | 见 [`database-standard.md`](database-standard.md) §3 |

---

## 9. 工具链

| 项 | 工具 | 闸门 |
|---|---|---|
| 格式 | `black`（line-length 80） | `--check` 失败即阻断 |
| Lint | `ruff`（含复杂度、命名、未使用导入、可变默认参数） | 零告警 |
| 类型 | `pyright` **strict** | 零错误 |
| 导入顺序 | `ruff`（isort 规则） | |
| 结构闸 | 仓库自有脚本 | 见 [`project-structure-python.md`](project-structure-python.md) §7 |

配置写进 `pyproject.toml`，本地与 CI 用同一份——阈值不写在命令行里，避免两处漂移。
