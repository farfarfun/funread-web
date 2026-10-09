#!/usr/bin/env bash
set -euo pipefail

# funread-web 是单服务仓库（service 类），所以不再分一层 dispatcher，
# 验证与生命周期边界都留在这个脚本里。

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

SERVICE_NAME="web"
CLI_NAME="funread-web"
PKG_NAME="funread-web"
PORT=8811
# 留空 = 用 CLI 自己的默认路径
# ${XDG_CONFIG_HOME:-~/.config}/farfarfun/funread-web/config.toml。
# funread-web.pid 由 CLI 自己写在实际生效的 config 同目录下。
CONFIG_PATH=""

readonly ROOT SERVICE_NAME CLI_NAME PKG_NAME PORT CONFIG_PATH

usage() {
  printf 'Usage: %s <start|stop|restart|run|status|install-dev>\n' "${0##*/}" >&2
  printf '       %s <install-prod|upgrade> [version]\n' "${0##*/}" >&2
  printf '       %s rollback <version>\n' "${0##*/}" >&2
  printf '       %s uninstall\n' "${0##*/}" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

cli_args() {
  CLI_ARGS=(--port "${PORT}")
  # 必须用 if，不能写成 `[[ -n ... ]] && CLI_ARGS+=(...)`：在 set -e 下，
  # 当 CONFIG_PATH 为空时后者的退出码就是 [[ ]] 自身的 1，而它是函数最后一条
  # 命令，这个 1 会成为 cli_args 的返回值并直接中止整个脚本。
  if [[ -n "${CONFIG_PATH}" ]]; then
    CLI_ARGS+=(--config "${CONFIG_PATH}")
  fi
}

require_cli() {
  command -v "${CLI_NAME}" >/dev/null 2>&1 ||
    die "找不到 ${CLI_NAME}，先执行：${0##*/} install-dev（或 install-prod）"
}

do_start() {
  require_cli
  cli_args
  "${CLI_NAME}" server start "${CLI_ARGS[@]}"
}

do_run() {
  require_cli
  cli_args
  exec "${CLI_NAME}" server run "${CLI_ARGS[@]}"
}

do_stop() {
  require_cli
  "${CLI_NAME}" server stop
}

do_restart() {
  do_stop
  do_start
}

do_status() {
  require_cli
  "${CLI_NAME}" server status
}

# 清掉上一次的构建产物与本地全局安装，重新 build 再本地安装，
# 保证 ${CLI_NAME} 反映当前源码。
do_install_dev() {
  rm -rf dist
  funbuild install
}

do_install_prod() {
  local version="${1:-}"
  npm install -g "${PKG_NAME}${version:+@${version}}"
}

do_upgrade() {
  local version="${1:-}"
  if command -v "${CLI_NAME}" >/dev/null 2>&1; then
    "${CLI_NAME}" upgrade ${version:+"${version}"}
  else
    npm install -g "${PKG_NAME}${version:+@${version}}"
  fi
}

do_rollback() {
  local version="$1"
  require_cli
  "${CLI_NAME}" rollback "${version}"
}

do_uninstall() {
  do_stop || true
  require_cli
  "${CLI_NAME}" uninstall
}

main() {
  local action="${1:-}"

  case "${action}" in
    start | stop | restart | run | status)
      (( $# == 1 )) || {
        usage
        die "${action} 不接受额外参数"
      }
      "do_${action}"
      ;;
    install-dev | uninstall)
      (( $# == 1 )) || {
        usage
        die "${action} 不接受额外参数"
      }
      "do_${action//-/_}"
      ;;
    install-prod | upgrade)
      (( $# <= 2 )) || {
        usage
        die "${action} 最多接受一个 version 参数"
      }
      "do_${action//-/_}" "${2:-}"
      ;;
    rollback)
      (( $# == 2 )) || {
        usage
        die "rollback 必须显式给出版本号"
      }
      do_rollback "$2"
      ;;
    *)
      usage
      die "unknown action: ${action:-<empty>}"
      ;;
  esac
}

main "$@"
