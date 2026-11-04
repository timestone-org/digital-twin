/** @fileoverview 后端生成目录逐项对齐前端模板元数据，构图函数不参与导出。 */
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PIPELINE_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/templates'
import { MODEL_FAMILY_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/familyTemplates'
import { ENERGY_RULE_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/ruleTemplates'

const root = resolve(process.cwd(), '..')
const script = join(root, 'web/scripts/export_modeling_builtin_catalog.mjs')
const generated = join(
  root,
  'server/services/platform-server/src/platform_server/apps/modeling/builtin_template_catalog.py',
)

it('生成目录完整保持原模板顺序、说明和用途分类', () => {
  const families = new Set(MODEL_FAMILY_TEMPLATES.map((row) => row.key))
  const rules = new Set(ENERGY_RULE_TEMPLATES.map((row) => row.key))
  const expected = [
    ...MODEL_FAMILY_TEMPLATES,
    ...PIPELINE_TEMPLATES.filter((row) => row.key === 'regression'),
    ...PIPELINE_TEMPLATES.filter(
      (row) =>
        !families.has(row.key) &&
        row.key !== 'regression' &&
        row.key !== 'blank',
    ),
    ...PIPELINE_TEMPLATES.filter((row) => row.key === 'blank'),
  ].map(({ key, label, hint }) => [
    key,
    label,
    hint,
    key === 'device_anomaly' || key === 'anomaly_model'
      ? 'detection'
      : key === 'clustering_analysis'
        ? 'analysis'
        : rules.has(key)
          ? 'rule'
          : 'prediction',
  ])
  const output = execFileSync(
    'python3',
    [
      '-c',
      `
import ast, json, pathlib, sys
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
assignment = next(node for node in tree.body if isinstance(node, ast.AnnAssign))
print(json.dumps(ast.literal_eval(assignment.value), ensure_ascii=False))
`,
      generated,
    ],
    { encoding: 'utf8' },
  )
  const actual: unknown = JSON.parse(output)
  expect(actual).toEqual(expected)
  expect(expected).toHaveLength(PIPELINE_TEMPLATES.length)
})

it('导出检查确定性且不会改写现有文件', () => {
  expect(() =>
    execFileSync(process.execPath, [script, '--check'], { cwd: root }),
  ).not.toThrow()
})
