#!/usr/bin/env bash
# 本地跑 CI。默认用 act 在容器里跑真流水线；带 --fast 只跑不需要容器的闸门。
#
# ⚠ 流水线跑在自托管运行器上（runs-on: [self-hosted, Linux, X64]），
# .actrc 里把这组标签映射到同档次的本地镜像。
# act 与真实运行器的唯一实质差异是服务容器的健康检查：GitHub 会等 health-cmd
# 通过再跑步骤，act 不会——流水线里因此有一步 wait_for_deps.py 显式等待。
#
#   scripts/ci-local.sh --fast          只跑闸门脚本（秒级，不起容器）
#   scripts/ci-local.sh                 act 跑第 1–2 段
#   scripts/ci-local.sh -j server-test  act 跑指定作业
#   scripts/ci-local.sh --all           act 跑整条 push 流水线

set -euo pipefail

cd "$(dirname "$0")/.."

# 闸门脚本只用标准库，但要 3.12：系统 python3 可能是 3.9
PYTHON=(uv run --project server python)

gates=(
  check_ci_hygiene
  check_structure_python
  check_structure_web
  check_web_styles
  check_web_deps
  check_python_style
  check_python_runtime
  check_python_naming
  check_ts_style
  check_comments
  check_logging
  check_config_secrets
  check_migrations
  check_api_contract
  check_tests
  check_licenses
)

run_fast() {
  local failed=0
  for gate in "${gates[@]}"; do
    printf '%-28s' "$gate"
    if output=$("${PYTHON[@]}" "scripts/gates/${gate}.py" 2>&1); then
      echo '✅'
    else
      echo '❌'
      printf '%s\n' "$output" | sed 's/^/    /'
      failed=1
    fi
  done
  return "$failed"
}

case "${1:-}" in
  --fast)
    run_fast
    ;;
  --all)
    act push
    ;;
  '')
    act push -j hygiene -j structure -j server-static -j web-static
    ;;
  *)
    act push "$@"
    ;;
esac
