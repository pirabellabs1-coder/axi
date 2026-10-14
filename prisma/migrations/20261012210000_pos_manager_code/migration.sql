-- Code gérant de la caisse (correctif de sécurité vague 3, bloquant n° 1).
-- Migration ADDITIVE : deux colonnes facultatives sur Store, aucune valeur obligatoire, aucun renommage.
-- `posManagerCodeHash` = HMAC-SHA256(APP_SECRET, "pos-manager:<storeId>:<code>") ; le code en clair
-- n'est jamais stocké ni réaffiché. Tant que la colonne est NULL, aucune remise au-delà du plafond
-- du rôle n'est possible (le dépassement est refusé, jamais accordé par défaut).
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "posManagerCodeHash" TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "posManagerCodeSetAt" TIMESTAMP(3);
