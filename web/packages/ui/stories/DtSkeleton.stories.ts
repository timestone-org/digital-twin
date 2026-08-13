/**
 * @fileoverview DtSkeleton 的展示：块、多行文本、圆形，以及拼出一张卡片骨架。
 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtCard, DtSkeleton } from '../src'

const meta = {
  title: '反馈/DtSkeleton 骨架',
  component: DtSkeleton,
  parameters: {
    docs: {
      description: {
        component:
          '加载骨架（流光）。它**只占位**，不表达「正在加载」——' +
          '读屏要知道的话，由外面的容器挂 `aria-busy` 来说。' +
          '尺寸由外层容器给：想要多宽多高，就把它放进那么宽那么高的盒子里。' +
          '`lines > 0` 时渲染多行文本骨架，末行会短一截，看着像一段自然结束的文字。',
      },
    },
  },
  argTypes: {
    lines: {
      control: { type: 'number', min: 0, max: 8 },
      description: '>0 渲染多行文本骨架',
    },
    circle: { control: 'boolean', description: '圆形，用于头像与状态点' },
  },
  args: { lines: 0, circle: false },
} satisfies Meta<typeof DtSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtSkeleton },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-md" style="height: 80px">
        <DtSkeleton v-bind="args" />
      </div>
    `,
  }),
}

/** 一块：高度与宽度由外层容器决定。 */
export const 块: Story = {
  render: (args) => ({
    components: { DtSkeleton },
    setup: () => ({ args }),
    template: `
      <div class="sb-col">
        <div class="sb-w-md" style="height: 16px"><DtSkeleton v-bind="args" /></div>
        <div class="sb-w-md" style="height: 40px"><DtSkeleton v-bind="args" /></div>
        <div class="sb-w-lg" style="height: 120px"><DtSkeleton v-bind="args" /></div>
      </div>
    `,
  }),
}

/** 多行文本：末行短一截。行数非正或非有限值一律当 0。 */
export const 多行文本: Story = {
  render: (args) => ({
    components: { DtSkeleton },
    setup: () => ({ args, counts: [1, 2, 3, 5] }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <div v-for="count in counts" :key="count" class="sb-group">
          <p class="sb-group__title">lines = {{ count }}</p>
          <DtSkeleton v-bind="args" :lines="count" />
        </div>
      </div>
    `,
  }),
}

/** 圆形：头像、状态点。同样靠外层容器定尺寸。 */
export const 圆形: Story = {
  args: { circle: true },
  render: (args) => ({
    components: { DtSkeleton },
    setup: () => ({ args, sizes: [16, 24, 40, 64] }),
    template: `
      <div class="sb-row">
        <div v-for="size in sizes" :key="size" :style="{ width: size + 'px', height: size + 'px' }">
          <DtSkeleton v-bind="args" />
        </div>
      </div>
    `,
  }),
}

/** 拼一张卡片的骨架：结构越贴近真实内容，加载完的跳动越小。 */
export const 卡片骨架: Story = {
  render: (args) => ({
    components: { DtCard, DtSkeleton },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtCard v-for="n in 2" :key="n" padding="md">
          <div class="sb-row sb-row--top">
            <div style="width: 40px; height: 40px">
              <DtSkeleton v-bind="args" circle />
            </div>
            <div style="flex: 1">
              <DtSkeleton v-bind="args" :lines="3" />
            </div>
          </div>
        </DtCard>
      </div>
    `,
  }),
}
