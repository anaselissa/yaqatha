#!/usr/bin/env bash
# يشغّل مكدّس التطوير المحلي: PostgreSQL + بيانات التطوير + PostgREST + وكيل /rest/v1
# الاستخدام: dev/stack.sh   (يكتب .env.local ويترك الخدمات تعمل في الخلفية)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"; DB=yaqatha_dev
if command -v pg_lsclusters >/dev/null && pg_lsclusters | grep -q down; then pg_ctlcluster 16 main start || true; sleep 3; fi
SU="su postgres -c"
if ! $SU "psql -Atc \"select 1 from pg_database where datname='$DB'\"" | grep -q 1 || [ "${RESET:-0}" = 1 ]; then
  $SU "psql -q -c 'drop database if exists $DB with (force)' -c 'create database $DB encoding UTF8'" >/dev/null 2>&1
  for f in dev/db/tests/stub_supabase.sql dev/db/supabase/migrations/*.sql dev/db/supabase/seed.sql dev/dev-seed.sql; do
    $SU "psql -q -v ON_ERROR_STOP=1 -d $DB -f $ROOT/$f" >/dev/null
  done
  $SU "psql -q -d $DB -c \"do \\\$\\\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'authpass'; end if; end \\\$\\\$; grant anon, authenticated to authenticator;\"" >/dev/null
  echo "database $DB ready"
fi
pkill -f "tools/postgrest" 2>/dev/null || true; pkill -f "dev/proxy.mjs" 2>/dev/null || true; sleep 1
setsid nohup /home/claude/tools/postgrest dev/postgrest.conf >/tmp/postgrest.log 2>&1 < /dev/null &
setsid nohup node dev/proxy.mjs >/tmp/proxy.log 2>&1 < /dev/null &
sleep 2
ANON=$(node -e "
const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon',iss:'yaqatha-dev',exp:4102444800});
console.log(h+'.'+p+'.'+c.createHmac('sha256','dev-only-secret-dev-only-secret-0123456789').update(h+'.'+p).digest('base64url'))")
printf 'PUBLIC_SUPABASE_URL=http://localhost:54321\nPUBLIC_SUPABASE_ANON_KEY=%s\nSITE_URL=http://localhost:4321\n' "$ANON" > .env.local
curl -s -o /dev/null -w "doors via proxy: %{http_code}\n" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" http://localhost:54321/rest/v1/doors
