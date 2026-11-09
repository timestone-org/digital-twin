/** @fileoverview 挑点位弹窗的副标题：认得出的行拼成人话，认不出的原样给键。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { expect, it } from 'vitest'

import { twinPickLabel } from '@/pages/TwinEditor/scripts/pickLabel'

const CONFIG = normalizeTwinConfig({
  parts: [{ id: 'p1', name: 'Tank1', tint: { stops: [] } }],
})

it('拼出槽名、实体名与读数名', () => {
  expect(twinPickLabel(CONFIG, 'partValues[0].value')).toBe(
    '部件状态染色 · Tank1 · 数值 / 状态',
  )
})

it('认不出的行原样给键，不编一个名字', () => {
  expect(twinPickLabel(CONFIG, 'partValues[9].value')).toBe(
    'partValues[9].value',
  )
})
