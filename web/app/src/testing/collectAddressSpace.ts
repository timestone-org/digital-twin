/**
 * @fileoverview 现场那台 KEPServerEX（保定SCADA）地址空间的一片真实切面。
 *
 * ⚠ 手编的夹具编不出这几种形状，而它们正是出问题的地方：
 * - `has_children` 恒等于「不是变量」，所以**空对象节点也声称有子节点**
 *   （`i=2295` VendorServerInfo、`i=3706` 浏览回来都是空的）。
 * - 数字 NodeId（`i=2253`）与字符串 NodeId（`ns=2;s=测试`）混在一棵树上。
 * - 同名不同址的兄弟（两个 `NamingRule`）。
 */
import type { CollectBrowseItem, CollectSubtreeItem } from '@dt/contracts'

/** 根那一层的键。 */
export const ROOT = '__root__'

/**
 * 夹具里记的是这棵树的**形状**，不含值类型。
 * ⚠ 类型另外补（`typed`）：这份切面是照着现场的浏览回包抄的，而那时的浏览
 * 还不回类型；用它测形状，不用它测类型预选。
 */
type FixtureItem = Omit<CollectBrowseItem, 'data_type'>

/** `父寻址串 → 这一层的条目` 的夹具形状。 */
export type FixtureTree = Record<string, CollectBrowseItem[]>

/**
 * 照采集侧的口径把一棵夹具树走一遍，回平铺结果。
 *
 * ⚠ 用例里必须真走一遍而不是回固定值：回固定值的话「一次请求换掉逐层那几百
 * 次」这条断言永远成立，等于没测。
 * @param tree 夹具树
 * @param root 从哪个节点往下走；null 表示从根开始
 * @param maxNodes 最多展开多少个节点，模拟采集侧的刹车
 */
export function walkFixture(
  tree: FixtureTree,
  root: string | null,
  maxNodes = 500,
): { items: CollectSubtreeItem[]; is_truncated: boolean } {
  const items: CollectSubtreeItem[] = []
  const pending: (string | null)[] = [root]
  const seen = new Set<string>(root === null ? [] : [root])
  for (let expansions = 0; pending.length > 0; expansions += 1) {
    if (expansions >= maxNodes) return { items, is_truncated: true }
    const parent = pending.shift() ?? null
    absorb(tree[parent ?? ROOT] ?? [], parent, seen, items, pending)
  }
  return { items, is_truncated: false }
}

function absorb(
  children: readonly CollectBrowseItem[],
  parent: string | null,
  seen: Set<string>,
  items: CollectSubtreeItem[],
  pending: (string | null)[],
): void {
  for (const item of children) {
    if (seen.has(item.address)) continue
    seen.add(item.address)
    items.push({ ...item, parent })
    if (!item.is_variable && item.has_children) pending.push(item.address)
  }
}

/** 变量一律按数值补类型；对象节点没有类型。 */
function typed(item: FixtureItem): CollectBrowseItem {
  return { ...item, data_type: item.is_variable ? 'float' : null }
}

/** `父寻址串 → 这一层的条目`。缺键表示这一层浏览回来是空的。 */
const SHAPE: Record<string, FixtureItem[]> = {
  __root__: [
    {
      address: 'i=2253',
      name: 'Server',
      has_children: true,
      is_variable: false,
    },
    {
      address: 'ns=2;s=_System',
      name: '_System',
      has_children: true,
      is_variable: false,
    },
  ],
  'i=2253': [
    {
      address: 'i=2254',
      name: 'ServerArray',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2255',
      name: 'NamespaceArray',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2256',
      name: 'ServerStatus',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2267',
      name: 'ServiceLevel',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2994',
      name: 'Auditing',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2268',
      name: 'ServerCapabilities',
      has_children: true,
      is_variable: false,
    },
    {
      address: 'i=2274',
      name: 'ServerDiagnostics',
      has_children: true,
      is_variable: false,
    },
    {
      address: 'i=2295',
      name: 'VendorServerInfo',
      has_children: true,
      is_variable: false,
    },
  ],
  'i=2268': [
    {
      address: 'i=2269',
      name: 'ServerProfileArray',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2271',
      name: 'LocaleIdArray',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2272',
      name: 'MinSupportedSampleRate',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2735',
      name: 'MaxBrowseContinuationPoints',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2736',
      name: 'MaxQueryContinuationPoints',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2737',
      name: 'MaxHistoryContinuationPoints',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=3704',
      name: 'SoftwareCertificates',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2996',
      name: 'ModellingRules',
      has_children: true,
      is_variable: false,
    },
  ],
  'i=2996': [
    {
      address: 'i=83',
      name: 'ExposesItsArray',
      has_children: true,
      is_variable: false,
    },
    {
      address: 'i=78',
      name: 'Mandatory',
      has_children: true,
      is_variable: false,
    },
    {
      address: 'i=79',
      name: 'MandatoryShared',
      has_children: true,
      is_variable: false,
    },
    {
      address: 'i=80',
      name: 'Optional',
      has_children: true,
      is_variable: false,
    },
  ],
  'i=83': [
    {
      address: 'i=114',
      name: 'NamingRule',
      has_children: false,
      is_variable: true,
    },
  ],
  'i=78': [
    {
      address: 'i=112',
      name: 'NamingRule',
      has_children: false,
      is_variable: true,
    },
  ],
  'i=79': [
    {
      address: 'i=116',
      name: 'NamingRule',
      has_children: false,
      is_variable: true,
    },
  ],
  'i=80': [
    {
      address: 'i=113',
      name: 'NamingRule',
      has_children: false,
      is_variable: true,
    },
  ],
  'i=2274': [
    {
      address: 'i=2275',
      name: 'ServerDiagnosticsSummary',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2289',
      name: 'SamplingIntervalDiagnosticsArray',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=2290',
      name: 'SubscriptionDiagnosticsArray',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'i=3706',
      name: 'SessionsDiagnosticsSummary',
      has_children: true,
      is_variable: false,
    },
    {
      address: 'i=2294',
      name: 'EnabledFlag',
      has_children: false,
      is_variable: true,
    },
  ],
  'i=3706': [],
  'i=2295': [],
  'ns=2;s=_System': [
    {
      address: 'ns=2;s=_System._ActiveTagCount',
      name: '_ActiveTagCount',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'ns=2;s=_System._ClientCount',
      name: '_ClientCount',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'ns=2;s=_System._Date',
      name: '_Date',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'ns=2;s=_System._Date_Day',
      name: '_Date_Day',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'ns=2;s=_System._Date_DayOfWeek',
      name: '_Date_DayOfWeek',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'ns=2;s=_System._Date_Month',
      name: '_Date_Month',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'ns=2;s=_System._Date_Year2',
      name: '_Date_Year2',
      has_children: false,
      is_variable: true,
    },
    {
      address: 'ns=2;s=_System._Date_Year4',
      name: '_Date_Year4',
      has_children: false,
      is_variable: true,
    },
  ],
}

export const REAL_TREE: FixtureTree = Object.fromEntries(
  Object.entries(SHAPE).map(([parent, items]) => [parent, items.map(typed)]),
)
