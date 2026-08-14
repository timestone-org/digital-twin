#!/usr/bin/env bash
# 本地跑 CI。默认用 act 在容器里跑真流水线；带 --fast 只跑不需要容器的闸门。
#
# ⚠ 流水线跑在自托管运行器上（runs-on: [self-hosted, Linux, X64]），
# .actrc 里把这组标签映射到同档次的本地镜像。
# act 与真实运行器的唯一实质差异是服务容器的健康检查：GitHub 会等 health-cmd
# 通过再跑步骤，act 不会——流水线里因此有一步 wait_for_deps.py 显式等待。
#
#   scripts/ci-local.sh --fast          只跑闸门脚本（秒级，不起容器）
#   scripts/ci-local.sh                 act 逐个跑第 1–2 段的作业
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
  check_docker_workspace
  check_api_contract
  check_tests
  check_licenses
  # 要拿基线比，本地按 origin/main 算；CI 上它只在 PR 流水线里跑
  check_logic_version
  # 比其余快闸门慢一档（要按服务各装一次），但仍是秒级
  check_service_deps
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
    # ⚠ act 的 -j 是单值旗标，传多次只有最后一个生效——`-j a -j b` 会静默地
    # 只跑 b，而输出里看不出少跑了谁（依赖作业照样出现在日志里）。逐个跑。
    for job in hygiene structure server-static web-static; do
      echo "── act: ${job} ──"
      act push -j "${job}"
    done
    ;;
  *)
    act push "$@"
    ;;
esac
