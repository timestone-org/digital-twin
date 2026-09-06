/**
 * @fileoverview 契约：块的种类与分区花名册，与后端 `reporting.py` 双向对齐。
 *
 * `report` 的内部形状**没有 openapi 保护**：键名写错时 typecheck、lint 与线形
 * 契约全绿，而那一块会一声不吭地不出现——`labels`/`matrix` 被无声丢掉一年正是
 * 这个机制。所以两个方向都遍历：后端每种块在前端都要有画法，前端每种块后端都
 * 要产得出。分区顺序一并钉住，否则 24 个算子会长出 24 张脸。
 */
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import ReportBlocks from '@/pages/Modeling/Canvas/components/ReportBlocks.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'
import { BLOCK_KINDS } from '@/pages/Modeling/Canvas/scripts/reportBlocks'
import { ZONE_ORDER } from '@/pages/Modeling/Canvas/scripts/zones'

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const REPORTING_PY = join(
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
  'reporting.py',
)

/** `BlockKind = Literal["rows", …]` / `Zone = Literal[…]` 里列的那几个名字。 */
function literalsOf(name: string): string[] {
  const source = readFileSync(REPORTING_PY, 'utf8')
  const found = new RegExp(`^${name}\\s*=\\s*Literal\\[([^\\]]*)\\]`, 'm').exec(
    source,
  )
  const body = found?.[1] ?? ''
  return [...body.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? '')
}

function blockOf(kind: string): ReportBlock {
  return {
    kind,
    zone: 'step',
    port: '',
    title: `${kind} 那一块`,
    tier: 0,
    isPrimary: null,
    payload: { before: 12 },
  }
}

describe('块的种类两侧对齐', () => {
  it('后端那八种，前端一种不少', () => {
    expect([...BLOCK_KINDS]).toEqual(literalsOf('BlockKind'))
  })

  it('后端每一种块，前端都查得到画法', () => {
    for (const kind of literalsOf('BlockKind')) {
      const wrapper = mount(ReportBlocks, {
        props: { blocks: [blockOf(kind)] },
      })

      expect(wrapper.text()).not.toContain('认不出来')
    }
  })

  it('前端每一种块，后端都产得出', () => {
    const backend = new Set(literalsOf('BlockKind'))

    for (const kind of BLOCK_KINDS) expect(backend.has(kind)).toBe(true)
  })

  // ⚠ 认不出的种类要落到兜底画法上：静默丢掉的话，「这一块没画」与「这一步
  // 什么都没算」在界面上长得一模一样
  it('花名册外的种类走兜底，不是消失', () => {
    const wrapper = mount(ReportBlocks, {
      props: { blocks: [blockOf('将来某种')] },
    })

    expect(wrapper.text()).toContain('认不出来')
    expect(wrapper.text()).toContain('将来某种 那一块')
  })
})

describe('分区顺序两侧对齐', () => {
  it('后端的分区花名册与前端逐字同序', () => {
    expect([...ZONE_ORDER]).toEqual(literalsOf('Zone'))
  })

  // ⚠ 顺序由常量表定、不看数组顺序：24 个算子分批写，各自定序就会长出 24 张脸
  it('块按倒序给进来，仍按 ZONE_ORDER 摆', () => {
    const blocks = [...ZONE_ORDER].reverse().map((zone) => ({
      ...blockOf('rows'),
      zone,
      title: `${zone} 块`,
    }))

    const wrapper = mount(ReportBlocks, { props: { blocks } })
    const order = wrapper
      .findAll('[data-zone]')
      .map((node) => node.attributes('data-zone'))

    expect(order).toEqual([...ZONE_ORDER])
  })
})
