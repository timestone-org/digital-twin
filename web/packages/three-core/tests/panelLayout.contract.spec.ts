/**
 * @fileoverview 信息牌标签按内容参与自动宽度计算，窄牌读数仍允许换行。
 * ⚠ happy-dom 不排版，编译真实 SCSS 并检查原生卡片的最终级联契约。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeTwinConfig, TWIN_PANEL_VARIANTS } from '@dt/twin-config'
import { compileString } from 'sass-embedded'
import { afterEach, expect, it } from 'vitest'
import { buildPanelCard, paintPanelField } from '../src/panelCard'

const CSS = compileString(
  readFileSync(
    join(process.cwd(), 'packages/three-core/src/styles/panel.scss'),
    'utf8',
  ),
).css

afterEach(() => {
  document.body.replaceChildren()
})

it.each(TWIN_PANEL_VARIANTS)(
  '%s 标签按实际内容参与行宽计算，不额外预占固定字数',
  (variant) => {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = CSS
    document.body.append(stylesheet)
    const panel = normalizeTwinConfig({
      panels: [
        {
          id: 'p',
          style: { variant, width: 0, columns: 2 },
          fields: [
            { key: 'temperature', label: '混风温度', unit: '℃', decimals: 2 },
          ],
        },
      ],
    }).panels[0]
    if (!panel) throw new Error('缺少信息牌')
    const { mount, fields } = buildPanelCard(panel)
    document.body.append(mount)
    for (const view of fields) {
      paintPanelField(view, { 'p::temperature': { value: 19.12 } })
    }
    const label = mount.querySelector('.twin-panel__label')
    const line = mount.querySelector('.twin-panel__line')
    const value = mount.querySelector('.twin-panel__value')
    if (!label || !line || !value) throw new Error('缺少字段行')

    expect(getComputedStyle(label).flexBasis).toBe('auto')
    expect(getComputedStyle(line).flexWrap).toBe('wrap')
    expect(getComputedStyle(value).overflowWrap).toBe('anywhere')
  },
)
