-- Migration 015: ACID Distributed Idempotency Locks for Redis Degradation Fallback
-- Ensures PostgreSQL can act as an atomic distributed lock manager if Redis is unavailable.

CREATE TABLE IF NOT EXISTS idempotency_locks (
  lock_key VARCHAR(255) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_locks_expires ON idempotency_locks (expires_at);
