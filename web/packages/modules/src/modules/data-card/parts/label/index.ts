/**
 * @fileoverview 名称部件：把这一格自己起的名字画出来。
 * ⚠ 名字是**格的配置**不是数据槽——没起名字的格整件不画，也不占位。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'label',
  label: '名称',
  icon: 'type',
  hint: '画这一格自己起的名字。没起名字的格不画这一件。',
  slots: [],
  fields: [
    {
      key: 'size',
      label: '字号 (px)',
      type: 'range',
      default: 12,
      min: 8,
      max: 48,
      step: 1,
      span: 'half',
    },
    {
      key: 'tone',
      label: '文字色',
      type: 'enum',
      default: 'secondary',
      span: 'half',
      options: [
        { value: 'secondary', label: '次要' },
        { value: 'primary', label: '正文' },
        { value: 'title', label: '标题色' },
        { value: 'accent', label: '强调色' },
      ],
    },
    {
      key: 'opacity',
      label: '透明度',
      type: 'range',
      default: 1,
      min: 0.2,
      max: 1,
      step: 0.05,
      span: 'half',
    },
  ],
  component: () => import('./Label.vue'),
})
