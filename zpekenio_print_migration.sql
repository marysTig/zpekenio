-- ============================================================================
-- zpekenio — migration complète du système d'impression (architecture Vida Food)
-- À exécuter UNE FOIS dans le SQL Editor de Supabase (projet zpekenio).
-- Idempotente : peut être relancée sans risque.
--
-- Contenu, dans l'ordre :
--   1. kitchen_print_migration.sql        (print_settings, hub principal, category_ids)
--   2. print_settings_fallback_migration  (colonne fallback)
--   3. print_jobs_daemon_migration.sql    (file print_jobs durable + realtime)
--   4. Normalisation des imprimantes      (four/plaque -> cuisine, 1 seule cuisine)
--   5. print_jobs_claim_rpc.sql           (claim atomique claim_print_jobs)
--   6. printers_usb_transport_migration   (colonnes transport + claim_print_jobs v2)
--   7. print_pipeline_hardening_migration (RPC fingerprints, trigger, cleanup)
--
-- Prérequis : table printers existante, table_orders.items de type jsonb
-- (vérifié à l'étape 7 : la migration s'arrête avec une erreur sinon).
-- ============================================================================

-- ── 1. kitchen_print_migration.sql ──────────────────────────────
-- Kitchen print queue + primary hub + category_id routing
-- Run in Supabase SQL Editor.

-- ── 1. printers.category_ids (UUID routing; keep categories text[] for rollback) ─

ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill category_ids from legacy name array when categories table exists
UPDATE public.printers p
SET category_ids = COALESCE((
  SELECT ARRAY_AGG(c.id ORDER BY c.name)
  FROM public.categories c
  WHERE c.name = ANY (COALESCE(p.categories, '{}'::text[]))
), '{}'::uuid[])
WHERE COALESCE(cardinality(p.category_ids), 0) = 0
  AND COALESCE(cardinality(p.categories), 0) > 0;

-- ── 2. print_settings (singleton: which device is the primary print hub) ───────

CREATE TABLE IF NOT EXISTS public.print_settings (
  id uuid PRIMARY KEY DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  primary_device_id text NOT NULL DEFAULT '',
  fallback_kitchen_printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.print_settings (id, primary_device_id)
VALUES ('00000000-0000-4000-8000-000000000001'::uuid, '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.print_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access on print_settings" ON public.print_settings;
CREATE POLICY "Allow all access on print_settings"
  ON public.print_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.print_settings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. kitchen_print_jobs (durable, idempotent queue) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.kitchen_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'printing', 'done', 'failed', 'cancelled')),
  claimed_by_device_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  printed_at timestamptz,
  CONSTRAINT kitchen_print_jobs_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS kitchen_print_jobs_status_created_idx
  ON public.kitchen_print_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS kitchen_print_jobs_table_id_idx
  ON public.kitchen_print_jobs (table_id);

ALTER TABLE public.kitchen_print_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access on kitchen_print_jobs" ON public.kitchen_print_jobs;
CREATE POLICY "Allow all access on kitchen_print_jobs"
  ON public.kitchen_print_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.kitchen_print_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Fallback consolidated kitchen printer (safe if already applied)
ALTER TABLE public.print_settings
  ADD COLUMN IF NOT EXISTS fallback_kitchen_printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL;

-- ── 2. print_settings_fallback_migration.sql ──────────────────────────────
-- Add consolidated kitchen fallback printer (run after kitchen_print_migration.sql)

ALTER TABLE public.print_settings
  ADD COLUMN IF NOT EXISTS fallback_kitchen_printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL;

-- ── 3. print_jobs_daemon_migration.sql ──────────────────────────────
-- print_jobs for PrintQueueDaemon
-- Copy ALL of this into Supabase SQL Editor, then Run.
-- Tip: if it fails, first run only the smoke test at the bottom.

CREATE TABLE IF NOT EXISTS public.print_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  table_id uuid NULL,
  job_type text NOT NULL,
  priority integer NOT NULL DEFAULT 10,
  printer_id uuid NULL,
  printer_name text NULL,
  mac_address text NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_by_device_id text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  printed_at timestamptz NULL,
  PRIMARY KEY (id),
  UNIQUE (idempotency_key),
  CHECK (job_type = ANY (ARRAY['kitchen'::text, 'receipt'::text])),
  CHECK (status = ANY (ARRAY['pending'::text, 'printing'::text, 'done'::text, 'needs_manual'::text, 'cancelled'::text]))
);

CREATE INDEX IF NOT EXISTS print_jobs_drain_idx
  ON public.print_jobs (status, priority DESC, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS print_jobs_needs_manual_idx
  ON public.print_jobs (status)
  WHERE status = 'needs_manual';

ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access on print_jobs" ON public.print_jobs;

CREATE POLICY "Allow all access on print_jobs"
  ON public.print_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

DO $print_jobs_realtime$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.print_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$print_jobs_realtime$;

-- SMOKE TEST (optional): uncomment these 2 lines alone if CREATE still fails
-- CREATE TABLE IF NOT EXISTS public._uuid_smoke (id uuid PRIMARY KEY);
-- DROP TABLE IF EXISTS public._uuid_smoke;

-- ── 4. Normalisation : une seule imprimante cuisine, plus de "four" ─────────────
-- Les types four/plaque deviennent cuisine (fourre-tout : aucun filtre de catégorie,
-- l'unique imprimante reçoit toute la commande). La caisse n'est plus utilisée.
ALTER TABLE public.printers DROP CONSTRAINT IF EXISTS printers_type_check;
ALTER TABLE public.printers
  ADD CONSTRAINT printers_type_check
  CHECK (type = ANY (ARRAY['caisse'::text, 'cuisine'::text, 'plaque'::text, 'four'::text]));

UPDATE public.printers
SET type = 'cuisine'
WHERE type IN ('plaque', 'four');

UPDATE public.printers
SET category_ids = '{}', categories = '{}'
WHERE type = 'cuisine';

WITH cuisine_ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN coalesce(trim(mac_address), '') <> '' THEN 0 ELSE 1 END,
        created_at ASC
    ) AS rn
  FROM public.printers
  WHERE type = 'cuisine'
)
UPDATE public.printers p
SET enabled = false
FROM cuisine_ranked r
WHERE p.id = r.id
  AND r.rn > 1
  AND p.enabled = true;

ALTER TABLE public.printers DROP CONSTRAINT IF EXISTS printers_type_check;
ALTER TABLE public.printers
  ADD CONSTRAINT printers_type_check
  CHECK (type = ANY (ARRAY['caisse'::text, 'cuisine'::text]));

-- ── 5. print_jobs_claim_rpc.sql ──────────────────────────────
-- Atomic batch claim for native HubPrintWorker.
-- Parallel USB receipt + BT kitchen: no receipt-hold on kitchen claims.

CREATE OR REPLACE FUNCTION public.claim_print_jobs(
  p_device_id text,
  p_limit int DEFAULT 8
)
RETURNS SETOF public.print_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'p_device_id required';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 8;
  END IF;
  IF p_limit > 20 THEN
    p_limit := 20;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.print_jobs j
    WHERE j.status = 'pending'
      AND j.next_attempt_at <= now()
    ORDER BY j.priority DESC, j.created_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE public.print_jobs p
    SET
      status = 'printing',
      claimed_by_device_id = p_device_id,
      error = NULL,
      updated_at = now()
    FROM picked
    WHERE p.id = picked.id
    RETURNING p.*
  )
  SELECT * FROM updated
  ORDER BY priority DESC, created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_print_jobs(text, int) TO anon, authenticated, service_role;

-- ── 6. printers_usb_transport_migration.sql ──────────────────────────────
-- USB transport for Caisse (OTG) alongside Bluetooth kitchen.
-- Apply in Supabase SQL Editor if MCP migration was not used.

ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS transport text NOT NULL DEFAULT 'bluetooth',
  ADD COLUMN IF NOT EXISTS usb_vendor_id integer,
  ADD COLUMN IF NOT EXISTS usb_product_id integer;

ALTER TABLE public.printers DROP CONSTRAINT IF EXISTS printers_transport_check;
ALTER TABLE public.printers
  ADD CONSTRAINT printers_transport_check
  CHECK (transport = ANY (ARRAY['bluetooth'::text, 'usb'::text]));

ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS transport text NOT NULL DEFAULT 'bluetooth',
  ADD COLUMN IF NOT EXISTS usb_vendor_id integer,
  ADD COLUMN IF NOT EXISTS usb_product_id integer;

ALTER TABLE public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_transport_check;
ALTER TABLE public.print_jobs
  ADD CONSTRAINT print_jobs_transport_check
  CHECK (transport = ANY (ARRAY['bluetooth'::text, 'usb'::text]));

-- Parallel USB receipt + BT kitchen: do not block kitchen claims on pending receipts.
CREATE OR REPLACE FUNCTION public.claim_print_jobs(
  p_device_id text,
  p_limit int DEFAULT 8
)
RETURNS SETOF public.print_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'p_device_id required';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 8;
  END IF;
  IF p_limit > 20 THEN
    p_limit := 20;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.print_jobs j
    WHERE j.status = 'pending'
      AND j.next_attempt_at <= now()
    ORDER BY j.priority DESC, j.created_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE public.print_jobs p
    SET
      status = 'printing',
      claimed_by_device_id = p_device_id,
      error = NULL,
      updated_at = now()
    FROM picked
    WHERE p.id = picked.id
    RETURNING p.*
  )
  SELECT * FROM updated
  ORDER BY priority DESC, created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_print_jobs(text, int) TO anon, authenticated, service_role;

-- ── 7. print_pipeline_hardening_migration.sql ──────────────────────────────
-- Print pipeline hardening (Phase B + C) — run once in the Supabase SQL Editor.
-- Safe to re-run. The app (APK 1.6.0+) degrades gracefully until this is applied:
-- parallel lanes + auto-reroute default ON, fingerprint patch falls back to the
-- legacy read-modify-write, cleanup is skipped.

-- ── 0. Preflight: functions below require table_orders.items to be jsonb ─────
DO $preflight$
DECLARE
  t text;
BEGIN
  SELECT data_type INTO t
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'table_orders' AND column_name = 'items';
  IF t IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'table_orders.items is % — expected jsonb', t;
  END IF;
END
$preflight$;

-- ── 1. Hub settings: Bluetooth lane mode + kitchen auto-reroute ──────────────
ALTER TABLE public.print_settings
  ADD COLUMN IF NOT EXISTS bt_lane_mode text NOT NULL DEFAULT 'parallel',
  ADD COLUMN IF NOT EXISTS kitchen_auto_reroute boolean NOT NULL DEFAULT true;

ALTER TABLE public.print_settings DROP CONSTRAINT IF EXISTS print_settings_bt_lane_mode_check;
ALTER TABLE public.print_settings
  ADD CONSTRAINT print_settings_bt_lane_mode_check
  CHECK (bt_lane_mode = ANY (ARRAY['parallel'::text, 'serialized'::text]));

-- ── 2. Atomic "kitchen lines printed" (native hub after a kitchen ticket) ────
-- Only sets kitchenFingerprint / kitchenPrintedAt on the matching item ids in a
-- single UPDATE — never rewrites lines the cashier added or edited meanwhile.
CREATE OR REPLACE FUNCTION public.mark_kitchen_items_printed(
  p_table_id uuid,
  p_fingerprints jsonb,
  p_printed_at text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_fingerprints IS NULL OR jsonb_typeof(p_fingerprints) <> 'object' THEN
    RETURN 0;
  END IF;

  UPDATE public.table_orders t
  SET
    items = (
      SELECT coalesce(
        jsonb_agg(
          CASE
            WHEN p_fingerprints ? (x.e->>'id') THEN
              x.e || jsonb_build_object(
                'kitchenFingerprint', p_fingerprints->(x.e->>'id'),
                'kitchenPrintedAt', p_printed_at
              )
            ELSE x.e
          END
          ORDER BY x.ord
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(t.items) WITH ORDINALITY AS x(e, ord)
    ),
    updated_at = now()
  WHERE t.table_id = p_table_id
    AND jsonb_typeof(t.items) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(t.items) AS y(e)
      WHERE p_fingerprints ? (y.e->>'id')
    );

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_kitchen_items_printed(uuid, jsonb, text)
  TO anon, authenticated, service_role;

-- ── 3. Keep print marks when a stale client saves the whole order ────────────
-- Waiter/cashier tablets upsert the full items array from local state. If that
-- state predates the hub's print mark, the upsert would erase it and the lines
-- would print again on the next "Valider". For each item id present in both
-- rows, keep the newer kitchenPrintedAt (marks only ever move forward).
CREATE OR REPLACE FUNCTION public.table_orders_keep_kitchen_marks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.items IS NULL OR NEW.items IS NULL
     OR jsonb_typeof(OLD.items) <> 'array' OR jsonb_typeof(NEW.items) <> 'array' THEN
    RETURN NEW;
  END IF;

  NEW.items := (
    SELECT coalesce(
      jsonb_agg(
        CASE
          WHEN o.e IS NOT NULL
            AND (o.e->>'kitchenFingerprint') IS NOT NULL
            AND coalesce(o.e->>'kitchenPrintedAt', '') > coalesce(n.e->>'kitchenPrintedAt', '')
          THEN n.e || jsonb_build_object(
            'kitchenFingerprint', o.e->'kitchenFingerprint',
            'kitchenPrintedAt', o.e->'kitchenPrintedAt'
          )
          ELSE n.e
        END
        ORDER BY n.ord
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, ord)
    LEFT JOIN LATERAL (
      SELECT oe.e
      FROM jsonb_array_elements(OLD.items) AS oe(e)
      WHERE oe.e->>'id' = n.e->>'id'
      LIMIT 1
    ) o ON true
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS table_orders_keep_kitchen_marks ON public.table_orders;
CREATE TRIGGER table_orders_keep_kitchen_marks
  BEFORE UPDATE OF items ON public.table_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.table_orders_keep_kitchen_marks();

-- ── 4. print_jobs hygiene ────────────────────────────────────────────────────
-- Stale-printing reclaim (every 15s) and in-flight kitchen dedupe on enqueue.
CREATE INDEX IF NOT EXISTS print_jobs_printing_updated_idx
  ON public.print_jobs (updated_at)
  WHERE status = 'printing';

CREATE INDEX IF NOT EXISTS print_jobs_kitchen_table_idx
  ON public.print_jobs (table_id, status, updated_at)
  WHERE job_type = 'kitchen';

-- Finished jobs carry the full ESC/POS payload; the table was never purged.
-- Called by the native hub every 6h. needs_manual / pending / printing are kept.
CREATE OR REPLACE FUNCTION public.cleanup_print_jobs(p_keep_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    p_keep_days := 7;
  END IF;
  DELETE FROM public.print_jobs
  WHERE status IN ('done', 'cancelled')
    AND updated_at < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_print_jobs(integer)
  TO anon, authenticated, service_role;

