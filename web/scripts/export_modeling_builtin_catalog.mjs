/** @fileoverview 从前端模板元数据导出后端只读目录，不执行模板图。 */
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const appRequire = createRequire(
  new URL('../app/package.json', import.meta.url),
)
const viteRequire = createRequire(appRequire.resolve('vite'))
const { build } = viteRequire('esbuild')
const sourceDirectory = fileURLToPath(
  new URL('../app/src/pages/Modeling/Pipelines/scripts/', import.meta.url),
)
const output = fileURLToPath(
  new URL(
    '../../server/services/platform-server/src/platform_server/apps/modeling/builtin_template_catalog.py',
    import.meta.url,
  ),
)

async function catalog() {
  const result = await build({
    stdin: {
      resolveDir: sourceDirectory,
      sourcefile: 'builtin-catalog.ts',
      loader: 'ts',
      contents: `
        import { PIPELINE_TEMPLATES } from './templates'
        import { MODEL_FAMILY_TEMPLATES } from './familyTemplates'
        import { ENERGY_RULE_TEMPLATES } from './ruleTemplates'
        const families = new Set(MODEL_FAMILY_TEMPLATES.map(row => row.key))
        const rules = new Set(ENERGY_RULE_TEMPLATES.map(row => row.key))
        const ordered = [
          ...MODEL_FAMILY_TEMPLATES,
          ...PIPELINE_TEMPLATES.filter(row => row.key === 'regression'),
          ...PIPELINE_TEMPLATES.filter(row => !families.has(row.key) && !['regression', 'blank'].includes(row.key)),
          ...PIPELINE_TEMPLATES.filter(row => row.key === 'blank'),
        ]
        const rows = ordered.map(({key, label, hint}) => [key, label, hint,
          ['device_anomaly', 'anomaly_model'].includes(key) ? 'detection'
            : key === 'clustering_analysis' ? 'analysis'
            : rules.has(key) ? 'rule' : 'prediction'])
        if (new Set(rows.map(row => row[0])).size !== PIPELINE_TEMPLATES.length || rows.length !== PIPELINE_TEMPLATES.length)
          throw new Error('模板目录的键必须唯一且完整')
        export default rows
      `,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}`)).default
}

function render(rows) {
  const lines = [
    '"""内置模板目录元数据；由前端元数据确定性导出。"""',
    '',
    'BUILTIN_TEMPLATE_CATALOG: tuple[tuple[str, str, str, str], ...] = (',
  ]
  for (const [key, label, hint, category] of rows) {
    lines.push(
      '    (',
      `        ${JSON.stringify(key)},`,
      `        ${JSON.stringify(label)},`,
    )
    const characters = Array.from(hint)
    if (characters.length <= 24) lines.push(`        ${JSON.stringify(hint)},`)
    else {
      lines.push('        (')
      for (let index = 0; index < characters.length; index += 24)
        lines.push(
          `            ${JSON.stringify(characters.slice(index, index + 24).join(''))}`,
        )
      lines.push('        ),')
    }
    lines.push(`        ${JSON.stringify(category)},`, '    ),')
  }
  return `${lines.join('\n')}\n)\n`
}

const text = render(await catalog())
if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  if (current !== text) {
    process.stderr.write(
      '内置模板目录未同步，请运行 node web/scripts/export_modeling_builtin_catalog.mjs\n',
    )
    process.exitCode = 1
  }
} else {
  await writeFile(output, text)
  process.stdout.write('已导出后端内置模板目录\n')
}
