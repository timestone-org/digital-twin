/** @fileoverview 开关状态编码匹配、配置往返与旧字段兼容。 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import {
  DEFAULT_PANEL_STATE,
  normalizePanelState,
  panelFieldState,
  panelKindUsesState,
  panelStateItems,
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
  it('旧两态展开为独立可编辑项，显式列表保留其顺序', () => {
    const items = panelStateItems(undefined)
    expect(items).toEqual([
      { id: 'on', value: '1', label: '开启', tone: 'success' },
      { id: 'off', value: '0', label: '关闭', tone: 'neutral' },
    ])
    expect(panelStateItems(undefined)).not.toBe(items)
    const state = normalizePanelState({
      states: [
        { id: 'off', value: false, label: '停止', tone: 'neutral' },
        { id: 'on', value: true, label: '运行', tone: 'success' },
      ],
    })
    expect(panelStateItems(state)).toEqual(state.states)
    expect(panelFieldState(state, 'true').state).toBe('on')
    expect(panelFieldState(state, '-0.00').state).toBe('off')
  })

  it('条目独立归一化并生成稳定唯一身份，非法值保留待填提示', () => {
    const state = normalizePanelState({
      states: [
        null,
        { id: 'custom', value: 2, label: '  待机  ', tone: 'warning' },
        { id: 'custom', value: false, label: '停机', tone: 'bad' },
        {},
        { id: 'named', value: {}, label: ' ' },
        { id: 'spaced', value: ' RUN ', label: '运行', tone: 'success' },
      ],
    })
    expect(state.states).toEqual([
      { id: 'custom', value: '2', label: '待机', tone: 'warning' },
      { id: 'state-4', value: 'false', label: '停机', tone: 'neutral' },
      { id: 'state-5', value: '', label: '状态 4', tone: 'neutral' },
      { id: 'named', value: '', label: '状态 5', tone: 'neutral' },
      { id: 'spaced', value: 'RUN', label: '运行', tone: 'success' },
    ])
    expect(normalizePanelState(state)).toEqual(state)
    expect(normalizePanelState({ states: 'bad' })).toEqual(DEFAULT_PANEL_STATE)
  })

  it('状态数不沿用阈值档的数量上限，文本和大整数编码保持精确', () => {
    const state = normalizePanelState({
      states: [
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `code-${index}`,
          value: String(index),
          label: `状态${index}`,
          tone: 'accent',
        })),
        { id: 'run', value: 'RUN', label: '运行', tone: 'success' },
        {
          id: 'large',
          value: '9007199254740993',
          label: '维护',
          tone: 'warning',
        },
      ],
    })
    expect(state.states).toHaveLength(14)
    expect(panelFieldState(state, 11).label).toBe('状态11')
    expect(panelFieldState(state, 'RUN').label).toBe('运行')
    expect(panelFieldState(state, '9007199254740993').label).toBe('维护')
    expect(panelFieldState(state, '9007199254740992').state).toBe('unknown')
  })

  it('多个状态独立匹配文案与配色，保存读回不丢失', () => {
    const config = normalizeTwinConfig({
      panels: [
        {
          fields: [
            {
              key: 'run',
              kind: 'status',
              state: {
                states: [
                  { id: 'stopped', value: '0', label: '停机', tone: 'neutral' },
                  { id: 'running', value: '1', label: '运行', tone: 'success' },
                  {
                    id: 'starting',
                    value: '2',
                    label: '启动中',
                    tone: 'warning',
                  },
                  { id: 'fault', value: '3', label: '故障', tone: 'danger' },
                ],
                unknownLabel: '未接入',
              },
            },
          ],
        },
      ],
    })
    const state = config.panels[0]?.fields[0]?.state
    expect(panelFieldState(state, 2)).toEqual({
      state: 'matched',
      label: '启动中',
      tone: 'warning',
    })
    expect(panelFieldState(state, '3.00')).toEqual({
      state: 'matched',
      label: '故障',
      tone: 'danger',
    })
    expect(panelFieldState(state, 4)).toEqual({
      state: 'unknown',
      label: '未接入',
      tone: 'neutral',
    })
    expect(normalizeTwinConfig(JSON.parse(JSON.stringify(config)))).toEqual(
      config,
    )
    expect(state?.states).toHaveLength(4)
  })

  it('显式状态列表优先于两态字段，不复活已删除的状态', () => {
    const state = normalizePanelState({
      onValue: '1',
      onLabel: '旧开启',
      states: [{ id: 'fault', value: '2', label: '故障', tone: 'danger' }],
    })
    expect(panelFieldState(state, 1).state).toBe('unknown')
    expect(panelFieldState(state, 2).label).toBe('故障')
    const empty = normalizePanelState({ states: [] })
    expect(empty.states).toEqual([])
    expect(panelFieldState(empty, 1).state).toBe('unknown')
    expect(panelStateValuesConflict(empty)).toBe(true)
  })

  it.each(['1.00', 'true', ''])(
    '第三项编码 %s 重复或为空时不猜状态',
    (value) => {
      const state = normalizePanelState({
        states: [
          { id: 'on', value: '1', label: '运行', tone: 'success' },
          { id: 'off', value: '0', label: '停机', tone: 'neutral' },
          { id: 'extra', value, label: '故障', tone: 'danger' },
        ],
      })
      expect(panelStateValuesConflict(state)).toBe(true)
      expect(panelFieldState(state, 1).state).toBe('unknown')
    },
  )

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
