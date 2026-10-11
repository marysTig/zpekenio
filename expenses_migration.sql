-- Migration: expenses table for cash movements / POS expenses
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

-- Enable RLS and public policies (matching the existing project style)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'Allow public read on expenses'
  ) THEN
    CREATE POLICY "Allow public read on expenses" ON expenses FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'Allow public insert on expenses'
  ) THEN
    CREATE POLICY "Allow public insert on expenses" ON expenses FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'Allow public delete on expenses'
  ) THEN
    CREATE POLICY "Allow public delete on expenses" ON expenses FOR DELETE USING (true);
  END IF;
END $$;
