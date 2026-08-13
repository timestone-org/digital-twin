/**
 * @fileoverview DtPagination 的展示：页码窗口与省略号、每页条数、边界与越界收敛。
 */
import { ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtPagination } from '../src'

const meta = {
  title: '数据展示/DtPagination 分页',
  component: DtPagination,
  parameters: {
    docs: {
      description: {
        component:
          '条目区间 + 页码 + 每页条数，一条 `nav` 装完。`page` 是 1 起的页码。' +
          '⚠ 越界的 `page` 不只是在渲染时夹住，还会把修正**回吐**给父组件：' +
          '删到最后一页只剩空页时，父组件仍持有旧页码去取数，' +
          '表格是空的、分页器却高亮着被夹回来的那一页，而点那一页因为「与当前页相同」' +
          '不会 emit——按钮就成了死键。' +
          '⚠ 换每页条数时组件会同时把页码打回第 1 页：在第 9 页把 size 从 10 改成 100，' +
          '不回第一页就直接落到一个空页，用户会以为数据没了。',
      },
    },
  },
  argTypes: {
    page: { control: 'number', description: '1 起的当前页' },
    size: { control: 'number', description: '每页条数' },
    total: { control: 'number', description: '总条数' },
    sizeOptions: {
      control: 'object',
      description: '每页条数备选，缺省 10/20/50/100',
    },
    ariaLabel: { control: 'text' },
  },
  args: { page: 3, size: 10, total: 486 },
} satisfies Meta<typeof DtPagination>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtPagination },
    setup() {
      const page = ref(3)
      const size = ref(10)
      return { args, page, size }
    },
    template: `
      <div class="sb-col">
        <DtPagination
          v-bind="args"
          :page="page"
          :size="size"
          @update:page="page = $event"
          @update:size="size = $event"
        />
        <p class="sb-note">当前：第 {{ page }} 页，每页 {{ size }} 条</p>
      </div>
    `,
  }),
}

/** 页码窗口：总页数少时全列出来，多了才在两侧收成省略号。 */
export const 页码窗口: Story = {
  render: (args) => ({
    components: { DtPagination },
    setup: () => ({
      args,
      cases: [
        [1, 30, '只有 3 页，全列出来'],
        [1, 486, '首页：右侧收省略号'],
        [25, 486, '中间页：两侧都收'],
        [49, 486, '末页：左侧收省略号'],
      ],
    }),
    template: `
      <div class="sb-col">
        <div v-for="[page, total, note] in cases" :key="note" class="sb-group">
          <p class="sb-group__title">{{ note }}</p>
          <DtPagination v-bind="args" :page="page" :total="total" />
        </div>
      </div>
    `,
  }),
}

/** 每页条数：备选项可以自定义；当前档不在备选里会被自动补进去。 */
export const 每页条数: Story = {
  render: (args) => ({
    components: { DtPagination },
    setup() {
      const size = ref(25)
      return { args, size }
    },
    template: `
      <div class="sb-col">
        <div class="sb-group">
          <p class="sb-group__title">缺省备选 10 / 20 / 50 / 100</p>
          <DtPagination v-bind="args" />
        </div>
        <div class="sb-group">
          <p class="sb-group__title">自定义备选 5 / 15 / 30</p>
          <DtPagination v-bind="args" :size="15" :size-options="[5, 15, 30]" />
        </div>
        <div class="sb-group">
          <p class="sb-group__title">
            当前 size = {{ size }} 不在备选里 —— 组件把它补进下拉，
            否则下拉会显示占位符，看着像没设过每页条数
          </p>
          <DtPagination
            v-bind="args"
            :size="size"
            :size-options="[10, 20, 50]"
            @update:size="size = $event"
          />
        </div>
      </div>
    `,
  }),
}

/** 边界：0 条、正好 1 页、最后一页不满。 */
export const 边界: Story = {
  render: (args) => ({
    components: { DtPagination },
    setup: () => ({
      args,
      cases: [
        [1, 10, 0, '一条都没有'],
        [1, 10, 7, '不满一页'],
        [1, 10, 10, '正好一页'],
        [5, 10, 43, '最后一页只有 3 条'],
      ],
    }),
    template: `
      <div class="sb-col">
        <div v-for="[page, size, total, note] in cases" :key="note" class="sb-group">
          <p class="sb-group__title">{{ note }}</p>
          <DtPagination v-bind="args" :page="page" :size="size" :total="total" />
        </div>
      </div>
    `,
  }),
}

/** 越界收敛：传进来的第 99 页会被夹回末页，并把修正回吐给父组件。 */
export const 越界页码: Story = {
  render: (args) => ({
    components: { DtPagination },
    setup() {
      const page = ref(99)
      return { args, page }
    },
    template: `
      <div class="sb-col">
        <p class="sb-note">传入 page = 99，总共只有 5 页。</p>
        <DtPagination
          v-bind="args"
          :page="page"
          :size="10"
          :total="43"
          @update:page="page = $event"
        />
        <p class="sb-note">回吐后父组件持有的页码：{{ page }}</p>
      </div>
    `,
  }),
}
