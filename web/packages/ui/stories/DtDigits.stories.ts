/**
 * @fileoverview DtDigits 的展示：把数字锁成等宽，读数每秒跳一次也不抖。
 * 对照组是同样的字符串直接写在正文里——并排看才看得出抖动来自哪里。
 */
import { onUnmounted, ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtDigits } from '../src'

const meta = {
  title: '通用/DtDigits 等宽数字',
  component: DtDigits,
  parameters: {
    docs: {
      description: {
        component:
          '时钟、读数这类**每秒都在变**的数字串专用：只给 ASCII 数字锁等宽，' +
          '`:`、`-`、单位与中文照常按自己的字宽排。' +
          '不锁的话 1 比 8 窄一截，整串的长度会跟着数值变，看着像在抖。',
      },
    },
  },
  argTypes: { value: { control: 'text', description: '要显示的字符串' } },
  args: { value: '2026-08-13 09:41:07' },
} satisfies Meta<typeof DtDigits>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {}

/** 走字的时钟。左边锁宽、右边不锁，看右边的冒号位置。 */
export const 走字对照: Story = {
  render: () => ({
    components: { DtDigits },
    setup() {
      const now = ref('00:00:00')
      let tick = 0
      const timer = setInterval(() => {
        tick += 1
        const pad = (value: number): string => String(value).padStart(2, '0')
        now.value = `${pad(Math.floor(tick / 3600) % 24)}:${pad(Math.floor(tick / 60) % 60)}:${pad(tick % 60)}`
      }, 1000)
      onUnmounted(() => clearInterval(timer))
      return { now }
    },
    template: `
      <div class="sb-col">
        <div class="sb-group">
          <p class="sb-group__title">DtDigits（锁宽）</p>
          <DtDigits :value="now" />
        </div>
        <div class="sb-group">
          <p class="sb-group__title">普通文本（不锁宽，冒号会左右晃）</p>
          <span>{{ now }}</span>
        </div>
      </div>
    `,
  }),
}

/** 常见读数：带单位、带正负号、带千分位。 */
export const 读数: Story = {
  render: () => ({
    components: { DtDigits },
    setup: () => ({
      rows: [
        ['进水流量', '1,284.05 m³/h'],
        ['出口压力', '0.62 MPa'],
        ['温差', '-12.8 ℃'],
        ['运行时长', '128:04:19'],
        ['本班产量', '9,860 件'],
      ],
    }),
    template: `
      <div class="sb-col">
        <div v-for="[label, value] in rows" :key="label" class="sb-row">
          <span class="sb-label sb-w-xs">{{ label }}</span>
          <DtDigits :value="value" />
        </div>
      </div>
    `,
  }),
}

/** 非数字字符原样排：中文、单位、符号都不受影响。 */
export const 混排: Story = {
  render: () => ({
    components: { DtDigits },
    setup: () => ({
      samples: ['第 3 号泵 · 转速 1480 rpm', '批次 A-20260813-007', '≈ 99.95%'],
    }),
    template: `
      <div class="sb-col">
        <DtDigits v-for="text in samples" :key="text" :value="text" />
      </div>
    `,
  }),
}
