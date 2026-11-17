/** @fileoverview 无数据绑定的分时区数字时钟。 */
import { defineModule } from '../../registry'

export default defineModule({
  type: 'clock',
  displayName: '数字时钟',
  category: '装饰',
  icon: 'gauge',
  chrome: 'bare',
  description:
    '数字时钟按所选时区显示当前日期与时间，适合大屏页头和运行监视画面。历史采样时刻应由数据节点呈现，不能用当前时钟代替。节点不接数据绑定，浏览器每秒更新一次，支持上海时间和协调世界时，以及秒数、日期与字号设置。卸载时清理更新定时器，多个时钟可以分别配置时区。',
  keywords: ['时间', '日期', '时钟', 'clock'],
  defaultSize: { width: 320, height: 40, minWidth: 120, minHeight: 24 },
  configSchema: [
    {
      key: 'timezone',
      label: '时区',
      type: 'enum',
      span: 'half',
      default: 'Asia/Shanghai',
      options: [
        { value: 'Asia/Shanghai', label: '北京时间' },
        { value: 'UTC', label: 'UTC' },
      ],
    },
    {
      key: 'showDate',
      label: '显示日期',
      type: 'boolean',
      span: 'half',
      default: true,
    },
    {
      key: 'showSeconds',
      label: '显示秒',
      type: 'boolean',
      span: 'half',
      default: true,
    },
    {
      key: 'fontSize',
      label: '字号',
      type: 'number',
      span: 'half',
      default: 20,
      min: 12,
      max: 80,
    },
    {
      key: 'align',
      label: '对齐',
      type: 'enum',
      span: 'half',
      default: 'right',
      options: [
        { value: 'left', label: '左' },
        { value: 'center', label: '中' },
        { value: 'right', label: '右' },
      ],
    },
    {
      key: 'opacity',
      label: '不透明度',
      type: 'number',
      span: 'half',
      default: 0.75,
      min: 0,
      max: 1,
      step: 0.05,
    },
  ],
  bindings: [],
  component: () => import('./Component.vue'),
})
