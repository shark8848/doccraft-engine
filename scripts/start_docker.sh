#!/usr/bin/env bash
set -euo pipefail

# 启动 DocCraft 单镜像（HAProxy:5290 -> API/Worker）。
#
# 用法：
#   cp .env.example .env   # 首次运行
#   bash scripts/start_docker.sh
#   bash scripts/start_docker.sh --keep
#
# 环境变量：
#   IMAGE_TAG             镜像名（默认 doccraft-engine:<frontend/package.json version>）
#   CONTAINER_NAME        容器名（默认 doccraft-engine）
#   ENV_FILE              环境文件（默认 <repo>/.env）
#   DOCCRAFT_HTTP_PORT    宿主 Web 端口（默认 5290）
#   DOCCRAFT_STATS_PORT   宿主 HAProxy 状态页端口（默认 8411）
#   DOCCRAFT_DATA_VOLUME  持久化卷名（默认 doccraft-data）

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' frontend/package.json | head -1)"
IMAGE_TAG="${IMAGE_TAG:-doccraft-engine:${VERSION:-0.2.0}}"
CONTAINER_NAME="${CONTAINER_NAME:-doccraft-engine}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
HOST_PORT="${DOCCRAFT_HTTP_PORT:-5290}"
STATS_PORT="${DOCCRAFT_STATS_PORT:-8411}"
DATA_VOLUME="${DOCCRAFT_DATA_VOLUME:-doccraft-data}"
KEEP=0

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    -h|--help) awk 'NR==1{next} /^#/{print substr($0,3)} /^[^#[:space:]]/{exit}' "$0"; exit 0 ;;
    *) echo "[start] 未知参数: $arg（支持 --keep / --help）" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "[start] 未找到 docker" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || {
  echo "[start] 缺少 $ENV_FILE；请先执行 cp .env.example .env 并填写本地 PG/ES/PyUploadX" >&2
  exit 1
}

if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  ARCHIVE="$ROOT_DIR/docker/images/doccraft-engine_${VERSION}.tar.gz"
  [[ -f "$ARCHIVE" ]] || {
    echo "[start] 镜像 $IMAGE_TAG 不存在；请先执行 bash scripts/build_docker.sh" >&2
    exit 1
  }
  echo "[start] 自动加载 $ARCHIVE"
  docker load -i "$ARCHIVE"
fi

env_val() {
  key="$1"; default="${2:-}"
  val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  printf '%s' "${!key:-${val:-$default}}"
}

# 容器访问宿主机本地服务时，回环地址必须换成 host.docker.internal。
to_container_host() {
  value="$1"
  value="${value//@127.0.0.1:/@host.docker.internal:}"
  value="${value//@localhost:/@host.docker.internal:}"
  value="${value//\/\/127.0.0.1:/\/\/host.docker.internal:}"
  value="${value//\/\/localhost:/\/\/host.docker.internal:}"
  printf '%s' "$value"
}

DB_URL="$(to_container_host "$(env_val DOCCRAFT_DATABASE_URL 'postgresql+psycopg://open-ikc-platform:1qaz2wsx3edc@127.0.0.1:5432/doccraft')")"
ES_URL="$(to_container_host "$(env_val DOCCRAFT_ES_URL 'https://127.0.0.1:9200')")"
PYUPLOADX_URL="$(to_container_host "$(env_val DOCCRAFT_PYUPLOADX_BASE_URL 'http://127.0.0.1:8000')")"

if docker ps -aq --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
  if [[ "$KEEP" == "1" ]]; then
    echo "[start] --keep：容器 $CONTAINER_NAME 已存在，跳过重建"
    exit 0
  fi
  echo "[start] 重建容器 $CONTAINER_NAME"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "[start] 启动 $IMAGE_TAG（Web ${HOST_PORT}，stats ${STATS_PORT}，env: $ENV_FILE）"
docker run -d --name "$CONTAINER_NAME" --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  --env-file "$ENV_FILE" \
  -e "DOCCRAFT_DATABASE_URL=$DB_URL" \
  -e "DOCCRAFT_ES_URL=$ES_URL" \
  -e "DOCCRAFT_PYUPLOADX_BASE_URL=$PYUPLOADX_URL" \
  -p "127.0.0.1:${HOST_PORT}:5290" \
  -p "127.0.0.1:${STATS_PORT}:8404" \
  -v "${DATA_VOLUME}:/app/data" \
  "$IMAGE_TAG" web >/dev/null

echo "[start] 等待健康检查（最长 90s）"
for _ in $(seq 1 90); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || true)" == "healthy" ]]; then
    echo "[start] DocCraft 已启动"
    echo "  Web:   http://127.0.0.1:${HOST_PORT}"
    echo "  Stats: http://127.0.0.1:${STATS_PORT}/"
    exit 0
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "[start] 容器启动后退出，日志：" >&2
    docker logs --tail 50 "$CONTAINER_NAME" >&2 2>&1 || true
    exit 1
  fi
  sleep 1
done

echo "[start] 健康检查未在 90s 内通过，日志：" >&2
docker logs --tail 50 "$CONTAINER_NAME" >&2 2>&1 || true
exit 1
