/**
 * @fileoverview DtSegmented 的展示：纯文字、图标 + 文字、只给图标三种选项写法，
 * 加三档尺寸。⚠ 它切的是同一块内容的**呈现**，不是导航。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { DtSegmentedOption } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtSegmented } from '../src'

const VIEWS: DtSegmentedOption[] = [
  { value: 'table', label: '表格' },
  { value: 'card', label: '卡片' },
]

const VIEWS_WITH_ICON: DtSegmentedOption[] = [
  { value: 'table', label: '表格', icon: 'table' },
  { value: 'card', label: '卡片', icon: 'layout-grid' },
]

const VIEWS_ICON_ONLY: DtSegmentedOption[] = [
  { value: 'table', label: '表格视图', icon: 'table', iconOnly: true },
  { value: 'card', label: '卡片视图', icon: 'layout-grid', iconOnly: true },
]

const RANGES: DtSegmentedOption[] = [
  { value: '1h', label: '近 1 小时' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

const meta = {
  title: '表单/DtSegmented 分段切换',
  component: DtSegmented,
  parameters: {
    docs: {
      description: {
        component:
          '分段切换器，`v-model` 收字符串。用 `<button>` 而不是 `<a>`：' +
          '它切换的是**同一块内容的呈现**（表格 / 卡片、近 1 小时 / 近 7 天），' +
          '不是导航——地址会变、要能新标签打开的场景请用链接。' +
          '选中态同时给 `aria-pressed`：只靠颜色区分，对读屏和色觉障碍都不成立。' +
          '`iconOnly` 的项文字仍会保留给读屏，不会变成一个没有名字的方块。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'text' },
    size: { control: 'inline-radio', options: DT_SIZES },
    ariaLabel: { control: 'text', description: '给整组一个名字' },
  },
  args: {
    modelValue: 'table',
    options: VIEWS_WITH_ICON,
    size: 'sm',
    ariaLabel: '展示方式',
  },
} satisfies Meta<typeof DtSegmented>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtSegmented },
    setup() {
      const view = ref('table')
      return { args, view }
    },
    template: `
      <div class="sb-col">
        <DtSegmented v-bind="args" v-model="view" />
        <p class="sb-note">当前取值：{{ view }}</p>
      </div>
    `,
  }),
}

/** 三种选项写法并排：纯文字 / 图标 + 文字 / 只给图标。 */
export const 选项写法: Story = {
  render: (args) => ({
    components: { DtSegmented },
    setup() {
      const a = ref('table')
      const b = ref('table')
      const c = ref('table')
      return { args, a, b, c, VIEWS, VIEWS_WITH_ICON, VIEWS_ICON_ONLY }
    },
    template: `
      <div class="sb-col">
        <div class="sb-group">
          <p class="sb-group__title">纯文字</p>
          <DtSegmented v-bind="args" v-model="a" :options="VIEWS" />
        </div>
        <div class="sb-group">
          <p class="sb-group__title">图标 + 文字</p>
          <DtSegmented v-bind="args" v-model="b" :options="VIEWS_WITH_ICON" />
        </div>
        <div class="sb-group">
          <p class="sb-group__title">只给图标（文字留给读屏）</p>
          <DtSegmented v-bind="args" v-model="c" :options="VIEWS_ICON_ONLY" />
        </div>
      </div>
    `,
  }),
}

/** 三档尺寸。缺省是 sm——它多半贴在工具条里，不该比正文更抢眼。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtSegmented },
    setup: () => ({ args, sizes: DT_SIZES, VIEWS_WITH_ICON }),
    template: `
      <div class="sb-col">
        <div v-for="size in sizes" :key="size" class="sb-row">
          <span class="sb-label sb-w-xs">size = {{ size }}</span>
          <DtSegmented v-bind="args" :size="size" :options="VIEWS_WITH_ICON" />
        </div>
      </div>
    `,
  }),
}

/** 多个选项：时间范围这类四五项的切换也用它，再多就该换下拉。 */
export const 多个选项: Story = {
  render: (args) => ({
    components: { DtSegmented },
    setup() {
      const range = ref('24h')
      return { args, range, RANGES }
    },
    template: `
      <div class="sb-col">
        <DtSegmented v-bind="args" v-model="range" :options="RANGES" aria-label="时间范围" />
        <p class="sb-note">当前范围：{{ range }}</p>
      </div>
    `,
  }),
}
