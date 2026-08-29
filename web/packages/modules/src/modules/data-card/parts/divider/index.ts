/**
 * @fileoverview 分隔线部件：两段之间画一道线或留一段空。
 * ⚠ 它不接任何槽，也永远画得出来——所以是排布出问题时唯一还看得见的参照物。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'divider',
  label: '分隔线',
  icon: 'minus',
  hint: '两段之间的一道线或一段空。不接数据，只管间隔。',
  slots: [],
  fields: [
    {
      key: 'look',
      label: '画法',
      type: 'enum',
      default: 'line',
      span: 'half',
      options: [
        { value: 'line', label: '实线' },
        { value: 'dashed', label: '虚线' },
        { value: 'blank', label: '只留空' },
      ],
    },
    {
      key: 'gap',
      label: '上下留白 (px)',
      type: 'range',
      default: 6,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
    },
    {
      key: 'color',
      label: '线色',
      type: 'color',
      default: '',
      span: 'half',
      placeholder: '留空 = 跟随卡片边框色',
      // ⚠ 只填 var(--…) 引用：填死色值换肤时不跟着走
      help: '留空则跟随卡片边框色。只填 var(--…) 引用，填死色值换肤时不跟着走。',
      when: { key: 'look', in: ['line', 'dashed'] },
    },
  ],
  component: () => import('./Divider.vue'),
})
