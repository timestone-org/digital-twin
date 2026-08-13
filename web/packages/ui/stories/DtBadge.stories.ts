/**
 * @fileoverview DtBadge 的展示：计数、上限溢出、红点、语义色与「0 显不显示」。
 * ⚠ 它必须挂在别的元素身上：默认插槽是被标注的那个东西，不是徽标的文字。
 */
import { DT_INTENTS } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtBadge, DtButton, DtIcon } from '../src'

const meta = {
  title: '通用/DtBadge 徽标',
  component: DtBadge,
  parameters: {
    docs: {
      description: {
        component:
          '贴在默认插槽右上角的计数或红点。计数超过 `max` 显示 `n+`；' +
          '`value` 为 0 时默认整个徽标不渲染，要显示得显式开 `showZero`。' +
          '红点没有可读内容，组件会自动补一个可访问名称。',
      },
    },
  },
  argTypes: {
    value: { control: 'text', description: '计数或短文本；空值不渲染徽标' },
    max: { control: 'number', description: '计数上限，超了显示 `n+`' },
    dot: { control: 'boolean', description: '退化成不带数字的小圆点' },
    intent: { control: 'inline-radio', options: DT_INTENTS },
    showZero: { control: 'boolean', description: '计数为 0 时也显示' },
    ariaLabel: { control: 'text', description: '覆盖读屏读到的名称' },
  },
  args: { value: 8, max: 99, dot: false, intent: 'danger', showZero: false },
} satisfies Meta<typeof DtBadge>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtBadge, DtButton },
    setup: () => ({ args }),
    template: `
      <DtBadge v-bind="args">
        <DtButton variant="outline" intent="neutral" icon="activity" aria-label="告警" />
      </DtBadge>
    `,
  }),
}

/** 计数与溢出：`max` 决定几位数之后折成 `n+`。 */
export const 计数与溢出: Story = {
  render: (args) => ({
    components: { DtBadge, DtIcon },
    setup: () => ({ args, values: [1, 9, 42, 99, 100, 1280] }),
    template: `
      <div class="sb-row">
        <div v-for="value in values" :key="value" class="sb-col">
          <DtBadge v-bind="args" :value="value">
            <DtIcon name="activity" :size="28" />
          </DtBadge>
          <span class="sb-label">value = {{ value }}</span>
        </div>
      </div>
    `,
  }),
}

/** 上限可调：同一个 128 在不同 `max` 下的写法。 */
export const 自定义上限: Story = {
  render: (args) => ({
    components: { DtBadge, DtIcon },
    setup: () => ({ args, maxes: [9, 50, 99, 999] }),
    template: `
      <div class="sb-row">
        <div v-for="max in maxes" :key="max" class="sb-col">
          <DtBadge v-bind="args" :value="128" :max="max">
            <DtIcon name="activity" :size="28" />
          </DtBadge>
          <span class="sb-label">max = {{ max }}</span>
        </div>
      </div>
    `,
  }),
}

/** 红点：只表示「有新内容」，不给数量。 */
export const 红点: Story = {
  args: { dot: true },
  render: (args) => ({
    components: { DtBadge, DtButton, DtIcon },
    setup: () => ({ args, intents: DT_INTENTS }),
    template: `
      <div class="sb-row">
        <DtBadge v-for="intent in intents" :key="intent" v-bind="args" :intent="intent">
          <DtIcon name="activity" :size="28" />
        </DtBadge>
        <DtBadge v-bind="args">
          <DtButton variant="ghost" intent="neutral">消息中心</DtButton>
        </DtBadge>
      </div>
    `,
  }),
}

/** 语义色。默认是 danger——徽标多半在报「有多少件待处理」。 */
export const 语义色: Story = {
  render: (args) => ({
    components: { DtBadge, DtIcon },
    setup: () => ({ args, intents: DT_INTENTS }),
    template: `
      <div class="sb-row">
        <div v-for="intent in intents" :key="intent" class="sb-col">
          <DtBadge v-bind="args" :intent="intent" :value="6">
            <DtIcon name="activity" :size="28" />
          </DtBadge>
          <span class="sb-label">{{ intent }}</span>
        </div>
      </div>
    `,
  }),
}

/** 0 与空值：默认都不渲染徽标，`showZero` 单独把 0 拉回来。 */
export const 零与空值: Story = {
  render: (args) => ({
    components: { DtBadge, DtIcon },
    setup: () => ({ args }),
    template: `
      <div class="sb-row">
        <div class="sb-col">
          <DtBadge v-bind="args" :value="0"><DtIcon name="activity" :size="28" /></DtBadge>
          <span class="sb-label">value=0，默认不显示</span>
        </div>
        <div class="sb-col">
          <DtBadge v-bind="args" :value="0" show-zero>
            <DtIcon name="activity" :size="28" />
          </DtBadge>
          <span class="sb-label">value=0 + showZero</span>
        </div>
        <div class="sb-col">
          <DtBadge v-bind="args" :value="undefined">
            <DtIcon name="activity" :size="28" />
          </DtBadge>
          <span class="sb-label">value 未给，不显示</span>
        </div>
      </div>
    `,
  }),
}

/** 文本徽标：短到两三个字才行，长文本请改用 DtTag。 */
export const 文本徽标: Story = {
  render: (args) => ({
    components: { DtBadge, DtButton },
    setup: () => ({ args }),
    template: `
      <div class="sb-row">
        <DtBadge v-bind="args" value="新" intent="success">
          <DtButton variant="outline" intent="neutral">导出报表</DtButton>
        </DtBadge>
        <DtBadge v-bind="args" value="beta" intent="info">
          <DtButton variant="outline" intent="neutral">三维视图</DtButton>
        </DtBadge>
      </div>
    `,
  }),
}
