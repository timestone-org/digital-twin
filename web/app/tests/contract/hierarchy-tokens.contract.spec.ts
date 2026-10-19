/** @fileoverview 层级图连接与选框必须引用真实存在的主题令牌。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('画布颜色令牌全部在主题底座登记', () => {
  const tokens = readFileSync(
    join(process.cwd(), 'packages/tokens/src/tokens.scss'),
    'utf8',
  )
  const canvas = readFileSync(
    join(
      process.cwd(),
      'app/src/pages/Tools/Hierarchy/components/HierarchyEdges.vue',
    ),
    'utf8',
  )
  const names = [...canvas.matchAll(/var\((--[a-z-]+)\)/g)].map(
    (match) => match[1],
  )
  for (const name of names) expect(tokens, name).toContain(`${name}:`)
})
