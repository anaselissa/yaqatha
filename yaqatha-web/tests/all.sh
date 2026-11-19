#!/usr/bin/env bash
# كل حزم الاختبار بالتسلسل (تأخذ عدة دقائق). الاستخدام: tests/all.sh
cd "$(dirname "$0")/.."
sec() { echo; echo "######## $1"; }
sec "TypeScript"; npx astro check 2>&1 | grep -E "Result|errors|warnings"
sec "الموقع العام"; RESET=1 dev/stack.sh >/dev/null 2>&1 </dev/null; dev/serve.sh >/dev/null 2>&1 </dev/null; sleep 1
node --test tests/site.test.mjs 2>&1 | grep -E "^not ok|^# (pass|fail)"
sec "الوصول (axe)"; BASE=http://localhost:4321 node tests/a11y.mjs 2>&1 | tail -2
sec "سقوط القاعدة"; tests/resilience.sh 2>&1 | grep -E "FAIL|^ok" | awk '/FAIL/{f++} /^ok/{o++} END{print o" ok, "f+0" FAIL"}'
sec "الإدارة عبر REST"; RESET=1 dev/stack.sh >/dev/null 2>&1 </dev/null; node --test tests/admin-api.test.mjs 2>&1 | grep -E "^not ok|^# (pass|fail)"
sec "رحلة المستخدم (Node)"; tests/e2e.sh 2>&1 | grep -E "^not ok|^# (pass|fail)"
sec "رحلة المستخدم (Cloudflare workerd)"; RUNTIME=cloudflare tests/e2e.sh 2>&1 | grep -E "^not ok|^# (pass|fail)"
sec "فحص الدخان"; RESET=1 dev/stack.sh >/dev/null 2>&1 </dev/null; set -a; . ./.env.local; set +a; node scripts/smoke-remote.mjs 2>&1 | tail -3
echo; echo "######## DONE"
