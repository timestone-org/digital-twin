/** @fileoverview 最新成功报告的独立展示节点。 */
import { defineModule } from '../../registry'

export default defineModule({
  type: 'report-view',
  displayName: '报告展示',
  category: '数据',
  icon: 'table',
  description:
    '报告展示节点按模板编码呈现最新一份成功生成的报告，适合报告弹窗或持续展示区域。实时监测指标应使用信息卡片，节点不会把尚未完成的任务当成报告。正文与图表来自生成时的文件和快照，支持刷新与 Word 下载；未选编码时查询全部模板。报告读取遵守登录和报告权限，匿名公开屏不开放私有报告。',
  defaultSize: { width: 900, height: 640, minWidth: 320, minHeight: 200 },
  contentKeys: ['title', 'templateCode'],
  configSchema: [
    { key: 'title', label: '标题', type: 'string', default: '', span: 'full' },
    {
      key: 'templateCode',
      label: '报告模板编码',
      type: 'string',
      default: '',
      span: 'full',
      help: '使用报告模板管理中的编码；留空显示全部模板中最新的成功报告。',
    },
    {
      key: 'refreshSeconds',
      label: '刷新间隔（秒）',
      type: 'number',
      default: 30,
      min: 0,
      max: 3600,
      span: 'half',
      help: '0 表示只在打开和手动刷新时获取；自动刷新最短 10 秒。',
    },
  ],
  bindings: [],
  component: () => import('./Component.vue'),
})
