#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DO_BUILD=true
DO_SAVE=true
NO_CACHE=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) DO_BUILD=false ;;
    --no-save) DO_SAVE=false ;;
    --no-cache) NO_CACHE=true ;;
    -h|--help) sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "[usage] 未知参数: $arg（--skip-build / --no-save / --no-cache）" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null || { echo "未找到 docker" >&2; exit 1; }
VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' frontend/package.json | head -1)"
IMAGE_TAG="${IMAGE_TAG:-doccraft-engine:${VERSION}}"
PYTHON_IMAGE="${PYTHON_IMAGE:-python:3.12-slim}"

if [ "$DO_BUILD" = true ]; then
  echo "[build] 前端类型检查与构建"
  if [ ! -d frontend/node_modules ]; then
    (cd frontend && npm ci)
  fi
  (cd frontend && npm run build)
  echo "[build] Python 语法检查"
  PYTHONPATH="${PYTHONPATH:-}" python3 -m compileall -q app
fi
[ -f frontend/dist/index.html ] || { echo "缺少 frontend/dist/index.html" >&2; exit 1; }

build_args=(--build-arg "PYTHON_IMAGE=${PYTHON_IMAGE}")
[ "$NO_CACHE" = true ] && build_args+=(--no-cache)
echo "[build] docker build -t $IMAGE_TAG"
docker build "${build_args[@]}" -t "$IMAGE_TAG" .

EXPORT="docker/images/doccraft-engine_${VERSION}.tar.gz"
if [ "$DO_SAVE" = true ]; then
  mkdir -p docker/images
  echo "[build] 导出 $EXPORT"
  docker save "$IMAGE_TAG" | gzip > "$EXPORT"
  echo "[build] 已导出 $EXPORT ($(du -h "$EXPORT" | cut -f1))"
fi

cat <<EOF

完成：$IMAGE_TAG
部署：
  1) docker load -i ${EXPORT}
  2) cp .env.example .env，填写本地 PG/ES/PyUploadX 地址
  3) bash scripts/start_docker.sh
  4) curl -fsS http://127.0.0.1:5290/healthz
EOF
