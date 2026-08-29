/**
 * @fileoverview 附加字段部件：「标签 + 读数 + 单位」一小条，读 `extra1..3` 或两个
 * 副读数槽。
 *
 * ⚠ 摆多个就是多个字段，各自选槽——这正是扁平部件表相对 info-list 那份 `extras: []`
 * 数组的好处：顺序、排布、字号逐个可调，而不是三个共用一套（§11.4）。
 * ⚠ 单位在这里是**逐件配**的，不吃格级单位：附加字段装的是另一种量（功率 / 温度 /
 * 流量），硬套主读数的单位就是在墙上写错单位。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'extra',
  label: '附加字段',
  icon: 'list-checks',
  hint: '一小条「标签 + 读数 + 单位」。摆多个就是多个字段，各自选读哪个槽。取不到值时画占位符。',
  slots: ['aux', 'aux2', 'extra1', 'extra2', 'extra3'],
  fields: [
    {
      key: 'slot',
      label: '读哪个槽',
      type: 'enum',
      default: 'extra1',
      span: 'half',
      options: [
        { value: 'extra1', label: '附加字段一' },
        { value: 'extra2', label: '附加字段二' },
        { value: 'extra3', label: '附加字段三' },
        { value: 'aux', label: '副读数' },
        { value: 'aux2', label: '第三个数' },
      ],
    },
    {
      key: 'label',
      label: '标签',
      type: 'string',
      default: '',
      span: 'half',
      placeholder: '如 功率',
      help: '留空则只画读数。',
    },
    {
      key: 'unit',
      label: '单位',
      type: 'string',
      default: '',
      span: 'half',
      placeholder: '如 kW',
      help: '逐件配；不吃格级单位——附加字段装的多半是另一种量。',
    },
    {
      key: 'precision',
      label: '小数位',
      type: 'range',
      default: 1,
      min: 0,
      max: 6,
      step: 1,
      span: 'half',
    },
    {
      key: 'size',
      label: '字号 (px)',
      type: 'range',
      default: 12,
      min: 8,
      max: 32,
      step: 1,
      span: 'half',
    },
    {
      key: 'color',
      label: '读数色',
      type: 'color',
      default: '',
      span: 'half',
      help: '留空则跟随卡片的正文色。',
    },
  ],
  component: () => import('./Extra.vue'),
})
