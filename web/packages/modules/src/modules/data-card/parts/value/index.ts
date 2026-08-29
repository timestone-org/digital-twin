/**
 * @fileoverview 读数部件：这一格的主读数 + 单位。卡片上最常摆的那一件。
 * ⚠ 单位与小数位取**格级口径**，不在这里重配：同一格里三个部件读同一个值却显示成
 * 三种小数位，是用户第一眼就会当成 bug 的那种不一致（`CardCellFormat`）。
 */
import { defineCardPart } from '../../../../cardParts/define'

export default defineCardPart({
  kind: 'value',
  label: '读数',
  icon: 'ruler',
  hint: '这一格的主读数加单位。要把它画成一条占比用「进度条」。',
  slots: ['value'],
  fields: [
    {
      key: 'size',
      label: '字号 (px)',
      type: 'range',
      default: 0,
      min: 0,
      max: 200,
      step: 1,
      span: 'half',
      help: '0 = 跟着格宽自适应。填正数即钉死一个字号，多格并排时字号才对得齐。',
    },
    {
      key: 'color',
      label: '颜色',
      type: 'color',
      default: 'var(--accent-primary)',
      span: 'half',
      help: '只填 var(--…) 引用，填死色值换肤时不跟着走。',
    },
    {
      key: 'font',
      label: '字体',
      type: 'enum',
      default: 'digit',
      span: 'half',
      help: '数字字体是等宽的，读数逐帧跳动时列宽不抖。',
      options: [
        { value: 'digit', label: '数字字体' },
        { value: 'sans', label: '正文字体' },
      ],
    },
    {
      key: 'glow',
      label: '辉光 (px)',
      type: 'range',
      default: 0,
      min: 0,
      max: 24,
      step: 1,
      span: 'half',
    },
    {
      key: 'showUnit',
      label: '带单位',
      type: 'boolean',
      default: true,
      span: 'half',
      help: '单位取格级口径里的那一个；这里只管画不画。',
    },
    {
      key: 'unitSize',
      label: '单位字号 (px)',
      type: 'range',
      default: 12,
      min: 8,
      max: 32,
      step: 1,
      span: 'half',
      when: { key: 'showUnit', in: [true] },
    },
  ],
  component: () => import('./Value.vue'),
})
