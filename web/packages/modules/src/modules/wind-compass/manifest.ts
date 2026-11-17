/** @fileoverview 气象风向罗盘的配置与三个独立数据槽。 */
import { defineModule } from '../../registry'

export default defineModule({
  type: 'wind-compass',
  displayName: '风向罗盘',
  description:
    '风向罗盘将气象风向角映射为正北起顺时针的八方位指针，并同时呈现风速和气温。只比较风速变化时应选择趋势曲线。三个独立标量槽 direction、speed、temperature 分别接收角度、米每秒和摄氏度，负角及超过一周的角度自动归一。缺失或取数失败时隐藏指针并保留对应状态，避免被误读成北风。',
  category: '数据',
  icon: 'wind',
  keywords: ['风向', '风速', '气象', '罗盘', 'wind', 'compass'],
  defaultSize: { width: 456, height: 246, minWidth: 220, minHeight: 180 },
  contentKeys: ['title'],
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      span: 'half',
      default: '风向 · 风速',
    },
    {
      key: 'accent',
      label: '指针颜色',
      type: 'color',
      span: 'half',
      default: 'var(--accent-primary)',
    },
    {
      key: 'valueSize',
      label: '读数字号',
      type: 'number',
      span: 'half',
      default: 22,
      min: 12,
      max: 48,
    },
  ],
  bindings: [
    { key: 'direction', label: '风向 (°)', dataType: 'number' },
    { key: 'speed', label: '风速 (m/s)', dataType: 'number' },
    { key: 'temperature', label: '气温 (°C)', dataType: 'number' },
  ],
  ownsStatusDisplay: true,
  preview: { values: { direction: 45, speed: 3.6, temperature: 18.1 } },
  component: () => import('./Component.vue'),
})
