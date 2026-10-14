/**
 * Environnement minimal des tests unitaires : les modules qui dérivent une clé (crypto, MFA, jetons
 * acheteur, cartes cadeaux) refusent de démarrer sans `APP_SECRET`. Valeur de test uniquement.
 */
process.env.APP_SECRET ||= "test-secret-vitest-0123456789abcdef0123456789abcdef";
process.env.NEXT_PUBLIC_APP_URL ||= "http://localhost:3000";
