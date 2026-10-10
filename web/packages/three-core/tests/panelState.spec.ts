/** @fileoverview 状态牌按真实开关值显示文案，无数据或未知编码时不冒充关闭。 */
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

  it('开关仅供状态显示，不提供可操作控件', () => {
    const { built } = renderState(kind, 1)
    expect(
      built.card.querySelector('button, input, [role="switch"]'),
    ).toBeNull()
    expect(built.card.querySelector('.twin-panel__state-mark')).not.toBeNull()
  })
})
