/**
 * @fileoverview 图标部件：画这一格自己配的图标，没配时回落到部件上配的那一个。
 *
 * ⚠ 图标是**格的配置**（同 `label`）：部件是卡片级的，图标若只配在部件上，
 * 一整张卡片十个格会画同一个图标。部件上那个是**回落**，用于「整卡同一个图标」
 * 这种场合，不是主来源。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'icon',
  label: '图标',
  icon: 'image',
  hint: '画这一格配的图标（素材库）。格上没配时用这里的回落图标；两处都没有则整件不画。',
  slots: [],
  fields: [
    {
      key: 'fallback',
      label: '回落图标',
      type: 'image',
      default: '',
      span: 'full',
      help: '格上没配图标时画它。整卡用同一个图标时只配这里即可。',
    },
    {
      key: 'size',
      label: '尺寸 (px)',
      type: 'range',
      default: 20,
      min: 10,
      max: 72,
      step: 1,
      span: 'half',
    },
    {
      key: 'shape',
      label: '底衬',
      type: 'enum',
      default: 'none',
      span: 'half',
      options: [
        { value: 'none', label: '无' },
        { value: 'circle', label: '圆形' },
        { value: 'square', label: '圆角方' },
      ],
    },
  ],
  component: () => import('./Icon.vue'),
})
