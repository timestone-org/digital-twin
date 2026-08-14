/**
 * @fileoverview 契约：chrome 键清单（`@dt/contracts` 的 `CHROME_KEYS`）与渲染侧发射规则的
 * **双向**穷尽锁——清单里的每个键渲染侧都得处理，渲染侧读到的每个键都得在清单里。
 * ⚠ 漏了哪一边都静默：面板写了个没人读的键、或渲染读了个面板配不出来的键，全程无报错。
 */
import { CHROME_KEYS, isChromeKey, type ChromeKeySpec } from '@dt/contracts'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  CARD_BORDER_STYLE_OPTIONS,
  cardChromeClasses,
  cardVars,
} from '../src/cardVars'

const SPECS: readonly ChromeKeySpec[] = CHROME_KEYS

// 刻意不用 new URL('字面量', import.meta.url)：Vite 会把它静态改写成资源 URL
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(path.resolve(HERE, '../src/cardVars.ts'), 'utf-8')

/**
 * 用来「点亮」渲染侧的候选值：至少一个候选必须产出变量或修饰类，
 * 否则这个键在面板上就是个选了没反应的旋钮。
 */
function probeValues(spec: ChromeKeySpec): unknown[] {
  switch (spec.type) {
    case 'color':
      return ['var(--accent-primary)']
    // 非 0 正数：竖条间距「≤0 按未设置」的兜底不会把探针吃掉
    case 'number':
      return [7]
    // 两个方向都试：四角与标题是「显式 false 才注入」，其余布尔是「严格 true 才注入」
    case 'boolean':
      return [true, false]
    // 缺省档（'solid' 之类）本就不该注入，故只要求**至少一个**合法值有效果
    case 'enum':
      return [...(spec.values ?? [])]
    case 'number3':
      return [[1, 2, 3]]
  }
}

/** 一个键挂上某个取值后，渲染侧一共产出的东西。 */
function emitted(key: string, value: unknown): string[] {
  const chrome = { [key]: value }
  return [...Object.keys(cardVars(chrome)), ...cardChromeClasses(chrome)]
}

describe('清单自身自洽', () => {
  it('键名不重复', () => {
    expect(new Set(SPECS.map((spec) => spec.key)).size).toBe(SPECS.length)
  })

  it('枚举键都带合法值表，非枚举键都不带', () => {
    for (const spec of SPECS) {
      expect(Array.isArray(spec.values), spec.key).toBe(spec.type === 'enum')
      if (spec.values) expect(spec.values.length, spec.key).toBeGreaterThan(0)
    }
  })

  it('边框样式的合法值与选项表逐字一致，值在契约层译名在渲染层', () => {
    const spec = SPECS.find((item) => item.key === 'borderStyle')
    expect(spec?.values).toEqual(CARD_BORDER_STYLE_OPTIONS.map((o) => o.value))
  })
})

describe('正向：清单里的键，渲染侧必须全处理', () => {
  it.each(SPECS.map((spec) => [spec.key, spec] as const))(
    '%s 至少有一个合法取值能产出变量或修饰类',
    (key, spec) => {
      const live = probeValues(spec).filter(
        (value) => emitted(key, value).length > 0,
      )
      expect(
        live.length,
        `清单登记了 ${key}，但渲染侧对它的任何取值都没有反应`,
      ).toBeGreaterThan(0)
    },
  )

  it('描边边数的每个合法值都注入变量，漏一档就是那档静默失效', () => {
    const spec = SPECS.find((item) => item.key === 'borderSide')
    for (const value of spec?.values ?? []) {
      expect(
        emitted('borderSide', value),
        `borderSide:${String(value)}`,
      ).toContain('--card-border-side')
    }
  })

  it('产出的变量名一律以 --card- 打头，不许污染别的命名空间', () => {
    for (const spec of SPECS) {
      for (const value of probeValues(spec)) {
        for (const name of Object.keys(cardVars({ [spec.key]: value }))) {
          expect(name.startsWith('--card-'), `${spec.key} → ${name}`).toBe(true)
        }
      }
    }
  })
})

describe('反向：渲染侧读的键，必须都在清单里', () => {
  /** 发射规则里读 chrome 键的两种写法。 */
  const READ_PATTERNS = [
    /(?<![\w$])chrome\.([A-Za-z_$][\w$]*)/g, // chrome.radius
    /(?:rawOf|pxOf|secOf|numOf)\(\s*chrome\s*,\s*'([^']+)'/g, // pxOf(chrome, 'cornerSize')
  ]

  const read = new Set<string>()
  for (const pattern of READ_PATTERNS) {
    for (const match of SOURCE.matchAll(pattern)) {
      if (match[1] !== undefined) read.add(match[1])
    }
  }

  it('扫描器确实读到了源码，扫空会让下面那条断言假绿', () => {
    expect(SOURCE).toContain('export function cardVars(')
    expect(read.size).toBeGreaterThanOrEqual(30)
  })

  it('没有读任何清单外的键，读了就是面板根本配不出来的死键', () => {
    const stray = [...read].filter((key) => !isChromeKey(key)).sort()
    expect(stray, `渲染侧读了清单外的键：${stray.join(', ')}`).toEqual([])
  })

  it('清单里的键一个都没被漏读', () => {
    const missed = SPECS.map((spec) => spec.key)
      .filter((key) => !read.has(key))
      .sort()
    expect(missed, `清单登记了但渲染侧没读：${missed.join(', ')}`).toEqual([])
  })
})
