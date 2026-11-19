#!/usr/bin/env bash
# يشغّل كل شيء: قاعدة البيانات + PostgREST + الوكيل + الموقع المبني. الاستخدام: dev/up.sh [--no-build]
cd "$(dirname "$0")/.."
dev/stack.sh >/tmp/stack.log 2>&1
if [ "${1:-}" = "--no-build" ] && [ -d dist ]; then
  pkill -f 'dist/server/entry.mjs' 2>/dev/null || true
  HOST=127.0.0.1 PORT=4321 setsid nohup node dist/server/entry.mjs >/tmp/site.log 2>&1 < /dev/null &
  sleep 1.5
else
  dev/serve.sh >/tmp/serve.log 2>&1
fi
curl -s -o /dev/null -w "site: %{http_code}\n" http://127.0.0.1:4321/
