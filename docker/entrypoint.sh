#!/bin/sh
set -eu

ROLE="${1:-${DOCCRAFT_ROLE:-web}}"
INTERNAL_PORT="${DOCCRAFT_INTERNAL_PORT:-8100}"

wait_port() {
  host="$1"; port="$2"; pid="$3"; tries="${4:-80}"
  i=0
  while [ "$i" -lt "$tries" ]; do
    if python -c "import socket,sys; s=socket.socket(); s.settimeout(0.5); sys.exit(0 if s.connect_ex(('$host',$port))==0 else 1)"; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[error] 应用进程 $pid 已退出" >&2
      return 1
    fi
    i=$((i + 1))
    sleep 0.5
  done
  echo "[error] 127.0.0.1:$port 未在 $((tries / 2)) 秒内就绪" >&2
  return 1
}

start_api() {
  uvicorn app.main:app --host 127.0.0.1 --port "$INTERNAL_PORT" --proxy-headers --forwarded-allow-ips=127.0.0.1 &
  API_PID=$!
}

start_worker() {
  python -m app.worker &
  WORKER_PID=$!
}

stop_all() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${WORKER_PID:-}" ] && kill "$WORKER_PID" 2>/dev/null || true
  [ -n "${HAPROXY_PID:-}" ] && kill "$HAPROXY_PID" 2>/dev/null || true
}
trap 'stop_all; exit 0' TERM INT

case "$ROLE" in
  web)
    start_api
    wait_port 127.0.0.1 "$INTERNAL_PORT" "$API_PID"
    start_worker
    haproxy -db -f /etc/haproxy/haproxy.cfg &
    HAPROXY_PID=$!
    wait "$HAPROXY_PID"
    ;;
  api)
    exec uvicorn app.main:app --host 0.0.0.0 --port "$INTERNAL_PORT" --proxy-headers
    ;;
  worker)
    exec python -m app.worker
    ;;
  *)
    echo "[error] 未知角色: $ROLE（支持 web/api/worker）" >&2
    exit 1
    ;;
esac

stop_all
