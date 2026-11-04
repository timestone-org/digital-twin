<script setup lang="ts">
/** @fileoverview 第三方按模板建模的接入说明与完整参数示例。 */
import { DtCard, DtIcon, DtNotice, DtTag } from '@dt/ui'
import { RouterLink } from 'vue-router'
const steps = [
  [
    '1. 选择模板',
    'GET /modeling-templates?page=1&size=20',
    '选取 is_enabled=true 的具体模板版本，保存其 id。模板与实例列表在训练前即返回 task，可据此识别模型类型。',
  ],
  [
    '2. 获取全部配置',
    'GET /modeling-templates/{template_id}/configuration',
    'configuration 是完整默认参数，json_schema 是可直接用于校验的 JSON Schema，nodes 包含每个算子的说明与输入输出端口。',
  ],
  [
    '3. 创建工作流',
    'POST /modeling-templates/{template_id}:create-workflow',
    '提交唯一 code、name 和可选 description，获得可独立编辑、训练和发布的工作流。',
  ],
  [
    '4. 保存工作流配置',
    'PATCH /modeling-pipelines/{id}',
    '提交完整 graph 保存数据来源、算子和参数。训练始终使用本次保存的快照。',
  ],
  [
    '5. 训练与查询结果',
    'POST /modeling-pipelines/{id}:run',
    '请求体 {"trigger":"api","auto_publish":true} 表示训练并发布。通过 GET /modeling-runs/{run_id} 查询训练状态和 publication_status；可通过 :cancel 取消。',
  ],
  [
    '6. 选择模型发布',
    'POST /modeling-runs/{run_id}:deploy',
    '成功训练自动保存模型。自动发布关闭时，选择任一次成功训练发布；同一工作流始终复用一个固定调用入口。',
  ],
  [
    '7. 定时重新训练',
    'PUT /modeling-pipelines/{id}/schedule',
    '提交 interval_minutes、expected_revision 和 auto_publish。训练或发布失败继续保留当前发布模型。',
  ],
  [
    '8. 调用服务',
    'GET /open-models/{code}',
    '使用用户 APIKey 读取签名，再按任务类型调用 :predict、:detect 或 :calculate。',
  ],
]
const example = JSON.stringify(
  {
    is_enabled: true,
    interval_minutes: 1440,
    auto_publish: false,
    expected_revision: 0,
  },
  null,
  2,
)
</script>
<template>
  <div class="integration-body">
    <div class="integration-entry">
      <DtCard
        title="模板准备"
        subtitle="将流程图发布为固定版本，供第三方选择"
        icon="layers"
      >
        <p>
          工作流保存后使用「保存为模板」，将算子和参数保存为固定版本。每个工作流独立配置和训练，模板更新不会改变已有工作流和当前发布模型。
        </p>
        <template #footer>
          <RouterLink to="/modeling/pipelines">
            管理工作流模板 <DtIcon name="arrow-right" :size="14" />
          </RouterLink>
        </template>
      </DtCard>
      <DtCard
        title="接入验证"
        subtitle="查看快捷建模的训练与发布状态"
        icon="workflow"
      >
        <p>集中查看工作流配置、训练记录与发布结果，验证创建和更新流程。</p>
        <template #footer>
          <RouterLink to="/modeling/pipelines">
            查看工作流 <DtIcon name="arrow-right" :size="14" />
          </RouterLink>
        </template>
      </DtCard>
    </div>
    <DtNotice intent="info">
      所有路径前缀为 /api/v1/platform。建模管理与线上调用统一使用 Authorization:
      Bearer &lt;用户 APIKey&gt;。仅调用模型需要 modeling:view 权限。
      创建和编辑工作流需要 modeling:manage，训练需要 modeling:run，发布需要
      modeling:publish；训练并发布同时需要后两项权限。
    </DtNotice>
    <DtCard
      title="获取全部已部署模型"
      subtitle="从部署列表选择服务，再读取签名并调用"
    >
      <code>GET /modeling-deployments</code>
      <p>
        使用用户 APIKey，账号需有 modeling:view 权限。返回 data
        数组，包含全部部署，无需分页；没有部署时返回空数组。
      </p>
      <p>
        列表包含名称、code、task、invoke_url、signature_url、固定模型版本、状态和配额。选择
        is_enabled=true 且 is_servable=true 的项，再通过 GET /open-models/{code}
        读取输入输出签名。停用或不可服务的部署仍会出现在列表中。
      </p>
      <p>
        invoke_url 是当前模型的 POST 调用地址，signature_url 是 GET
        输入参数的地址。签名包含 task、invoke_url、inputs、output 与
        requires_timestamp。inputs 逐字段说明
        key、label、dtype、unit、is_required、default_on_missing 和
        missing_policy；requires_timestamp=true 时每行还需提供 UTC RFC3339
        格式的 __ts__。公开签名不包含训练数据统计。
      </p>
      <p>
        按 task 选择 POST 调用接口：regression（回归）与
        classification（分类）使用 /open-models/{code}:predict；
        anomaly_detection（异常检测）使用 /open-models/{code}:detect；
        rule_calculation（规则计算）使用 /open-models/{code}:calculate。
      </p>
    </DtCard>
    <div class="integration-content">
      <ol class="integration-steps" aria-label="第三方接入流程">
        <li v-for="step in steps" :key="step[0]">
          <DtCard :title="step[0]" padding="sm">
            <DtTag intent="info">{{ step[1]?.split(' ')[0] }}</DtTag>
            <code>{{
              ' ' + (step[1]?.split(' ').slice(1).join(' ') ?? '')
            }}</code>
            <p>{{ step[2] }}</p>
          </DtCard>
        </li>
      </ol>
      <aside class="integration-example">
        <DtCard
          title="定时训练参数示例"
          subtitle="先 GET 工作流 schedule 取得当前 revision"
          icon="settings"
        >
          <DtNotice intent="warning">
            规则以分钟为周期。首次配置
            expected_revision=0，后续保存使用最近读取的
            revision，避免覆盖他人的修改。
          </DtNotice>
          <pre><code>{{ example }}</code></pre>
          <p>
            创建工作流、训练与发布请求带
            Idempotency-Key，同一逻辑请求使用同一个键。训练失败读取
            error_text，发布失败读取 publication_error，修正后再手动发布。
          </p>
          <template #footer>
            模板更新不影响已有工作流。自动发布关闭时，重新训练只生成模型，当前发布版本保持不变。
          </template>
        </DtCard>
      </aside>
    </div>
  </div>
</template>
<style scoped lang="scss">
.integration-body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: 1rem;
}
.integration-entry {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.integration-content {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.integration-steps {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.integration-example {
  position: sticky;
  top: 0;
  min-width: 0;
}
code {
  font-family: var(--font-mono);
  font-size: var(--font-size-caption);
  color: var(--accent-primary);
  overflow-wrap: anywhere;
}
.integration-steps code {
  margin-left: 0.5rem;
}
p {
  color: var(--text-secondary);
  margin: 0.65rem 0 0;
  line-height: var(--line-height-body);
}
a {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--accent-primary);
}
pre {
  margin: 1rem 0;
  padding: 1rem;
  overflow: auto;
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
}
@media (width < 64rem) {
  .integration-content,
  .integration-entry {
    grid-template-columns: minmax(0, 1fr);
  }
  .integration-example {
    position: static;
  }
}
</style>
