#!/usr/bin/env bash
# رحلة المستخدم الكاملة: يعيد تهيئة القاعدة والمحاكي ويبني الموقع ثم يشغّل اختبارات المتصفح.
# RUNTIME=cloudflare يشغّلها على workerd (بيئة الإنتاج) بدل Node.
cd "$(dirname "$0")/.."
RESET=1 dev/stack.sh >/tmp/stack.log 2>&1 </dev/null
if [ "${RUNTIME:-node}" = cloudflare ]; then
  pkill -f 'dist/server/entry.mjs' 2>/dev/null; pkill -f 'preview --port 4321' 2>/dev/null; sleep 1
  SITE_URL=http://localhost:4321 ASTRO_ADAPTER=cloudflare npx astro build >/tmp/build-cf.log 2>&1 || { tail -20 /tmp/build-cf.log; exit 1; }
  SITE_URL=http://localhost:4321 ASTRO_ADAPTER=cloudflare setsid nohup npx astro preview --port 4321 --host 127.0.0.1 >/tmp/site.log 2>&1 </dev/null &
  for i in $(seq 1 60); do curl -s -m 3 -o /dev/null http://127.0.0.1:4321/ && break; sleep 1; done
else
  dev/serve.sh >/tmp/serve.log 2>&1 </dev/null || { cat /tmp/serve.log; exit 1; }
fi
node --test --test-concurrency=1 tests/e2e.mjs
