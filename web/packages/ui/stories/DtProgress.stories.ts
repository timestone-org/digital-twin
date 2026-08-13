/**
 * @fileoverview DtProgress 的展示：条形 / 环形两种呈现 × 六种语义色 × 三档尺寸，
 * 加百分比标签、自定义 max 与未知进度。
 */
import { onUnmounted, ref } from 'vue'
import { DT_INTENTS, DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtProgress } from '../src'

const meta = {
  title: '数据展示/DtProgress 进度',
  component: DtProgress,
  parameters: {
    docs: {
      description: {
        component:
          '进度指示，条形轨道或环形描边两种呈现。' +
          '`indeterminate` 表示「不知道还要多久」：忽略 `value`，走循环动画，' +
          '并且**不报当前值**给读屏——报一个假的比不报更糟。' +
          '取值会按 `max` 归一并夹在 0–max 之间，越界与非有限值都不会画出坏图形。',
      },
    },
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100, step: 1 } },
    max: { control: 'number', description: '满值，缺省 100' },
    intent: { control: 'inline-radio', options: DT_INTENTS },
    size: { control: 'inline-radio', options: DT_SIZES },
    showLabel: { control: 'boolean', description: '显示百分比' },
    indeterminate: { control: 'boolean', description: '未知进度，忽略 value' },
    variant: { control: 'inline-radio', options: ['linear', 'circular'] },
  },
  args: {
    value: 62,
    max: 100,
    intent: 'primary',
    size: 'md',
    showLabel: true,
    indeterminate: false,
    variant: 'linear',
  },
} satisfies Meta<typeof DtProgress>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtProgress },
    setup: () => ({ args }),
    template: `<div class="sb-w-md"><DtProgress v-bind="args" /></div>`,
  }),
}

/** 条形 × 语义色。 */
export const 条形: Story = {
  render: (args) => ({
    components: { DtProgress },
    setup: () => ({ args, intents: DT_INTENTS }),
    template: `
      <div class="sb-col sb-w-lg">
        <div v-for="intent in intents" :key="intent" class="sb-row">
          <span class="sb-label sb-w-xs">{{ intent }}</span>
          <div class="sb-w-md">
            <DtProgress v-bind="args" :intent="intent" variant="linear" />
          </div>
        </div>
      </div>
    `,
  }),
}

/** 环形 × 语义色。环形适合放在卡片角落或大屏读数牌里。 */
export const 环形: Story = {
  args: { variant: 'circular' },
  render: (args) => ({
    components: { DtProgress },
    setup: () => ({ args, intents: DT_INTENTS }),
    template: `
      <div class="sb-row">
        <div v-for="intent in intents" :key="intent" class="sb-col">
          <DtProgress v-bind="args" :intent="intent" />
          <span class="sb-label">{{ intent }}</span>
        </div>
      </div>
    `,
  }),
}

/** 三档尺寸，两种呈现各一排。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtProgress },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-col">
        <div class="sb-group sb-w-lg">
          <p class="sb-group__title">linear</p>
          <div v-for="size in sizes" :key="size" class="sb-row">
            <span class="sb-label sb-w-xs">{{ size }}</span>
            <div class="sb-w-md"><DtProgress v-bind="args" :size="size" variant="linear" /></div>
          </div>
        </div>
        <div class="sb-group">
          <p class="sb-group__title">circular</p>
          <div class="sb-row">
            <div v-for="size in sizes" :key="size" class="sb-col">
              <DtProgress v-bind="args" :size="size" variant="circular" />
              <span class="sb-label">{{ size }}</span>
            </div>
          </div>
        </div>
      </div>
    `,
  }),
}

/** 各种取值：0、半程、满、越界与非 100 的 max。 */
export const 取值: Story = {
  render: (args) => ({
    components: { DtProgress },
    setup: () => ({
      args,
      cases: [
        [0, 100, '0%'],
        [50, 100, '50%'],
        [100, 100, '满'],
        [180, 100, '越界，夹回 100%'],
        [3, 8, 'max = 8，当前 3'],
        [1024, 4096, 'max = 4096，当前 1024'],
      ],
    }),
    template: `
      <div class="sb-col sb-w-lg">
        <div v-for="[value, max, note] in cases" :key="note" class="sb-row">
          <span class="sb-label sb-w-sm">{{ note }}</span>
          <div class="sb-w-md"><DtProgress v-bind="args" :value="value" :max="max" /></div>
        </div>
      </div>
    `,
  }),
}

/** 百分比标签开 / 关。 */
export const 百分比标签: Story = {
  render: (args) => ({
    components: { DtProgress },
    setup: () => ({ args }),
    template: `
      <div class="sb-col sb-w-lg">
        <DtProgress v-bind="args" :show-label="true" />
        <DtProgress v-bind="args" :show-label="false" />
        <div class="sb-row">
          <DtProgress v-bind="args" variant="circular" :show-label="true" />
          <DtProgress v-bind="args" variant="circular" :show-label="false" />
        </div>
      </div>
    `,
  }),
}

/** 未知进度：不报当前值，只表示「在动」。 */
export const 未知进度: Story = {
  args: { indeterminate: true },
  render: (args) => ({
    components: { DtProgress },
    setup: () => ({ args }),
    template: `
      <div class="sb-col sb-w-lg">
        <DtProgress v-bind="args" variant="linear" />
        <div class="sb-row">
          <DtProgress v-bind="args" variant="circular" size="sm" />
          <DtProgress v-bind="args" variant="circular" size="md" />
          <DtProgress v-bind="args" variant="circular" size="lg" />
        </div>
      </div>
    `,
  }),
}

/** 跑起来看：进度到 100% 后停住。 */
export const 走动的进度: Story = {
  render: (args) => ({
    components: { DtProgress },
    setup() {
      const value = ref(0)
      const timer = setInterval(() => {
        value.value = value.value >= 100 ? 0 : value.value + 4
      }, 400)
      onUnmounted(() => clearInterval(timer))
      return { args, value }
    },
    template: `
      <div class="sb-col sb-w-lg">
        <DtProgress v-bind="args" :value="value" variant="linear" />
        <DtProgress v-bind="args" :value="value" variant="circular" size="lg" />
      </div>
    `,
  }),
}
