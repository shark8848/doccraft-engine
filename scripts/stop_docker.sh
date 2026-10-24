#!/usr/bin/env bash
set -euo pipefail

# 停止并删除 DocCraft 容器；命名卷 doccraft-data 默认保留。

CONTAINER_NAME="${CONTAINER_NAME:-doccraft-engine}"

for arg in "$@"; do
  case "$arg" in
    -h|--help) awk 'NR==1{next} /^#/{print substr($0,3)} /^[^#[:space:]]/{exit}' "$0"; exit 0 ;;
    *) echo "[stop] 未知参数: $arg（支持 --help）" >&2; exit 1 ;;
  esac
done

if docker ps -aq --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
  echo "[stop] 已停止并删除容器 $CONTAINER_NAME（数据卷保留）"
else
  echo "[stop] 容器 $CONTAINER_NAME 未运行"
fi
