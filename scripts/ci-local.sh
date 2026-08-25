#!/usr/bin/env bash
# 本地跑 CI。默认用 act 在容器里跑真流水线；带 --fast 只跑不需要容器的闸门。
#
# ⚠ GitHub 上的流水线只在 main 的 push 上跑，分支与 PR 上都不跑——**合并前的
# 绿灯由这里出**，`--all` 跑的就是那条流水线本身（同一份 ci.yml、同一批闸门
# 脚本）。规矩见 docs/agents/ci-gates.md §4。
#
# ⚠ 流水线跑在 GitHub 托管运行器上（runs-on: ubuntu-24.04），.actrc 里把这个
# 标签映射到同一档的本地镜像。
# act 与真实运行器有两处实质差异：一是服务容器的健康检查——GitHub 会等
# health-cmd 通过再跑步骤，act 不会，流水线里因此有一步 wait_for_deps.py 显式
# 等待；二是 act 没有真的缓存后端，`enable-cache` / `cache: pnpm` 那几层在本地
# 既不命中也不保存，只有推上去才验得到。
#
#   scripts/ci-local.sh --fast          不起容器就能跑的全部静态检查（约 4 分钟）
#   scripts/ci-local.sh                 act 逐个跑第 1–2 段的作业
#   scripts/ci-local.sh -j server-test  act 跑指定作业
#   scripts/ci-local.sh --all           act 跑整条流水线（推送前跑这个）

set -euo pipefail

cd "$(dirname "$0")/.."

# ⚠ 流水线的触发条件是 `push: branches: [main]`，act 按事件负载里的 ref 判——
# 不喂负载就得指望当前分支正好是 main。ref 写死 main，功能分支上照样能跑全。
# before 写与 origin/main 的合并基：增量覆盖那步以它为基线，于是这里判的
# 「这条分支相对 main 改了什么」与合并后在 GitHub 上判的是同一段 diff。
EVENT=""
cleanup() { rm -f "${EVENT:-}"; }
trap cleanup EXIT

act_push() {
  if [[ -z "${EVENT}" ]]; then
    EVENT=$(mktemp)
    printf '{"ref":"refs/heads/main","before":"%s"}\n' \
      "$(git merge-base origin/main HEAD 2>/dev/null || true)" >"${EVENT}"
  fi
  act push --eventpath "${EVENT}" "$@"
}

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
  check_wire_shapes
  check_tests
  check_licenses
  # 要拿基线比，本地按 origin/main 算；CI 上它只在 PR 流水线里跑
  check_logic_version
  # 比其余快闸门慢一档（要按服务各装一次），但仍是秒级
  check_service_deps
)

# 第 2 段那几步的本地版。⚠ 它们不是闸门脚本，但**必须留在 --fast 里**：
# 格式与类型是全流水线里最早红、也最没有信息量的一档，让它们留到 `--all` 才
# 暴露，等于为一个空格白等二三十分钟的容器启动与真库测试。
# 代价是 `--fast` 从秒级变成分钟级，主要花在 eslint 全量遍历上——仍然比
# 跑一轮 act 便宜一个数量级。
# 名字 → 命令，与 ci.yml 的「2·前端/后端格式、lint、类型」逐字同源。
statics=(
  'prettier|pnpm --dir web format:check'
  "black|${PYTHON[*]} -m black --check --config server/pyproject.toml server scripts"
  "ruff|${PYTHON[*]} -m ruff check --config server/pyproject.toml server scripts"
  'eslint|pnpm --dir web lint'
  'typecheck|pnpm --dir web typecheck'
  'pyright|scripts/run_pyright.sh'
)

run_one() {
  printf '%-28s' "$1"
  shift
  if output=$("$@" 2>&1); then
    echo '✅'
    return 0
  fi
  echo '❌'
  printf '%s\n' "$output" | sed 's/^/    /'
  return 1
}

run_fast() {
  local failed=0
  for gate in "${gates[@]}"; do
    run_one "$gate" "${PYTHON[@]}" "scripts/gates/${gate}.py" || failed=1
  done
  for entry in "${statics[@]}"; do
    # shellcheck disable=SC2086 # 命令串按空白切成词，正是这里要的
    run_one "${entry%%|*}" ${entry#*|} || failed=1
  done
  return "$failed"
}

case "${1:-}" in
  --fast)
    run_fast
    ;;
  --all)
    act_push
    ;;
  '')
    # ⚠ act 的 -j 是单值旗标，传多次只有最后一个生效——`-j a -j b` 会静默地
    # 只跑 b，而输出里看不出少跑了谁（依赖作业照样出现在日志里）。逐个跑。
    for job in hygiene structure server-static web-static; do
      echo "── act: ${job} ──"
      act_push -j "${job}"
    done
    ;;
  *)
    act_push "$@"
    ;;
esac
