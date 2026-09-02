-- Migration 013: Approvals and Inventory Reservations Concurrency Hardening

CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_unique_purchase_intent 
ON approvals (purchase_intent_id) 
WHERE purchase_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_reservations_unique_quote 
ON inventory_reservations (quote_id) 
WHERE quote_id IS NOT NULL;
