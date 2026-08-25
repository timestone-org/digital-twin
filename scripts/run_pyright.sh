#!/usr/bin/env bash
# pyright strict + 范围自检，与 ci.yml 的「类型（pyright strict）」那两步同源。
#
# ⚠ 范围自检不能省：pyright 的 include 写错时会「0 errors 但一个源文件都没看」，
# 那是最像绿灯的一种红灯。
#
# ⚠ 产物落到系统临时目录而不是仓库根：落在仓库里会让「工作树干净」这件事
# 时真时假，而 act 与提交前检查都按它判。
set -euo pipefail

cd "$(dirname "$0")/.."

raw=$(mktemp)
report=$(mktemp)
trap 'rm -f "${raw}" "${report}"' EXIT

# ⚠ 用本机已装的 node：不给这个变量，pyright 的 python 包装器每次跑都会
# 现下一个 node 回来
export PYRIGHT_PYTHON_GLOBAL_NODE=true

# ⚠ `|| true`：pyright 有报错时退出码非零，而逐条报错要由 check_pyright.py 出
(cd server && uv run pyright --outputjson >"${raw}") || true
uv run --project server python scripts/gates/check_pyright.py "${raw}" "${report}"
uv run --project server python scripts/gates/check_typecheck_scope.py "${report}"
