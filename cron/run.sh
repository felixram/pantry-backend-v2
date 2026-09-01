#!/bin/sh
# Runs hourly via Railway's native cron schedule (see railway.toml). Hits
# server-v2's own /api/cron/* endpoints over Railway's private network
# rather than the public domain. Unlike v1 (which only ever wired up
# inventory-reminder), this activates all of them — the purge jobs exist in
# the API but were never called by anything in v1 production, and
# email-queue-sweep backs up the in-process email worker.
BASE_URL="http://vantory-v2-api.railway.internal:3030"

run_cron() {
  echo "Running $1..."
  curl -fsS -X POST "$BASE_URL/api/cron/$1" -H "Authorization: Bearer $CRON_SECRET" || echo "  ! $1 failed"
}

run_cron inventory-reminder
run_cron product-purge
run_cron supplier-purge
run_cron category-purge
run_cron tax-rate-purge
run_cron email-queue-sweep
