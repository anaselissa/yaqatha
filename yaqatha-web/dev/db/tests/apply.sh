#!/usr/bin/env bash
# يعيد إنشاء قاعدة الاختبار ويطبّق البديل والهجرات والبيانات الأولية. الاستخدام: tests/apply.sh [dbname]
set -euo pipefail
# يشغّل العنقود المحلي إن كان متوقفًا (بيئة الاختبار فقط)
if command -v pg_lsclusters >/dev/null && pg_lsclusters | grep -q down; then pg_ctlcluster 16 main start || true; sleep 3; fi
DB="${1:-yq}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -q -v ON_ERROR_STOP=1"
if [ "$(id -u)" = 0 ]; then RUN="su postgres -c"; else RUN="bash -c"; fi
$RUN "psql -q -c 'drop database if exists $DB' -c 'create database $DB encoding UTF8'" >/dev/null 2>&1
for f in "$ROOT/tests/stub_supabase.sql" "$ROOT"/supabase/migrations/*.sql "$ROOT/supabase/seed.sql"; do
  $RUN "$PSQL -d $DB -f $f"
done
echo "applied OK to $DB"
