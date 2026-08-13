/**
 * @fileoverview DtDropdownMenu 的展示：图标项、危险项、禁用项、对齐方式、
 * 自定义触发器与「表格行尾的更多操作」这个最常见的用法。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { DtMenuItem } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtDropdownMenu, DtNotice, DtTag } from '../src'

const ITEMS: DtMenuItem[] = [
  { value: 'edit', label: '编辑', icon: 'pencil' },
  { value: 'export', label: '导出点位表', icon: 'upload' },
  { value: 'sync', label: '立即同步', icon: 'activity' },
  {
    value: 'disable',
    label: '停用（需要停机窗口）',
    icon: 'toggle-left',
    disabled: true,
  },
  { value: 'delete', label: '删除', icon: 'trash', danger: true },
]

const PLAIN_ITEMS: DtMenuItem[] = [
  { value: 'a', label: '复制通道 ID' },
  { value: 'b', label: '复制点位路径' },
  { value: 'c', label: '在新标签打开' },
]

const meta = {
  title: '浮层/DtDropdownMenu 动作菜单',
  component: DtDropdownMenu,
  parameters: {
    docs: {
      description: {
        component:
          '动作菜单，浮层与定位复用 DtPopover，选中时抛 `select`（整个 `DtMenuItem`）。' +
          '⚠ 它装的是**动作**，不是取值：选一个值请用 DtSelect，两者的读屏语义不一样。' +
          '键盘：↑↓ 在可用项之间环绕移动，Tab 关闭菜单。' +
          '展开时高亮回到第一个可用项，免得上次的位置串到这次。' +
          '`danger: true` 的项渲染成危险色——但危险动作**仍然要接 `useConfirm().ask()`**，' +
          '菜单项变红只是提示，不是确认。',
      },
    },
  },
  argTypes: {
    label: { control: 'text', description: '缺省触发按钮的文案' },
    align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
  },
  args: {
    items: ITEMS,
    label: '更多',
    align: 'end',
    size: 'md',
    disabled: false,
  },
} satisfies Meta<typeof DtDropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtDropdownMenu, DtNotice },
    setup() {
      const picked = ref('')
      return { args, picked }
    },
    template: `
      <div class="sb-col">
        <div class="sb-stage">
          <DtDropdownMenu v-bind="args" @select="picked = $event.label" />
        </div>
        <DtNotice v-if="picked" intent="neutral">选了：{{ picked }}</DtNotice>
      </div>
    `,
  }),
}

/** 菜单项的四种形态：普通、带图标、禁用、危险。 */
export const 菜单项形态: Story = {
  render: (args) => ({
    components: { DtDropdownMenu },
    setup: () => ({ args, PLAIN_ITEMS, ITEMS }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <DtDropdownMenu v-bind="args" label="纯文字" :items="PLAIN_ITEMS" />
          <DtDropdownMenu v-bind="args" label="带图标 / 禁用 / 危险" :items="ITEMS" />
        </div>
      </div>
    `,
  }),
}

/** 对齐：菜单相对触发器左对齐 / 居中 / 右对齐。行尾的菜单一律 `end`。 */
export const 对齐: Story = {
  render: (args) => ({
    components: { DtDropdownMenu },
    setup: () => ({ args, aligns: ['start', 'center', 'end'] }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <DtDropdownMenu
            v-for="align in aligns"
            :key="align"
            v-bind="args"
            :align="align"
            :label="'align = ' + align"
          />
        </div>
      </div>
    `,
  }),
}

/** 三档尺寸，跟着缺省触发按钮走。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtDropdownMenu },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <DtDropdownMenu
            v-for="size in sizes"
            :key="size"
            v-bind="args"
            :size="size"
            :label="'size = ' + size"
          />
        </div>
      </div>
    `,
  }),
}

/** 自定义触发器：`trigger` 插槽拿到 `toggle` 与 `isOpen`。 */
export const 自定义触发器: Story = {
  render: (args) => ({
    components: { DtButton, DtDropdownMenu, DtTag },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <DtDropdownMenu v-bind="args">
            <template #trigger="{ toggle }">
              <DtButton variant="ghost" intent="neutral" icon="more-horizontal" aria-label="更多操作" @click="toggle" />
            </template>
          </DtDropdownMenu>

          <DtDropdownMenu v-bind="args">
            <template #trigger="{ toggle, isOpen }">
              <DtButton
                variant="outline"
                intent="neutral"
                :icon-right="isOpen ? 'chevron-up' : 'chevron-down'"
                @click="toggle"
              >批量操作</DtButton>
            </template>
          </DtDropdownMenu>
        </div>
      </div>
    `,
  }),
}

/** 行尾操作：最常见的用法——每行一个「更多」。 */
export const 表格行尾: Story = {
  render: (args) => ({
    components: { DtButton, DtDropdownMenu, DtNotice, DtTag },
    setup() {
      const log = ref('')
      const rows = [
        { id: 'ch-01', name: '1 号进料泵' },
        { id: 'ch-02', name: '反应釜温控' },
        { id: 'ch-03', name: '成品线计数器' },
      ]
      return { args, rows, log }
    },
    template: `
      <div class="sb-col sb-w-lg">
        <div v-for="row in rows" :key="row.id" class="sb-row" style="justify-content: space-between; width: 100%">
          <span class="sb-label">{{ row.name }}</span>
          <DtDropdownMenu
            v-bind="args"
            size="sm"
            @select="log = row.name + ' → ' + $event.label"
          >
            <template #trigger="{ toggle }">
              <DtButton
                size="sm"
                variant="ghost"
                intent="neutral"
                icon="more-horizontal"
                :aria-label="row.name + ' 的更多操作'"
                @click="toggle"
              />
            </template>
          </DtDropdownMenu>
        </div>
        <DtNotice v-if="log" intent="neutral">{{ log }}</DtNotice>
      </div>
    `,
  }),
}

/** 禁用：整个菜单点不开。 */
export const 禁用: Story = {
  args: { disabled: true },
  render: (args) => ({
    components: { DtDropdownMenu },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <DtDropdownMenu v-bind="args" label="没有权限" />
      </div>
    `,
  }),
}
