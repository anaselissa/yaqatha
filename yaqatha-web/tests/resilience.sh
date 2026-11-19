#!/usr/bin/env bash
# اختبار سقوط قاعدة البيانات: الصفحات تعرض 503 ودودة بلا تسريب تفاصيل، وتتعافى عند عودة الخدمة.
# يتطلب dev/up.sh أولًا. الاستخدام: tests/resilience.sh
cd "$(dirname "$0")/.."
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (got '$2', want '$3')"; fail=1; fi; }
pkill -f 'tools/postgrest' ; sleep 1
for p in / /needs/anger-control /library /paths/dev-anger-7days /search?q=a; do
  check "503 عند سقوط القاعدة: $p" "$(curl -s -o /tmp/r.html -w '%{http_code}' http://127.0.0.1:4321$p)" 503
done
check "رسالة ودودة" "$(grep -c 'تعذّر تحميل المحتوى الآن' /tmp/r.html || true)" 1
check "لا تسريب لعنوان القاعدة" "$(grep -c '54321\|PUBLIC_SUPABASE\|fetch failed' /tmp/r.html || true)" 0
check "sitemap: 503 مع Retry-After" "$(curl -s -o /dev/null -D- http://127.0.0.1:4321/sitemap.xml | grep -ci '^retry-after')" 1
check "الصفحات الثابتة تعمل رغم السقوط: /about" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4321/about)" 200
check "robots يعمل رغم السقوط" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4321/robots.txt)" 200
setsid nohup /home/claude/tools/postgrest dev/postgrest.conf >/tmp/postgrest.log 2>&1 </dev/null &
sleep 3
check "تعافٍ بعد عودة القاعدة" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4321/)" 200
exit $fail
