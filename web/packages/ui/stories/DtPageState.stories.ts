/**
 * @fileoverview DtPageState 的展示：取数三态各自长什么样、优先级如何、重试怎么接。
 */
import { computed, ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtCard, DtPageState, DtTag } from '../src'

const meta = {
  title: '反馈/DtPageState 取数三态',
  component: DtPageState,
  parameters: {
    docs: {
      description: {
        component:
          '加载中 / 出错 / 空三态的统一渲染，三者都不成立时渲染默认插槽（正常内容）。' +
          '⚠ 三态必须都有。各页自己写的结果一定是「有的页没有空态」——' +
          '空列表和还没加载完在界面上长得一模一样，用户分不清是没数据还是卡住了。' +
          '出错态必须带重试入口，否则唯一的恢复手段是刷新整页。' +
          '优先级：loading > error > empty > 内容。',
      },
    },
  },
  argTypes: {
    loading: { control: 'boolean' },
    error: { control: 'text', description: '非空即进入出错态' },
    empty: { control: 'boolean', description: '数据为空' },
    emptyTitle: { control: 'text' },
    emptyHint: { control: 'text' },
    emptyIcon: { control: 'text' },
  },
  args: {
    loading: false,
    error: null,
    empty: false,
    emptyTitle: '暂无设备',
    emptyHint: '先在边缘网关上登记，再回来绑定点位',
    emptyIcon: 'table',
  },
} satisfies Meta<typeof DtPageState>

export default meta
type Story = StoryObj<typeof meta>

/** 切换四种状态，看同一块区域怎么变。 */
export const 演练场: Story = {
  render: (args) => ({
    components: { DtButton, DtPageState, DtTag },
    setup() {
      const state = ref('loading')
      const retried = ref(0)
      function retry(): void {
        retried.value += 1
        state.value = 'ok'
      }
      return { args, state, retried, retry }
    },
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'loading'">加载中</DtButton>
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'error'">出错</DtButton>
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'empty'">空</DtButton>
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'ok'">有数据</DtButton>
          <span class="sb-label">重试次数：{{ retried }}</span>
        </div>
        <div class="sb-stage">
          <DtPageState
            v-bind="args"
            :loading="state === 'loading'"
            :error="state === 'error' ? '读取失败：网关无响应（504）' : null"
            :empty="state === 'empty'"
            @retry="retry"
          >
            <div class="sb-row">
              <DtTag intent="success">在线 4</DtTag>
              <DtTag intent="warning">延迟 1</DtTag>
              <DtTag intent="danger">离线 1</DtTag>
            </div>
          </DtPageState>
        </div>
      </div>
    `,
  }),
}

/** 四种状态并排，方便一次看全。 */
export const 四态并排: Story = {
  render: (args) => ({
    components: { DtCard, DtPageState, DtTag },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtCard title="加载中" padding="sm">
          <DtPageState v-bind="args" loading />
        </DtCard>
        <DtCard title="出错（带重试）" padding="sm">
          <DtPageState v-bind="args" error="读取失败：网关无响应（504）" />
        </DtCard>
        <DtCard title="空" padding="sm">
          <DtPageState v-bind="args" empty />
        </DtCard>
        <DtCard title="有数据" padding="sm">
          <DtPageState v-bind="args">
            <DtTag intent="success">在线 4</DtTag>
          </DtPageState>
        </DtCard>
      </div>
    `,
  }),
}

/** 优先级：三个开关同时为真时，只渲染加载态。 */
export const 优先级: Story = {
  render: (args) => ({
    components: { DtCard, DtPageState },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtCard title="loading + error + empty → 只显示加载" padding="sm">
          <DtPageState v-bind="args" loading error="这条错误被压住了" empty />
        </DtCard>
        <DtCard title="error + empty → 只显示出错" padding="sm">
          <DtPageState v-bind="args" error="读取失败：证书已过期" empty />
        </DtCard>
      </div>
    `,
  }),
}

/** 空态文案按业务写：三态里只有「空」需要业务措辞。 */
export const 空态文案: Story = {
  args: { empty: true },
  render: (args) => ({
    components: { DtCard, DtPageState },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtCard title="设备列表" padding="sm">
          <DtPageState
            v-bind="args"
            empty-icon="table"
            empty-title="这条产线还没有设备"
            empty-hint="先在边缘网关上登记，再回来绑定点位"
          />
        </DtCard>
        <DtCard title="告警列表" padding="sm">
          <DtPageState
            v-bind="args"
            empty-icon="shield-check"
            empty-title="近 24 小时没有告警"
            empty-hint="一切正常"
          />
        </DtCard>
        <DtCard title="搜索结果" padding="sm">
          <DtPageState
            v-bind="args"
            empty-icon="search"
            empty-title="没有匹配的结果"
            empty-hint="换个关键词，或清掉筛选条件"
          />
        </DtCard>
      </div>
    `,
  }),
}

/** 真实取数：模拟一次请求，2 秒后随机成功 / 失败。 */
export const 模拟一次取数: Story = {
  render: (args) => ({
    components: { DtButton, DtPageState, DtTag },
    setup() {
      const loading = ref(false)
      const error = ref<string | null>(null)
      const rows = ref<string[]>([])
      let attempt = 0
      function load(): void {
        loading.value = true
        error.value = null
        attempt += 1
        setTimeout(() => {
          loading.value = false
          // 头两次故意失败，好把「出错 → 重试 → 成功」整条路径走一遍
          if (attempt < 3) {
            error.value = `读取失败（第 ${attempt} 次）：网关无响应`
            return
          }
          rows.value = ['1 号进料泵', '反应釜温控', '成品线计数器']
        }, 1200)
      }
      const empty = computed(() => rows.value.length === 0)
      return { args, loading, error, rows, empty, load }
    },
    template: `
      <div class="sb-col">
        <DtButton size="sm" variant="outline" intent="neutral" @click="load">发起请求</DtButton>
        <div class="sb-stage">
          <DtPageState
            v-bind="args"
            :loading="loading"
            :error="error"
            :empty="empty"
            empty-title="还没有取过数"
            empty-hint="点上面的按钮试一次"
            @retry="load"
          >
            <div class="sb-row">
              <DtTag v-for="row in rows" :key="row" intent="success">{{ row }}</DtTag>
            </div>
          </DtPageState>
        </div>
      </div>
    `,
  }),
}
