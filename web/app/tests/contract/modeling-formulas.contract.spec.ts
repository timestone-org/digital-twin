/**
 * @fileoverview 契约：后端算子花名册里的每个 code，前端公式表里都要有骨架。
 *
 * ⚠ 单向：反向允许多——前端可以先给将来的算子备好骨架。缺了这一道，加第 25 个
 * 算子时那一步的 ④「怎么算的」区会一声不吭地整片消失，而 typecheck、lint 与
 * 线形契约全绿（规格 §10.2 的契约 #3）。
 * ⚠ 默认展开只有六处（§6）：十几处默认展开会把一屏拉成十几屏，而那正是这份
 * 规格立「折叠」这条规矩的原因。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { FormulaContext } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import {
  formulaCodes,
  formulasOf,
} from '@/pages/Modeling/Canvas/scripts/formulaCatalog'

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const OPERATORS = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'src',
  'platform_server',
  'apps',
  'modeling',
  'operators',
)

/** 后端算子花名册：每个算子类自己写着的那个 `CODE`。 */
function backendCodes(): string[] {
  const found: string[] = []
  for (const name of readdirSync(OPERATORS)) {
    if (!name.endsWith('.py')) continue
    const source = readFileSync(join(OPERATORS, name), 'utf8')
    for (const hit of source.matchAll(/^\s{4}CODE = "(\w+)"/gm)) {
      found.push(hit[1] ?? '')
    }
  }
  return found.sort()
}

const EMPTY: FormulaContext = { blocks: [], ports: [], config: {} }

describe('公式表覆盖后端每一个算子', () => {
  it('后端那 24 个 code 一个不少', () => {
    const backend = backendCodes()

    expect(backend).toHaveLength(24)
    for (const code of backend) expect(formulaCodes()).toContain(code)
  })

  // ⚠ 登记了却一条都产不出，等于没登记：那一步的 ④ 区照样是空的
  it('每个算子至少产得出一条公式', () => {
    for (const code of backendCodes()) {
      expect(formulasOf(code, EMPTY).length).toBeGreaterThan(0)
    }
  })

  // ⚠ 符号态是这一屏唯一保证画得出来的东西：实参一个都取不到时它就是全部内容
  it('一个实参都取不到时符号态照样画得出来', () => {
    for (const code of backendCodes()) {
      for (const spec of formulasOf(code, EMPTY)) {
        expect(spec.symbolic.length).toBeGreaterThan(0)
        expect(spec.title).not.toBe('')
      }
    }
  })

  // ⚠ 代不进就要说清是哪一种代不进：一片空白会被读成「这一步根本没有这个数」。
  // 只有这六条是纯口径说明——它们本来就没有实参可代，硬要一句「代不进」是假话
  it('代入态缺席时必有一句话说明为什么，除了这六条纯口径说明', () => {
    const pure = [
      'cast_type:cast',
      'drop_missing:drop',
      'filter_rows:keep',
      'logistic_regression:probability',
      'logistic_regression:odds',
      'tree_regressor:split',
    ]
    const silent: string[] = []
    for (const code of backendCodes()) {
      for (const spec of formulasOf(code, EMPTY)) {
        if (spec.filled === null && spec.fallback === null) {
          silent.push(`${code}:${spec.id}`)
        }
        if (spec.fallback !== null) expect(spec.fallback, code).not.toBe('')
      }
    }

    expect(silent.sort()).toEqual([...pure].sort())
  })

  it('同一个算子里的公式 id 互不重名', () => {
    for (const code of backendCodes()) {
      const ids = formulasOf(code, EMPTY).map((spec) => spec.id)

      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('默认展开只有那六处', () => {
  // ⚠ 一个实参都没有的空上下文里，「指标为 null 就自动展开」的那几条也会张开，
  // 所以这里比的是**有实参**的那一档：规格 §6 点名的六处
  const OPEN = [
    'clip_outlier',
    'standardize',
    'pca',
    'split_dataset',
    'linear_regression',
    'logistic_regression',
  ]

  it('点名的那六个算子各有一条默认张开的', () => {
    for (const code of OPEN) {
      const opened = formulasOf(code, EMPTY).filter((spec) => spec.isOpen)

      expect(opened.length, code).toBe(1)
    }
  })

  // ⚠ 纯口径说明一律折起来：MAPE 的定义、分位插值、总体 vs 样本标准差这几条
  // 摊开之后会把一屏拉成十几屏
  it('别的算子一条都不默认张开，除非那个指标算不出来', () => {
    const rest = backendCodes().filter((code) => !OPEN.includes(code))
    const opened = rest.filter((code) =>
      formulasOf(code, EMPTY).some((spec) => spec.isOpen),
    )

    expect(opened).toEqual(['classification_metrics', 'regression_metrics'])
  })
})
