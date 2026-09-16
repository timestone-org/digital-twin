/** @fileoverview 三维信息牌必须保留原始 HTML/SCSS 结构与配置样式。 */
import {
  normalizeTwinConfig,
  TWIN_PANEL_VARIANTS,
  TWIN_PANEL_FIELD_KINDS,
} from '@dt/twin-config'
import { expect, it } from 'vitest'
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { buildPanelCard, paintPanelField } from '../src/panelCard'
import { PanelLayer } from '../src/panelLayer'

it.each(TWIN_PANEL_VARIANTS)('%s 三维卡片与原生卡片结构完全一致', (variant) => {
  const panel = normalizeTwinConfig({
    panels: [
      {
        id: 'p',
        name: '泵组',
        subtitle: '运行监测',
        footnote: '额定功率',
        fields: TWIN_PANEL_FIELD_KINDS.map((kind) => ({
          key: kind,
          label: '温度',
          unit: '℃',
          kind,
        })),
        style: {
          variant,
          scan: true,
          pulse: true,
          animate: true,
          corners: true,
          grid: true,
          orient: 'top',
        },
      },
    ],
  }).panels[0]
  if (!panel) throw new Error('缺少卡片')
  const reference = buildPanelCard(panel)
  new CSS3DObject(reference.mount)
  for (const field of reference.fields) paintPanelField(field, {})
  const layer = new PanelLayer()
  layer.build([panel], [])
  const node = layer.group.children[0]
  const element: unknown = node && 'element' in node ? node.element : null
  expect(element).toBeInstanceOf(HTMLElement)
  if (!(element instanceof HTMLElement)) throw new Error('缺少原生卡片')
  expect(element.innerHTML).toBe(reference.mount.innerHTML)
  expect(element.getAttribute('style')).toBe(
    reference.mount.getAttribute('style'),
  )
  expect(element.dataset).toEqual(reference.mount.dataset)
  layer.dispose()
})
