/**
 * @fileoverview 短标签部件：一段逐件配的静态短文字，如「1#」「A 区」。
 * ⚠ 它**不读槽**：标签是配置不是数据。要跟着点位变的文字用读数部件接 `state` 槽
 * 并配枚举映射，别在这里塞第二条取数路。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'tag',
  label: '短标签',
  icon: 'paperclip',
  hint: '一段固定的短文字，如编号或分区。不接数据源；留空则整件不画。',
  slots: [],
  fields: [
    {
      key: 'text',
      label: '文字',
      type: 'string',
      default: '',
      span: 'full',
      placeholder: '如 1# / A 区',
    },
    {
      key: 'look',
      label: '样式',
      type: 'enum',
      default: 'chip',
      span: 'half',
      options: [
        { value: 'chip', label: '胶囊' },
        { value: 'plain', label: '纯文字' },
        { value: 'outline', label: '描边' },
      ],
    },
    {
      key: 'size',
      label: '字号 (px)',
      type: 'range',
      default: 11,
      min: 8,
      max: 24,
      step: 1,
      span: 'half',
    },
    {
      key: 'color',
      label: '颜色',
      type: 'color',
      default: '',
      span: 'half',
      help: '留空则跟随卡片的次要文字色。',
    },
  ],
  component: () => import('./Tag.vue'),
})
