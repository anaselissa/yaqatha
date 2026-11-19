#!/usr/bin/env bash
# تشغيل كامل: إعادة إنشاء القاعدة ثم الاختبارات. الاستخدام: tests/run.sh
set -euo pipefail
# يشغّل العنقود المحلي إن كان متوقفًا (بيئة الاختبار فقط)
if command -v pg_lsclusters >/dev/null && pg_lsclusters | grep -q down; then pg_ctlcluster 16 main start || true; sleep 3; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/tests/apply.sh" yq_test
if [ "$(id -u)" = 0 ]; then RUN="su postgres -c"; else RUN="bash -c"; fi
$RUN "psql -q -v ON_ERROR_STOP=1 -d yq_test -f $ROOT/tests/db.test.sql" 2>&1
