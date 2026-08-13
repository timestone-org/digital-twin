/**
 * @fileoverview DtFilePicker 的展示：缺省触发按钮、自备触发区、限定类型与多选。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtFilePicker, DtNotice, DtTag } from '../src'

const meta = {
  title: '表单/DtFilePicker 文件选取',
  component: DtFilePicker,
  parameters: {
    docs: {
      description: {
        component:
          '藏起来的原生 `<input type="file">` 加一个触发器，选完抛 `select`（`File[]`）。' +
          '默认插槽拿到 `open`，自备触发区（拖拽区、工具栏图标）的宿主用它复用同一套选取逻辑。' +
          '⚠ 组件在 emit **之前**清空 input 的值：不清的话连续选同一个文件不会再触发 ' +
          '`change`，用户会以为按钮坏了；而放到 emit 之后清，宿主在处理里同步再次唤起' +
          '选取时会被这一下清掉。',
      },
    },
  },
  argTypes: {
    label: { control: 'text', description: '缺省触发按钮的文案' },
    accept: { control: 'text', description: '原生 accept，例如 `.csv,.json`' },
    multiple: { control: 'boolean' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
  },
  args: {
    label: '选择文件',
    multiple: false,
    size: 'md',
    disabled: false,
  },
} satisfies Meta<typeof DtFilePicker>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtFilePicker, DtTag },
    setup() {
      const picked = ref<string[]>([])
      function onSelect(files: File[]): void {
        picked.value = files.map((file) => `${file.name}（${file.size} B）`)
      }
      return { args, picked, onSelect }
    },
    template: `
      <div class="sb-col">
        <DtFilePicker v-bind="args" @select="onSelect" />
        <div class="sb-row">
          <DtTag v-for="name in picked" :key="name" mono>{{ name }}</DtTag>
        </div>
        <p v-if="picked.length === 0" class="sb-note">还没有选择文件。</p>
      </div>
    `,
  }),
}

/** 三档尺寸，跟着缺省触发按钮走。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtFilePicker },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-row">
        <DtFilePicker
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
        />
      </div>
    `,
  }),
}

/** 限定类型与多选。`accept` 只是过滤系统对话框，落地仍要自己校验。 */
export const 类型与多选: Story = {
  render: (args) => ({
    components: { DtFilePicker, DtNotice },
    setup() {
      const message = ref('')
      function onSelect(files: File[]): void {
        message.value = `选了 ${files.length} 个：${files.map((f) => f.name).join('、')}`
      }
      return { args, message, onSelect }
    },
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtFilePicker v-bind="args" label="导入点位表（.csv）" accept=".csv" @select="onSelect" />
          <DtFilePicker v-bind="args" label="导入配置（.json）" accept="application/json" @select="onSelect" />
          <DtFilePicker v-bind="args" label="批量上传图片" accept="image/*" multiple @select="onSelect" />
        </div>
        <DtNotice v-if="message" intent="success">{{ message }}</DtNotice>
      </div>
    `,
  }),
}

/** 自备触发区：默认插槽拿到 `open`，整块区域点哪都能唤起选取。 */
export const 自备触发区: Story = {
  render: (args) => ({
    components: { DtFilePicker, DtNotice },
    setup() {
      const message = ref('')
      function onSelect(files: File[]): void {
        message.value = `已接收 ${files.length} 个文件`
      }
      return { args, message, onSelect }
    },
    template: `
      <div class="sb-col sb-w-lg">
        <DtFilePicker v-bind="args" accept=".csv,.json" multiple @select="onSelect">
          <template #default="{ open, disabled }">
            <button
              type="button"
              class="sb-stage sb-w-full"
              style="cursor: pointer; background: transparent; color: inherit"
              :disabled="disabled"
              @click="open"
            >
              <span class="sb-label">点这里选择文件，或把文件拖进来（.csv / .json）</span>
            </button>
          </template>
        </DtFilePicker>
        <DtNotice v-if="message" intent="info">{{ message }}</DtNotice>
      </div>
    `,
  }),
}

/** 禁用：缺省按钮与自备触发区都点不动。 */
export const 禁用: Story = {
  args: { disabled: true },
  render: (args) => ({
    components: { DtFilePicker },
    setup: () => ({ args }),
    template: `
      <div class="sb-row">
        <DtFilePicker v-bind="args" label="导入（无权限）" />
        <DtFilePicker v-bind="args">
          <template #default="{ open, disabled }">
            <button type="button" :disabled="disabled" @click="open">自备触发区</button>
          </template>
        </DtFilePicker>
      </div>
    `,
  }),
}
