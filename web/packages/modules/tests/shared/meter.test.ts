/**
 * @fileoverview 守共用进度件那套变量：名字联合与 `MeterBar.vue` 里的引用集合双向吻合。
 *
 * ⚠ 变量名拼错既不报错也不生效——`css-variables.contract.spec.ts` 扫不到
 * `packages/modules/src`，这条双向断言是这套变量唯一的守卫。各模块 `look.test.ts` 里
 * 那条同款断言只扫自己的模块目录，够不到 `shared/`。
 *
 * ⚠ 另守一条：**共用件里不许出现任何一个模块自己的变量**。留一个 `--il-…` 在这里，
 * 换个模块用它时那条回落就永远命不中，而两侧都不报错。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { METER_VAR_NAMES } from '../../src/shared/meter'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const SOURCE = join(
  process.cwd(),
  'packages',
  'modules',
  'src',
  'shared',
  'MeterBar.vue',
)

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const VAR_REFERENCE = /var\(\s*(--dt-meter-[a-z0-9-]+)/g
const VAR_DECLARATION = /(--dt-meter-[a-z0-9-]+)\s*:/g
/** 任何一个模块私有前缀。⚠ 目前只有 `--il-` 一族，加了别的模块前缀记得补进来。 */
const MODULE_OWNED = /var\(\s*(--il-[a-z0-9-]+)/g

function styles(): string {
  const text = readFileSync(SOURCE, 'utf8')
  return [...text.matchAll(STYLE_BLOCK)]
    .map((match) => match[1] ?? '')
    .join('\n')
}

function namesMatching(pattern: RegExp): string[] {
  const found = new Set<string>()
  for (const match of styles().matchAll(pattern)) {
    const name = match[1]
    if (name !== undefined) found.add(name)
  }
  return [...found].sort()
}

/** 样式里自己声明的别名——它们不由调用方注入，故不进变量名联合。 */
function localVars(): string[] {
  return namesMatching(VAR_DECLARATION)
}

/** 样式里真正引用到、且**不是**本文件自己声明的那些。 */
function injectedVars(): string[] {
  const local = new Set(localVars())
  return namesMatching(VAR_REFERENCE).filter((name) => !local.has(name))
}

describe('进度件的变量', () => {
  it('扫描本身没有空转——样式块扫到了，也真扫出了变量', () => {
    expect(styles().length).toBeGreaterThan(0)
    expect(namesMatching(VAR_REFERENCE).length).toBeGreaterThan(0)
  })

  // ⚠ 联合里多一个 = 调用方注入了没人读的变量；少一个 = 样式读一个没人注入的
  it('名字联合与样式里的引用逐字相等', () => {
    expect(injectedVars()).toEqual([...METER_VAR_NAMES].sort())
  })

  it('自己声明的别名只有那一个，别名不许悄悄替掉注入的变量', () => {
    expect(localVars()).toEqual(['--dt-meter-ink'])
  })

  // ⚠ 这条只有「搬家搬了一半」才会红：共用件里留着模块私有变量，
  //   换个模块来用时那条回落永远命不中，而两侧都不报错
  it('共用件里一个模块私有变量都不剩', () => {
    expect(namesMatching(MODULE_OWNED)).toEqual([])
  })
})
