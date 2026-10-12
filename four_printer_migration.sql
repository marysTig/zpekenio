-- ============================================================
-- Migration : Ajout du type "four" pour l'imprimante cuisine
-- À exécuter dans le SQL Editor de Supabase
-- ============================================================

-- 1) Élargir la contrainte CHECK pour accepter 'four'
--    (on garde 'caisse' et 'cuisine' pour compatibilité)
ALTER TABLE public.printers DROP CONSTRAINT IF EXISTS printers_type_check;

ALTER TABLE public.printers
  ADD CONSTRAINT printers_type_check
  CHECK (type = ANY (ARRAY['caisse'::text, 'cuisine'::text, 'four'::text]));

-- 2) S'assurer que les colonnes categories / category_ids existent
--    (elles existent déjà si la migration initiale a été exécutée)
ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';

-- Vérification rapide (optionnel)
SELECT id, name, type, enabled, array_length(category_ids, 1) AS nb_categories
FROM public.printers
ORDER BY created_at;
