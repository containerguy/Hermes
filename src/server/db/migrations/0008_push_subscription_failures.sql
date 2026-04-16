-- Phase 04: PWA And Realtime Reliability (push subscription cleanup)

ALTER TABLE push_subscriptions ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN last_failure_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_success_at TEXT;

