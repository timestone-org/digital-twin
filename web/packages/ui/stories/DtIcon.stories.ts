/**
 * @fileoverview DtIcon 的展示：注册表里的全部图标，以及边长 / 描边 / 旋转三个开关。
 * ⚠ 未登记的名字什么都不渲染、也不报错，这条单独占一个 story 摆出来。
 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtIcon, ICONS } from '../src'

const ICON_NAMES = Object.keys(ICONS)

const meta = {
  title: '通用/DtIcon 图标',
  component: DtIcon,
  parameters: {
    docs: {
      description: {
        component:
          '图标按名字从受控注册表里取，颜色继承 `currentColor`，所以放进按钮、' +
          '标签或正文里都会自动跟着文字变色。' +
          '⚠ 传入未登记的名字**不会报错**，只会什么都不渲染——名字的正确性靠 ' +
          '`DtIcon.contract.spec.ts` 扫模板里的字面量兜住。',
      },
    },
  },
  argTypes: {
    name: {
      control: 'select',
      options: ICON_NAMES,
      description: '图标名，必须已在 `registry.ts` 登记',
    },
    size: { control: { type: 'range', min: 12, max: 64, step: 2 } },
    strokeWidth: { control: { type: 'range', min: 1, max: 4, step: 0.5 } },
    spin: { control: 'boolean', description: '持续旋转，用于加载态' },
  },
  args: { name: 'activity', size: 18, strokeWidth: 2, spin: false },
} satisfies Meta<typeof DtIcon>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {}

/** 注册表全集。要用的名字先在这里找，没有就先往 `registry.ts` 里加。 */
export const 全部图标: Story = {
  render: (args) => ({
    components: { DtIcon },
    setup: () => ({ args, names: ICON_NAMES }),
    template: `
      <div class="sb-grid">
        <div v-for="name in names" :key="name" class="sb-group">
          <div class="sb-row">
            <DtIcon v-bind="args" :name="name" :size="24" />
            <span class="sb-label sb-label--mono">{{ name }}</span>
          </div>
        </div>
      </div>
    `,
  }),
}

/** 边长是纯数字（px）。非有限值与负数会回落到 18，不会画出非法的 width。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtIcon },
    setup: () => ({ args, sizes: [12, 16, 18, 24, 32, 48, 64] }),
    template: `
      <div class="sb-row">
        <div v-for="size in sizes" :key="size" class="sb-col">
          <DtIcon v-bind="args" name="settings" :size="size" />
          <span class="sb-label">{{ size }}px</span>
        </div>
      </div>
    `,
  }),
}

/** 描边粗细。图标是 stroke 绘制，粗细变化比尺寸更影响观感。 */
export const 描边粗细: Story = {
  render: (args) => ({
    components: { DtIcon },
    setup: () => ({ args, widths: [1, 1.5, 2, 2.5, 3] }),
    template: `
      <div class="sb-row">
        <div v-for="width in widths" :key="width" class="sb-col">
          <DtIcon v-bind="args" name="shield-check" :size="36" :stroke-width="width" />
          <span class="sb-label">{{ width }}</span>
        </div>
      </div>
    `,
  }),
}

/** 旋转：常用于「正在同步 / 正在重试」这类不确定时长的动作。 */
export const 旋转: Story = {
  args: { spin: true },
  render: (args) => ({
    components: { DtIcon },
    setup: () => ({ args }),
    template: `
      <div class="sb-row">
        <DtIcon v-bind="args" name="activity" :size="28" />
        <DtIcon v-bind="args" name="route" :size="28" />
        <DtIcon v-bind="args" name="settings" :size="28" />
      </div>
    `,
  }),
}

/** 颜色继承 currentColor：外层文字什么色，图标就什么色。 */
export const 跟随文字颜色: Story = {
  render: (args) => ({
    components: { DtIcon },
    setup: () => ({
      args,
      colors: [
        ['--text-primary', '正文'],
        ['--accent-primary', '主色'],
        ['--state-success', '成功'],
        ['--state-warning', '警告'],
        ['--state-danger', '危险'],
        ['--text-disabled', '次要'],
      ],
    }),
    template: `
      <div class="sb-row">
        <span
          v-for="[token, label] in colors"
          :key="token"
          class="sb-row"
          :style="{ color: 'var(' + token + ')' }"
        >
          <DtIcon v-bind="args" name="activity" :size="20" />
          {{ label }}
        </span>
      </div>
    `,
  }),
}

/** ⚠ 未登记的名字：位置空着，控制台一声不吭。左边是对照组。 */
export const 未登记的名字: Story = {
  render: (args) => ({
    components: { DtIcon },
    setup: () => ({ args }),
    template: `
      <div class="sb-row">
        <div class="sb-group">
          <p class="sb-group__title">已登记 name="check"</p>
          <DtIcon v-bind="args" name="check" :size="32" />
        </div>
        <div class="sb-group">
          <p class="sb-group__title">未登记 name="没有这个图标"</p>
          <DtIcon v-bind="args" name="没有这个图标" :size="32" />
        </div>
      </div>
    `,
  }),
}
