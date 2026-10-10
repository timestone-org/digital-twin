/** @fileoverview 状态牌按显式点位编码显示文案和颜色，未知读数清除匹配显示。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { buildPanelCard, paintPanelField } from '../src/panelCard'

function renderState(kind: string, value: unknown, state: unknown = undefined) {
  const panel = normalizeTwinConfig({
    panels: [
      { id: 'p', fields: [{ key: 's', label: '设备状态', kind, state }] },
    ],
  }).panels[0]
  if (panel === undefined) throw new Error('缺少信息牌')
  const built = buildPanelCard(panel)
  const view = built.fields[0]
  if (view === undefined) throw new Error('缺少状态字段')
  paintPanelField(view, { 'p::s': { value } })
  return { built, view }
}

describe.each(['status', 'switch'])('%s 状态显示', (kind) => {
  it.each([
    [true, 'on', '开启', 'success'],
    [1, 'on', '开启', 'success'],
    ['1.00', 'on', '开启', 'success'],
    ['true', 'on', '开启', 'success'],
    [false, 'off', '关闭', 'neutral'],
    [0, 'off', '关闭', 'neutral'],
    ['0', 'off', '关闭', 'neutral'],
    ['false', 'off', '关闭', 'neutral'],
    [null, 'unknown', '未知', 'neutral'],
    [undefined, 'unknown', '未知', 'neutral'],
    ['', 'unknown', '未知', 'neutral'],
    [2, 'unknown', '未知', 'neutral'],
    [Number.NaN, 'unknown', '未知', 'neutral'],
  ])('读数 %s 显示 %s', (value, state, label, tone) => {
    const { view } = renderState(kind, value)
    expect(view.row.dataset.kind).toBe(kind)
    expect(view.row.dataset.state).toBe(state)
    expect(view.row.dataset.tone).toBe(tone)
    expect(view.valueEl.textContent).toBe(label)
    expect(view.row.getAttribute('aria-label')).toBe(`设备状态：${label}`)
  })

  it('点位从开启变为缺失时立即显示未知', () => {
    const { view } = renderState(kind, 1)
    paintPanelField(view, {})
    expect(view.valueEl.textContent).toBe('未知')
    expect(view.row.dataset.state).toBe('unknown')
    expect(view.row.dataset.tone).toBe('neutral')
  })

  it('第三和第四状态随点位更新，未知读数清除激活颜色', () => {
    const { view } = renderState(kind, 2, {
      states: [
        { id: 'on', value: '1', label: '运行', tone: 'success' },
        { id: 'off', value: '0', label: '停止', tone: 'neutral' },
        { id: 'standby', value: '2', label: '待机', tone: 'warning' },
        { id: 'fault', value: '3', label: '故障', tone: 'danger' },
      ],
      unknownLabel: '待确认',
    })
    expect(view.valueEl.textContent).toBe('待机')
    expect(view.row.dataset.state).toBe('matched')
    expect(view.row.dataset.tone).toBe('warning')
    expect(view.row.dataset.empty).toBeUndefined()

    paintPanelField(view, { 'p::s': { value: '3.00' } })
    expect(view.valueEl.textContent).toBe('故障')
    expect(view.row.dataset.state).toBe('matched')
    expect(view.row.dataset.tone).toBe('danger')
    expect(view.row.getAttribute('aria-label')).toBe('设备状态：故障')

    paintPanelField(view, { 'p::s': { value: 9 } })
    expect(view.valueEl.textContent).toBe('待确认')
    expect(view.row.dataset.state).toBe('unknown')
    expect(view.row.dataset.tone).toBe('neutral')
    expect(view.row.dataset.empty).toBe('on')
  })

  it('多状态点位缺失时清除上一轮匹配显示', () => {
    const { view } = renderState(kind, 'fault', {
      states: [{ id: 'fault', value: 'fault', label: '故障', tone: 'danger' }],
    })
    expect(view.valueEl.textContent).toBe('故障')
    paintPanelField(view, {})
    expect(view.valueEl.textContent).toBe('未知')
    expect(view.valueEl.title).toBe('未知')
    expect(view.row.dataset.state).toBe('unknown')
    expect(view.row.dataset.tone).toBe('neutral')
    expect(view.row.dataset.empty).toBe('on')
  })

  it('支持反向编码、自定义文案与故障配色', () => {
    const { view } = renderState(kind, false, {
      onValue: '0',
      offValue: '1',
      onLabel: '故障',
      offLabel: '正常',
      unknownLabel: '未接入',
      onTone: 'danger',
      offTone: 'success',
    })
    expect(view.valueEl.textContent).toBe('故障')
    expect(view.row.dataset.tone).toBe('danger')
    paintPanelField(view, { 'p::s': { value: true } })
    expect(view.valueEl.textContent).toBe('正常')
    expect(view.row.dataset.tone).toBe('success')
    paintPanelField(view, {})
    expect(view.valueEl.textContent).toBe('未接入')
  })

  it('开关文案中的 HTML 只显示为文本', () => {
    const { built, view } = renderState(kind, 1, {
      onLabel: '<img src=x onerror=alert(1)>',
    })
    expect(view.valueEl.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(built.card.querySelector('img')).toBeNull()
  })

  it('多状态文案中的 HTML 只显示为文本', () => {
    const label = '<img src=x onerror=alert(1)>'
    const { built, view } = renderState(kind, 2, {
      states: [{ id: 'fault', value: '2', label, tone: 'danger' }],
    })
    expect(view.valueEl.textContent).toBe(label)
    expect(view.row.dataset.state).toBe('matched')
    expect(built.card.querySelector('img')).toBeNull()
  })

  it('开关仅供状态显示，不提供可操作控件', () => {
    const { built } = renderState(kind, 1)
    expect(
      built.card.querySelector('button, input, [role="switch"]'),
    ).toBeNull()
    expect(built.card.querySelector('.twin-panel__state-mark')).not.toBeNull()
  })
})
