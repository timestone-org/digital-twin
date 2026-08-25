# 代码风格：TypeScript / Vue

管的是**代码本身**怎么写。注释见 [`comment-style-typescript.md`](comment-style-typescript.md)，代码放哪与文件命名见 [`project-structure-typescript.md`](project-structure-typescript.md)，测试见 [`testing-standard-typescript.md`](testing-standard-typescript.md)。Python 侧的对应规范见 [`code-style-python.md`](code-style-python.md)，两份的原则一致。

格式化交给 `prettier`，本文只写**工具管不了、但会真实造成缺陷**的那些。

---

## 1. 命名

文件与目录的命名见 [`project-structure-typescript.md`](project-structure-typescript.md) §5，这里只补标识符层面的：

| 对象 | 约定 | 例 |
|---|---|---|
| 变量、函数 | `camelCase`，动词开头表示动作 | `resolveBinding()` |
| 类型、接口、类 | `PascalCase` | `BindingPlan` |
| 常量 | `UPPER_SNAKE`（模块级不可变值） | `MAX_POINTS` |
| 布尔 | `is` / `has` / `should` 前缀 | `isEditing` `hasOverride` |
| 组合式函数 | `useXxx` | `useBrowseTree` |
| 事件处理器 | `onXxx`（props）/ `handleXxx`（本地） | `onSelect` / `handleClick` |
| 带单位的量 | 后缀单位 | `timeoutMs` `widthPx` |
| 泛型参数 | 有意义的名字，不是 `T`/`U` | `TPayload`，单个简单泛型可用 `T` |

- **不用缩写**，领域内公认的除外（`ws`、`id`、`db`、`opcua`）。`cfg`、`btn`、`el`、`idx` 不算——`el` 只在真的指 DOM 元素时允许。
- **名字里不带类型**：`nodeList` 写成 `nodes`。
- ⚠ **同一个概念全仓一个名字**，前后端也要一致：后端叫 `node_key`，前端就叫 `nodeKey`，不叫 `pointId`。

---

## 2. 类型

### 2.1 编译器配置

`tsconfig.base.json` 必须开满，各包 `extends` 它：

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,   // arr[0] 的类型是 T | undefined —— 这是事实
  "exactOptionalPropertyTypes": true, // 区分「没有这个属性」与「属性值是 undefined」
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "verbatimModuleSyntax": true,       // 强制 type-only import 显式写出来
  "isolatedModules": true
}
```

`noUncheckedIndexedAccess` 是这几项里收益最大也最"烦"的一条：它会强迫你处理 `arr[i]` 可能不存在的情况。**大屏系统里绝大多数运行时崩溃都是这个形状**——绑定数组、模块列表、点位快照按索引取值，取到 `undefined` 后在下一行访问属性。开着它，这类问题在编译期就红。

### 2.2 `any` / `as` / `!`

三者都是**关掉类型检查**，不是"暂时不标"：

| 写法 | 规则 |
|---|---|
| `any` | ESLint 报错。外部数据用 `unknown`，在边界处用类型守卫或 zod 收敛 |
| `as` 断言 | 只允许在**你确实比编译器知道得多**的地方，且旁边写一行理由。`as unknown as X` 一律打回 |
| `!` 非空断言 | ESLint 报错。用可选链、显式判空或早返回 |
| `@ts-ignore` | **禁止**。要压制就用 `@ts-expect-error` + 理由——它在错误消失后会自己报错，不会长期留着 |

⚠ `as` 最危险的用法是给**从后端拿到的数据**断言类型：`const data = res.data as Dashboard`。后端改了字段，编译期什么都不会说，运行时在某个深层组件里崩。后端数据的类型来自 `@dt/contracts`（由 `openapi.json` 生成，见 [`api-contract.md`](api-contract.md) §9），**不是手写断言**。

### 2.3 写法

- **不用 `enum`**，用 `const` 联合类型：

  ```ts
  export const MODULE_KINDS = ['gauge', 'trend', 'table'] as const
  export type ModuleKind = (typeof MODULE_KINDS)[number]
  ```

  理由：TS 的 `enum` 会生成运行时代码、与后端的字符串枚举对不齐、且 `const enum` 在 `isolatedModules` 下不可用。联合类型还能直接拿到取值数组用于遍历与校验。
- 对象形状用 `interface`（可声明合并、报错更可读），联合/映射/工具类型用 `type`。
- **类型导入必须带 `type`**：`import type { Node } from '@dt/contracts'`。它保证类型在编译后被完全擦除，不会意外拖进运行时依赖。
- 领域标识用**品牌类型**，别让 `string` 满天飞：

  ```ts
  type DashboardId = string & { readonly __brand: 'DashboardId' }
  ```

  它防的是"把大屏 id 传给了需要点位 id 的参数"——两者都是 `string`，类型检查看不出来。

---

## 3. 规模上限

| 对象 | 上限 | 超了怎么办 |
|---|---|---|
| 函数 | **50 行** | 抽子函数 |
| 组合式函数 | 200 行 | 按关注点拆多个 `useXxx` |
| store 的 setup 函数 | 按**类**算，500 行 | 拆 store 或把某个关注点抽成组合式函数 |
| 单文件组件 | **500 行**（含模板与样式） | 拆子组件或把逻辑抽进组合式函数 |
| 模板嵌套 | **6 层** | 拆子组件 |
| `props` | 10 个 | 相关的聚成一个对象 prop |
| 圈复杂度 | 10 | 拆分支 |

⚠ 单文件组件超过 500 行时，几乎总是因为**逻辑写在了组件里**。逻辑抽进组合式函数不只是为了行数——组合式函数能被独立单元测试，而组件只能被挂载测试。

⚠ 模板嵌套取 **6** 而不是 4，是因为 [`project-structure-typescript.md`](project-structure-typescript.md) §4.2
强制的包裹栈（`AppShell` → 页面根 → `DtCard` → `DtDataView`）本身就占满 4 层：
取 4 会让这两条规范互相排斥，于是这道闸只能被整体关掉。6 层给页面自己的标记留两层，
仍然拦得住真正的 div 汤。计数时 `<template>`、`Teleport`、`Transition`、`KeepAlive`
不计——它们不渲染自己的节点。

---

## 4. 导入

- **禁止循环依赖**，由 `madge --circular` 或 ESLint `import/no-cycle` 拦截。TS 的循环依赖不像 Python 那样直接报错，它会让某个 import 在运行时是 `undefined`——表现为"这个组件有时候渲染不出来"。
- **禁止深链**包内部路径，见 [`project-structure-typescript.md`](project-structure-typescript.md) §2。
- 类型导入用 `import type`（§2.3）。
- 重依赖（3D 引擎、图表库、编辑器）**必须动态 import**，并有构建产物断言证明它不在首屏 chunk 里（见 [`testing-standard-typescript.md`](testing-standard-typescript.md) §8）。

---

## 5. 响应式与副作用

这一节是 Vue 项目最容易出缺陷的地方，且大部分缺陷**不会报错**，只会表现为"偶尔不更新"或"越用越卡"。

### 5.1 ⚠ 解构会丢失响应性

```ts
// ❌ count 是一个普通数字快照，之后 state 变了它不会变
const { count } = reactive({ count: 0 })

// ❌ props 解构同理（除非用了编译器的 props 解构语法并确认已启用）
const { modelValue } = props

// ✅
const state = reactive({ count: 0 })
const { count } = toRefs(state)
// ✅ props 直接用 props.modelValue，或 toRef(props, 'modelValue')
```

**默认用 `ref`，不用 `reactive`。** `ref` 只有一个"要不要 `.value`"的问题，而 `reactive` 有一整类静默失效：解构丢失、整体替换丢失（`state = newObj` 断开代理）、原始值不支持。

### 5.2 组件卸载必须清理

**每一个在组件里创建的、生命周期长于渲染的东西，都必须在卸载时清理。** 这是长期运行的大屏最主要的内存泄漏来源——大屏一开就是几天，一次泄漏会持续累积。

| 创建了什么 | 卸载时 |
|---|---|
| `setInterval` / `setTimeout` | `clear*` |
| `addEventListener`（window / document / 第三方） | `removeEventListener` |
| `ResizeObserver` / `IntersectionObserver` / `MutationObserver` | `disconnect()` |
| ECharts 实例 | `dispose()` |
| three.js 的几何体、材质、纹理 | **逐个 `dispose()`**，GC 回收不了 GPU 资源 |
| WebSocket 订阅 | 退订 |
| 未完成的请求 | `AbortController.abort()` |

⚠ 组件内 `watch`、`computed`、`watchEffect` 会随组件自动停止，**但在组件外创建的不会**（store 里、模块顶层、组合式函数被非组件调用时）。这些要保存 stop 句柄并显式停止。

### 5.3 watch 的三个坑

- **`deep: true` 是有代价的**：它会遍历整棵对象树。大屏配置这类大对象上开深度监听，每次变更都是一次全树遍历。优先监听具体的派生值（`() => cfg.series.length`）。
- **`flush` 时机**：默认 `pre`（渲染前）。要读 DOM 就用 `flush: 'post'`，否则读到的是上一帧。
- **`immediate: true` 与初始化的重复执行**：`immediate` 会在挂载时跑一次，如果 `onMounted` 里也做了同样的事，就会执行两次——表现为初始化时闪一下，或者两次请求。

### 5.4 `computed` 里禁止副作用

`computed` 必须是纯函数：不发请求、不改别的状态、不写 DOM。它会被缓存、可能不执行、也可能因依赖变化而多次执行——**执行次数不由你决定**，所以任何副作用都是不可控的。要副作用用 `watch` 或 `watchEffect`。

---

## 6. 组件契约

### 6.1 显式声明

```ts
const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
```

- **props 与 emits 一律用类型声明**，不用运行时对象写法。
- **禁止直接修改 props**（`vue/no-mutating-props`）——父组件的状态必须由父组件改，子组件通过 emit 请求变更。
- 双向绑定统一走 `modelValue` / `update:modelValue`。

### 6.2 ⚠ 模板里的名字，类型检查和 lint 都拦不住

写错一个 prop 名、事件名或插槽名，`vue-tsc` 与 ESLint **都不会报错**，组件只是静默地不生效：

```vue
<!-- 组件声明的是 disabled，这里写成 disable —— 没有任何工具会告诉你 -->
<DtButton disable />

<!-- 组件的插槽叫 footer，这里写成 foot —— 内容直接不渲染 -->
<template #foot>...</template>

<!-- 图标名没登记 —— 图标位置空着，控制台无声 -->
<DtIcon name="pv-inverter-x" />
```

这类错误只能靠**契约测试**兜住。规则：

- 基础组件（`@dt/ui`）的每个 prop 与具名插槽，都要有一条断言它生效的用例；
- **按名字查表的注册型组件**（图标、模块类型、图表类型）必须有一条契约测试，断言"代码中用到的每个名字都在注册表里"——这类组件的错误名是纯静默的。

### 6.3 `v-for` 的 key 必须稳定

用业务 id，**不用数组索引**。用索引做 key 会让"删除中间一项"变成"最后一项消失、其余全部错位"，且带本地状态的子组件（输入框、展开态）会串到别的行上。

---

## 7. 异步与竞态

### 7.1 竞态防护是必须的，不是可选的

只要一个加载路径可能被"快速切换"触发第二次（切换数据源、切换时间范围、快速点列表），就必须防竞态——否则慢的那次请求后返回，会覆盖快的那次的结果，**界面显示的是过期数据且没有任何报错**。

两种做法任选，但必须有一种：

```ts
// 序号法
let seq = 0
async function load(id: string) {
  const mine = ++seq
  const data = await fetch(id)
  if (mine !== seq) return          // 已经有更新的请求了，丢弃
  state.value = data
}

// AbortController 法：新请求发起前 abort 掉上一个
```

对应的乱序返回用例是**强制要求**，见 [`testing-standard-typescript.md`](testing-standard-typescript.md) §3。

### 7.2 其它

- `Promise.all` 的任一失败会让整体 reject，其余结果丢失。需要部分成功时用 `Promise.allSettled`。
- **不用 `await nextTick()` 堆叠来等异步完成**——那是在碰运气。用明确的完成信号。
- 组件卸载后**不要再写状态**：`await` 之后先检查组件是否还在（或用 AbortController），否则会在已卸载组件上触发更新。

---

## 8. 数据与格式化

前端消费后端数据时，[`api-contract.md`](api-contract.md) §6 的口径要在前端有对应处理：

| 后端给的 | 前端怎么处理 |
|---|---|
| 时间：UTC RFC3339 带 `Z` | 用统一的格式化函数按**用户时区**渲染。⚠ 禁止在组件里直接 `new Date(s).toLocaleString()`——时区与格式会散落成十几种 |
| 精确小数：JSON **string** | 用 decimal 库解析与运算。⚠ **禁止 `Number(v)` 再做算术**，那正是后端用 string 传的原因 |
| 大整数：string | 当字符串用，不转 `Number` |
| 枚举：字符串字面量 | 对应 §2.3 的联合类型 |
| 空集合：`[]` | 不需要 `?? []` 兜底，但**要容忍未知字段**（见 api-contract §2.1） |

**所有格式化（时间、数字、单位、百分比）集中在一处**，组件只调用。散落的格式化会让同一个值在两个面板里显示成两种样子。

---

## 9. 性能

大屏是长时间运行、高频更新、数据量大的场景，这几条是硬要求：

- **大对象用 `shallowRef`**：3D 场景、大屏配置树、几千点的图表数据。深层响应式代理会在每次访问时产生开销，且深度监听会遍历全树。
- **长列表虚拟化**，见 [`testing-standard-typescript.md`](testing-standard-typescript.md) §8。
- **图表与 3D 实例复用**：数据变化时调用实例的更新方法，不是销毁重建。重建会丢动画状态并产生 GPU 资源抖动。
- **高频推送要合批**：WebSocket 每秒几十条更新时，按帧合并后再写响应式状态，而不是每条都触发一次渲染。
- **`v-once` / `v-memo`** 用于确定不变的大块静态内容。
- ⚠ **不要在模板里调用函数做计算**（`{{ format(compute(x)) }}`）：模板里的表达式在每次重渲染时都会重新求值。用 `computed`。

---

## 10. 明确禁止

| 禁止 | 理由 |
|---|---|
| `eval` / `new Function` | 任意代码执行 |
| `innerHTML` 直接赋值 | XSS |
| `v-html` 未经清洗的内容 | XSS。必须经统一的清洗函数，且每处都要有测试（见 testing §7.1） |
| 拼接 HTML 字符串给图表 tooltip | ECharts tooltip 默认按 HTML 渲染，是最容易被漏掉的注入点 |
| `console.log` 留在代码里 | 用统一日志封装；ESLint 拦截 |
| 修改 props | 状态归属混乱 |
| 数组索引做 `v-for` key | 删改中间项时状态串行 |
| 在组件里直接发请求 | 见 [`project-structure-typescript.md`](project-structure-typescript.md) §8 |
| 硬编码色值 | 主题切换时第一个出问题的地方，用 `@dt/tokens` |
| 在 `packages/*` 里用 Tailwind | 包换个宿主就裸奔，见 [`project-structure-typescript.md`](project-structure-typescript.md) §4.3 |
| 在页面里手搓本该通用的控件 | 同一套焦点环/禁用态会出现第二份，见 [`project-structure-typescript.md`](project-structure-typescript.md) §4.2 |
| 页面里手写 `<table>` | 四张表会长出四个样子，列表一律走 `DtDataView`，同上 §4.2 |
| `window.confirm` / `alert` | 浏览器皮肤、塞不下后果说明，用 `useConfirm().ask()`，同上 §4.2 |
| 页面自己套 `max-w-*` 收窄整页 | 页面之间宽度不一致，切换时内容左右跳，同上 §4.2 |
| 在 `.scss` 里 `@import 'tailwindcss'` | Sass 抢先把静态 CSS 内联掉，工具类一个都不生成，而**全部闸门照常通过**，见 [`project-structure-typescript.md`](project-structure-typescript.md) §4.3 |
| 全局样式不包 `@layer` | 不分层的规则永远赢过 `@layer`，会静默压掉页面上的工具类，同上 |
| `setTimeout` 等异步完成 | 在慢机器上必然失效 |

---

## 11. 工具链

| 项 | 工具 | 闸门 |
|---|---|---|
| 格式 | `prettier` | `--check` 失败即阻断 |
| Lint | `eslint`（扁平配置，`--max-warnings=0`） | 零告警 |
| 类型 | `vue-tsc --noEmit`，配置见 §2.1 | 零错误 |
| 循环依赖 | `madge --circular` 或 `import/no-cycle` | 零环 |
| 结构闸 | 分层、深链、`src/testing` 引用 | 见 [`project-structure-typescript.md`](project-structure-typescript.md) §7 |

必开的 ESLint 规则（至少）：

```
@typescript-eslint/no-explicit-any
@typescript-eslint/no-non-null-assertion
@typescript-eslint/consistent-type-imports
@typescript-eslint/no-floating-promises      ← 未处理的 Promise 会静默吞掉错误
vue/no-mutating-props
vue/require-explicit-emits
vue/require-v-for-key
vue/no-v-html                                ← 配白名单，白名单项必须有 XSS 测试
import/no-cycle
no-console
```

⚠ `no-floating-promises` 需要开启**类型感知**的 lint（`parserOptions.project`）。它拦的是 `doAsync()` 忘了 `await` ——这种代码不会报错，只是错误被静默吞掉、时序变得不可预测。这是 TS 项目里最值得为之付出 lint 速度代价的一条规则。
</content>
