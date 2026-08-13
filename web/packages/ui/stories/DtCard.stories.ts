/**
 * @fileoverview DtCard 的展示：标题区三种写法、四角括号、三档内边距与页脚。
 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtCard, DtTag } from '../src'

const meta = {
  title: '数据展示/DtCard 卡片',
  component: DtCard,
  parameters: {
    docs: {
      description: {
        component:
          '面板外框：底色 + 描边 + 圆角，可选四角发光括号。' +
          '卡片长什么样只有这一处定义，取值全部来自 `--card-*` 复合层。' +
          '⚠ 页面里不要再手写「边框 + 圆角 + 半透明底」那三行：抄一遍就多一份' +
          '会各自漂移的卡片，而这种参差要把两张卡摆在一起才看得出来。',
      },
    },
  },
  argTypes: {
    title: { control: 'text' },
    subtitle: { control: 'text' },
    icon: { control: 'text', description: '标题前的图标名' },
    corners: {
      control: 'boolean',
      description: '四角发光括号；密集列表里别开',
    },
    padding: { control: 'inline-radio', options: ['none', 'sm', 'md'] },
  },
  args: {
    title: '采集通道 CH-07',
    subtitle: 'OPC UA · 边缘网关 EG-02',
    icon: 'activity',
    corners: false,
    padding: 'md',
  },
} satisfies Meta<typeof DtCard>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtCard },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-lg">
        <DtCard v-bind="args">
          <p class="sb-label">卡片正文。默认插槽里放什么都行。</p>
        </DtCard>
      </div>
    `,
  }),
}

/** 标题区三种写法：只有标题 / 标题 + 副标题 + 图标 / 完全自定义 header。 */
export const 标题区: Story = {
  render: (args) => ({
    components: { DtCard, DtTag },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtCard v-bind="args" :subtitle="undefined" :icon="undefined" title="只有标题">
          <p class="sb-label">最常见的一张卡。</p>
        </DtCard>

        <DtCard v-bind="args">
          <p class="sb-label">标题 + 副标题 + 图标。</p>
        </DtCard>

        <DtCard v-bind="args" :title="undefined">
          <template #header>
            <div class="sb-row">
              <DtTag intent="success">在线</DtTag>
              <span>完全自定义的 header 插槽</span>
            </div>
          </template>
          <p class="sb-label">给了 header 插槽，title / subtitle / icon 就都不生效了。</p>
        </DtCard>

        <DtCard v-bind="args" :title="undefined" :subtitle="undefined" :icon="undefined">
          <p class="sb-label">什么都不给：连头部都不渲染，只剩一个外框。</p>
        </DtCard>
      </div>
    `,
  }),
}

/** actions 插槽：右上角的操作区，与标题同一行。 */
export const 右上角操作: Story = {
  render: (args) => ({
    components: { DtButton, DtCard },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-lg">
        <DtCard v-bind="args">
          <template #actions>
            <DtButton size="sm" variant="ghost" intent="neutral" icon="pencil" aria-label="编辑" />
            <DtButton size="sm" variant="ghost" intent="danger" icon="trash" aria-label="删除" />
          </template>
          <p class="sb-label">操作按钮统一挂在 actions 插槽里，不要塞进正文。</p>
        </DtCard>
      </div>
    `,
  }),
}

/** 四角发光括号：给「主角卡」用。一屏里逐张都开会很吵。 */
export const 四角括号: Story = {
  render: (args) => ({
    components: { DtCard },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtCard v-bind="args" title="corners 关（缺省）" :corners="false">
          <p class="sb-label">列表里的卡片一律关。</p>
        </DtCard>
        <DtCard v-bind="args" title="corners 开" corners>
          <p class="sb-label">大屏上的重点面板才开。</p>
        </DtCard>
      </div>
    `,
  }),
}

/** 三档内边距。`none` 用于「卡片里直接铺一张表」这种自带内边距的内容。 */
export const 内边距: Story = {
  render: (args) => ({
    components: { DtCard },
    setup: () => ({ args, paddings: ['none', 'sm', 'md'] }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtCard
          v-for="padding in paddings"
          :key="padding"
          v-bind="args"
          :padding="padding"
          :title="'padding = ' + padding"
          :subtitle="undefined"
          :icon="undefined"
        >
          <p class="sb-label">正文与外框的距离。</p>
        </DtCard>
      </div>
    `,
  }),
}

/** 页脚：放汇总、次要说明或底部操作条。 */
export const 页脚: Story = {
  render: (args) => ({
    components: { DtButton, DtCard },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-lg">
        <DtCard v-bind="args">
          <p class="sb-label">正文。</p>
          <template #footer>
            <div class="sb-row" style="justify-content: space-between; width: 100%">
              <span class="sb-label">最近一次同步：3 秒前</span>
              <DtButton size="sm" variant="outline" intent="neutral">立即同步</DtButton>
            </div>
          </template>
        </DtCard>
      </div>
    `,
  }),
}
