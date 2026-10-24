ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LANG=C.UTF-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends haproxy ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY frontend/dist ./frontend/dist
COPY haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg
COPY docker/entrypoint.sh /usr/local/bin/doccraft-entrypoint

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin doccraft \
    && mkdir -p /app/data \
    && chown -R doccraft:doccraft /app \
    && chmod +x /usr/local/bin/doccraft-entrypoint

USER doccraft

# 5290 是唯一对外入口，8100 仅监听容器回环；8404 为 HAProxy 状态页。
EXPOSE 5290 8404

HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5290/healthz', timeout=3)" || exit 1

ENTRYPOINT ["/usr/local/bin/doccraft-entrypoint"]
CMD ["web"]
