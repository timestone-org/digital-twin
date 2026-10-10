/** @fileoverview 开关状态编码匹配、配置往返与旧字段兼容。 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import {
  DEFAULT_PANEL_STATE,
  normalizePanelState,
  panelFieldState,
  panelKindUsesState,
  panelStateValuesConflict,
} from '../src/panelState'

describe('状态编码', () => {
  it.each(['status', 'switch'] as const)('%s 使用状态映射', (kind) => {
    expect(panelKindUsesState(kind)).toBe(true)
  })

  it('旧状态灯继续使用阈值档', () => {
    expect(panelKindUsesState('dot')).toBe(false)
  })

  it.each([
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    undefined,
    '  ',
  ])('不把无效读数 %s 当成关闭', (value) => {
    expect(panelFieldState(undefined, value)).toEqual({
      state: 'unknown',
      label: '未知',
      tone: 'neutral',
    })
  })

  it('数字字符串去零但不损失大整数精度', () => {
    const config = normalizePanelState({
      onValue: '9007199254740992',
      offValue: '9007199254740993',
    })
    expect(panelFieldState(config, '9007199254740993').state).toBe('off')
    expect(panelFieldState(config, '9007199254740992').state).toBe('on')
    expect(panelFieldState(undefined, '+0001.000').state).toBe('on')
    expect(panelFieldState(undefined, '-0.000').state).toBe('off')
  })

  it('支持负数、小数和设备自定义文本编码', () => {
    const numeric = normalizePanelState({ onValue: '-01.20', offValue: '0.5' })
    expect(panelFieldState(numeric, -1.2).state).toBe('on')
    expect(panelFieldState(numeric, '0.50').state).toBe('off')
    const textual = normalizePanelState({ onValue: 'RUN', offValue: 'STOP' })
    expect(panelFieldState(textual, ' RUN ').state).toBe('on')
    expect(panelFieldState(textual, 'STOP').state).toBe('off')
    expect(panelFieldState(textual, 'UNKNOWN').state).toBe('unknown')
  })

  it.each([
    ['1', 'true'],
    ['0', 'false'],
    ['1', '1.0'],
    ['', '0'],
    ['1', ''],
  ])('重合或空编码 %s / %s 不猜状态', (onValue, offValue) => {
    const config = normalizePanelState({ onValue, offValue })
    expect(panelStateValuesConflict(config)).toBe(true)
    expect(panelFieldState(config, onValue).state).toBe('unknown')
  })
})

describe('配置与保存', () => {
  it('缺省配置为开启/关闭，非法配色回落', () => {
    expect(normalizePanelState(undefined)).toEqual({
      onValue: '1',
      offValue: '0',
      onLabel: '开启',
      offLabel: '关闭',
      unknownLabel: '未知',
      onTone: 'success',
      offTone: 'neutral',
    })
    expect(
      normalizePanelState({ onTone: 'neon', offTone: 'bad', onLabel: ' ' }),
    ).toEqual(DEFAULT_PANEL_STATE)
  })

  it('布尔或有限数字编码保存为字符串，非法编码使用缺省', () => {
    expect(
      normalizePanelState({ onValue: true, offValue: false }),
    ).toMatchObject({ onValue: 'true', offValue: 'false' })
    expect(normalizePanelState({ onValue: 2, offValue: 3 })).toMatchObject({
      onValue: '2',
      offValue: '3',
    })
    expect(
      normalizePanelState({ onValue: {}, offValue: Number.NaN }),
    ).toMatchObject({ onValue: '1', offValue: '0' })
  })

  it('旧画法不增加状态配置，新画法保留独立映射并能JSON往返', () => {
    const config = normalizeTwinConfig({
      panels: [
        {
          fields: [
            { key: 'old', kind: 'dot' },
            {
              key: 'run',
              kind: 'status',
              state: { onLabel: '运行', offLabel: '停止' },
            },
            { key: 'valve', kind: 'switch' },
          ],
        },
      ],
    })
    const panel = config.panels[0]
    if (panel === undefined) throw new Error('缺少信息牌')
    const fields = panel.fields
    expect(fields[0]?.state).toBeUndefined()
    expect(fields).toMatchObject([
      { kind: 'dot' },
      { kind: 'status', state: { onLabel: '运行' } },
      { kind: 'switch', state: { onLabel: '开启' } },
    ])
    expect(fields[1]?.state).not.toBe(fields[2]?.state)
    expect(normalizeTwinConfig(JSON.parse(JSON.stringify(config)))).toEqual(
      config,
    )
  })

  it('切换为普通画法后保存仍保留原先的状态配置', () => {
    const field = normalizeTwinConfig({
      panels: [
        {
          fields: [
            {
              key: 'run',
              kind: 'text',
              state: { onLabel: '运行' },
            },
          ],
        },
      ],
    }).panels[0]?.fields[0]
    expect(field?.state?.onLabel).toBe('运行')
  })
})
