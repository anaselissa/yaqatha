#!/usr/bin/env bash
# يبني المشروع ويشغّل الخادم المبني على :4321 (يتطلب dev/stack.sh أولًا)
set -euo pipefail
cd "$(dirname "$0")/.."
for pat in 'dist/server/entry.mjs' 'astro preview' workerd; do pkill -f "$pat" 2>/dev/null || true; done; sleep 1
npx astro build >/tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }
HOST=127.0.0.1 PORT=4321 setsid nohup node dist/server/entry.mjs >/tmp/site.log 2>&1 < /dev/null &
for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:4321/ && break; sleep 0.5; done
echo "site up"
