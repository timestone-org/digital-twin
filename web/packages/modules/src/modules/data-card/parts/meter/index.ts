/**
 * @fileoverview 进度条部件：把这一格的读数画成一条占比。画法整件复用
 * `shared/MeterBar.vue`——info-list 的行里用的是同一份，不留第二套 CSS。
 *
 * ⚠ 占比优先读 `ratio` 槽；没接就由 `value` 与这里配的量程算。两条路都算不出时整件
 * 不画——**绝不拿 0% 冒充「算不出来」**，那会让一条满量程的管道看着像空的。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'meter',
  label: '进度条',
  icon: 'gauge',
  hint: '把读数画成一条占比。接了「占比」槽就直接用它，否则按下面的量程算。',
  slots: ['value', 'ratio', 'aux'],
  fields: [
    {
      key: 'look',
      label: '形态',
      type: 'enum',
      default: 'bar',
      span: 'half',
      help: '细条 = 小字 + 占比读数 + 轨道；粗轨道另带四根刻度与目标标记。',
      options: [
        { value: 'bar', label: '细条' },
        { value: 'track', label: '粗轨道' },
      ],
    },
    {
      key: 'caption',
      label: '条前小字',
      type: 'string',
      default: '',
      span: 'half',
      placeholder: '如 占比 / 液位；留空则不画',
    },
    {
      key: 'min',
      label: '量程下限',
      type: 'number',
      default: 0,
      span: 'half',
      help: '接了「占比」槽时这两项不参与计算。',
    },
    {
      key: 'max',
      label: '量程上限',
      type: 'number',
      default: 100,
      span: 'half',
    },
    {
      key: 'height',
      label: '条高 (px)',
      type: 'range',
      default: 4,
      min: 2,
      max: 24,
      step: 1,
      span: 'half',
    },
    {
      key: 'width',
      label: '条宽 (px)',
      type: 'range',
      default: 0,
      min: 0,
      max: 400,
      step: 4,
      span: 'half',
      help: '0 = 铺满整格。',
    },
    {
      key: 'color',
      label: '颜色',
      type: 'color',
      default: '',
      span: 'half',
      placeholder: '留空 = 跟随强调色',
      help: '只填 var(--…) 引用，填死色值换肤时不跟着走。',
    },
    {
      key: 'glow',
      label: '辉光 (px)',
      type: 'range',
      default: 6,
      min: 0,
      max: 24,
      step: 1,
      span: 'half',
    },
    {
      key: 'showPercent',
      label: '显示占比',
      type: 'boolean',
      default: true,
      span: 'half',
      // ⚠ 占比读数不夹到 100：120% 正是要让人看见的那个异常
      help: '⚠ 条宽夹在 0–100% 之间，而这个读数不夹——120% 正是要让人看见的那个异常。',
    },
    {
      key: 'dot',
      label: '条前圆点',
      type: 'boolean',
      default: false,
      span: 'half',
    },
    {
      key: 'showTarget',
      label: '目标标记',
      type: 'boolean',
      default: false,
      span: 'half',
      help: '接了「对比值」槽才画，画在量程上的那个位置。只有粗轨道有。',
      when: { key: 'look', in: ['track'] },
    },
    {
      key: 'targetLabel',
      label: '目标标注',
      type: 'string',
      default: '目标 ',
      span: 'half',
      when: { key: 'showTarget', in: [true] },
    },
  ],
  component: () => import('./Meter.vue'),
})
