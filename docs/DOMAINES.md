# Noms de domaine : achat et renouvellement via Axi (revendeur Route 53)

Depuis **Domaine** (`/app/{storeId}/domaine`), un marchand (plan Business et plus, capacité `billing.manage`) peut
chercher, acheter et renouveler un nom de domaine. Axi est revendeur via **Amazon Route 53 Domains** et prend une
**commission** (marge) sur chaque achat et chaque renouvellement. Un domaine déjà possédé se connecte toujours
comme avant (« Connecter un domaine que vous possédez », vérification TXT).

## Parcours

1. **Recherche** : disponibilité, suggestions et prix TTC dans la **devise de la boutique** (`Store.currency`).
2. **Titulaire** : le marchand (prénom, nom, entreprise, e-mail, téléphone, adresse, pays), pré-rempli depuis la
   boutique. La protection de la vie privée (WHOIS) est toujours activée.
3. **Facture** : une facture plateforme (`Invoice`, numérotation `AXI-AAAA-…`) est créée avec une `DomainCharge`
   (type `REGISTER`). Elle se paie comme toutes les factures Axi (page facture : Mobile Money / carte / manuel).
   Aucun nouveau fournisseur de paiement. Le nom **n'est pas réservé** avant paiement ; facture à régler sous 2 jours,
   sinon elle est annulée et le nom libéré.
4. **Paiement confirmé** (webhook signé ou « Marquer payée » admin → `confirmInvoicePayment`) : la charge passe
   `PAID` et le job `domain.register` est mis en file **dans la même transaction**.
5. **Job** : `RegisterDomain` chez Route 53 → suivi de l'opération (`domain.poll`, délais 2 à 30 min, abandon après
   ~3 jours) → à la réussite : échéance relue, zone DNS + enregistrements A (et AAAA) pour `domaine.tld` et
   `www.domaine.tld` vers `DOMAINS_TARGET_IPV4`, création des deux `Domain` **vérifiés** rattachés à la boutique
   (l'apex devient principal s'il n'y en a pas), e-mail + notification.
6. Le certificat HTTPS est émis à la première visite par Caddy (`on_demand_tls`, ci-dessous).

Statuts (`DomainRegistration.status`) : `AWAITING_PAYMENT` → `PENDING` → `REGISTERED` ; `FAILED` (échec registrar après
paiement, relance admin), `EXPIRED`, `CANCELLED` (achat non payé), `TRANSFERRED_OUT` (réservé, transfert sortant traité
manuellement par le support).

## Tarification

`src/lib/domains/pricing.ts` (pur, testé) :

```
coût       = prix Route 53 (USD) × années          (ListPrices, mémorisé 6 h)
marge USD  = max(coût × pourcentage, minimum/an × années)
prix       = (coût + marge) converti USD → devise de la boutique, arrondi SUPÉRIEUR :
             multiple de 100 pour une devise sans décimales (XOF, XAF, JPY…), unité entière sinon (EUR, USD…)
marge      = prix − coût converti (l'arrondi va à la marge)
```

- Conversion : taux plateforme (`ExchangeRate`, BCE quotidienne + parités fixes BCEAO), via `resolvePlatformRate`
  (`src/lib/currency/convert.ts`) ; arithmétique exacte en fractions. Un taux de plus de 72 h bloque la vente
  (« taux indisponible ») au lieu de vendre à perte. Le taux est figé sur la charge (`DomainCharge.fxRate`).
- Marge : réglage plateforme `PlatformSetting["domains.margin"] = { percentBps, minUsdCentsPerYear }`, éditable dans
  **Console → Noms de domaine**. Défaut : 20 %, minimum 5 $ / an.
- Renouvellement : **prix courant** (coût de renouvellement Route 53 + marge, taux du jour) au moment de la facture.
- La facture est dans la devise de la boutique ; le fournisseur de paiement est choisi par `zoneForCurrency` (XOF →
  zone Afrique, autres → zone Monde/Stripe). Une devise que le fournisseur de la zone n'accepte pas se règle en
  mode manuel.

## Renouvellement

Cycle de vie `runDomainLifecycle` (`src/lib/domains/lifecycle.ts`), appelé par `runBillingLifecycle` (cron horaire) :

| Moment | Action |
|---|---|
| J-30 | Facture de renouvellement (si auto-renouvellement actif), échéance J-7 |
| J-30, J-7, J-1 | Rappel e-mail + notification (une fois par seuil et par échéance) |
| J-7, facture impayée | Alerte unique au marchand (e-mail + notification). La facture reste payable jusqu'à l'échéance : un paiement tardif déclenche un `RenewDomain` explicite |
| Échéance dépassée | `EXPIRED`, factures ouvertes annulées, `Domain.verified=false` (plus de certificat ni de résolution) |

- **`AutoRenew` est désactivé en permanence chez AWS** (`RegisterDomain(AutoRenew=false)`, réaffirmé après
  l'enregistrement). AWS ne facture donc jamais un renouvellement que le marchand n'a pas payé.
- `DomainRegistration.autoRenew` est un **drapeau Axi** : il déclenche la facture J-30. L'interrupteur du marchand ne
  modifie que ce drapeau (aucun appel AWS). « Renouveler maintenant » émet la facture tout de suite.
- Seul le paiement d'une facture de renouvellement appelle AWS : job `domain.renew` → `RenewDomain(CurrentExpiryYear)`.

## Idempotence et sécurité

- **Jamais d'achat sans facture payée** : la charge ne passe `PAID` que dans `confirmInvoicePayment` ; le job revérifie
  `Invoice.status = PAID`.
- Une facture = une charge (`DomainCharge.invoiceId` unique). Réclamation `PAID → PROCESSING` (horodatée
  `claimedAt`) par `updateMany` conditionnel : un seul envoi par charge.
- **Appels facturés sans rejeu** : `RegisterDomain` / `RenewDomain` passent par un client SDK à `maxAttempts: 1`.
  - refus explicite AWS (HTTP 4xx) → `FAILED` (rien n'a été soumis) ;
  - limitation (429 / Throttling) → retour à `PAID`, nouvelle tentative du job ;
  - délai dépassé, erreur réseau ou 5xx → la charge **reste `PROCESSING` sans `operationId`** (la requête a pu
    aboutir) et passe par la **réconciliation** au rejeu.
- **Réconciliation** : `ListOperations(SubmittedSince = claimedAt − 5 min, Type = REGISTER_DOMAIN | RENEW_DOMAIN)`
  filtré sur le domaine → opération retrouvée : suivi normal ; sinon état du domaine (présent dans le compte /
  échéance déjà prolongée) ; sinon `FAILED`. La **relance admin** passe toujours par cette réconciliation et ne
  renvoie l'ordre que si aucune opération ni aucun effet n'est constaté.
- `RenewDomain` exige l'année d'échéance courante : un second renouvellement accidentel est refusé par Route 53.
- Commande sérialisée par nom (`pg_advisory_xact_lock`) : un nom ne peut pas être commandé par deux boutiques à la fois ;
  double clic = même facture.
- Isolation : toutes les lectures/écritures marchand filtrent `storeId` ; `requireStore(storeId, "billing.manage")`.
- IDN : seule l'écriture latine (accents compris), chiffres et tirets sont acceptés (pas d'homographes mêlant
  cyrillique / grec / latin) ; la console admin affiche la forme punycode et la forme Unicode.
- Données personnelles : le titulaire (`contact`) n'est conservé que le temps de l'enregistrement, puis anonymisé
  (`{ anonymized, country }`). Les messages AWS sont filtrés (e-mails, numéros, jetons) et tronqués à 200 caractères
  avant journalisation.
- Archivage : `DomainRegistration` / `DomainCharge` ne sont **jamais supprimées en cascade**. À la suppression d'une
  boutique, `storeId` passe à NULL (et `invoiceId` si la facture disparaît), le trigger PostgreSQL
  `domain_registration_archive` anonymise le titulaire et fige le nom de la boutique et le numéro de facture
  (`storeName`, `invoiceNumber`). Une charge ne peut pas être orpheline de sa commande (`RESTRICT`).
- Validation zod : nom normalisé (IDN → punycode), label 1 à 63 caractères sans tiret en bord ni `--` hors `xn--`,
  pas de sous-domaine, extension dans la liste blanche ; titulaire (`contactSchema`). Limitation de débit : 30
  recherches / 10 min et 10 commandes / h par boutique.
- Les factures de domaine ne sont ni une dette d'abonnement ni une période de plan (`addOnInvoiceIds` /
  `nonDebtInvoiceIds` les excluent) : un domaine impayé ne suspend jamais la boutique.
- Aucun secret : le SDK AWS lit les identifiants du **rôle IAM de l'instance** (IMDSv2).

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `DOMAINS_ENABLED=1` | Ouvre la vente (sinon la page affiche « bientôt » et l'option de connexion) |
| `DOMAINS_TARGET_IPV4` | Elastic IP de l'instance EC2 qui sert Caddy (cible des enregistrements A) |
| `DOMAINS_TARGET_IPV6` | Facultatif : enregistrements AAAA |
| `DOMAINS_ALLOWED_TLDS` | Extensions proposées, ex. `com,shop,store` (défaut : `com,net,org,shop,store,online,site,co,io,info,biz,me,app,fr,be,ch,ca`) |
| `DOMAINS_FAKE=1` | Registrar simulé (dev/tests). **Ignoré si `NODE_ENV=production`** |

Sans `DOMAINS_TARGET_IPV4`, le domaine est enregistré mais le DNS reste en attente (erreur visible dans la console ;
bouton « Configurer » après avoir posé la variable).

## Politique IAM (rôle de l'instance EC2), moindre privilège

Route 53 Domains n'existe qu'en **us-east-1** ; Route 53 (DNS) est global (ARN sans région). Remplacez
`ZPLATFORM` par l'identifiant de la zone hébergée de la plateforme (`axi.africa`) et `123456789012` par le compte.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AxiDomainsRegistrar",
      "Effect": "Allow",
      "Action": [
        "route53domains:CheckDomainAvailability",
        "route53domains:GetDomainSuggestions",
        "route53domains:ListPrices",
        "route53domains:RegisterDomain",
        "route53domains:GetOperationDetail",
        "route53domains:ListOperations",
        "route53domains:RenewDomain",
        "route53domains:DisableDomainAutoRenew",
        "route53domains:GetDomainDetail",
        "route53domains:UpdateDomainNameservers"
      ],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "us-east-1" } }
    },
    {
      "Sid": "AxiDomainsZonesRead",
      "Effect": "Allow",
      "Action": ["route53:ListHostedZonesByName", "route53:GetHostedZone", "route53:GetChange"],
      "Resource": "*"
    },
    {
      "Sid": "AxiDomainsZonesCreate",
      "Effect": "Allow",
      "Action": "route53:CreateHostedZone",
      "Resource": "*"
    },
    {
      "Sid": "AxiDomainsRecordsAOnly",
      "Effect": "Allow",
      "Action": "route53:ChangeResourceRecordSets",
      "Resource": "arn:aws:route53:::hostedzone/*",
      "Condition": {
        "ForAllValues:StringEquals": { "route53:ChangeResourceRecordSetsRecordTypes": ["A", "AAAA"] }
      }
    },
    {
      "Sid": "DenyPlatformZone",
      "Effect": "Deny",
      "Action": ["route53:ChangeResourceRecordSets", "route53:DeleteHostedZone", "route53:ChangeTagsForResource", "route53:AssociateVPCWithHostedZone"],
      "Resource": "arn:aws:route53:::hostedzone/ZPLATFORM"
    },
    {
      "Sid": "DenyDangerousRegistrarActions",
      "Effect": "Deny",
      "Action": [
        "route53domains:TransferDomain*",
        "route53domains:RetrieveDomainAuthCode",
        "route53domains:DisableDomainTransferLock",
        "route53domains:UpdateDomainContact*",
        "route53domains:DeleteDomain",
        "route53domains:EnableDomainAutoRenew"
      ],
      "Resource": "*"
    }
  ]
}
```

- `EnableDomainAutoRenew` est **refusé** : l'auto-renouvellement AWS reste coupé, aucune facturation AWS sans
  paiement préalable du marchand. Transferts, codes d'autorisation et changement de titulaire : console AWS par un
  humain (support), jamais par l'application.
- Les enregistrements sont limités aux types **A/AAAA** (aucun TXT n'est écrit : la preuve de possession est l'achat ;
  pas de MX/NS modifiables par l'application). La zone de la plateforme est explicitement exclue par un `Deny`.
- Restriction aux zones créées par Axi : Route 53 ne permet pas de conditionner `ChangeResourceRecordSets` sur un tag
  de zone. Mesures compensatoires : `Deny` sur la/les zones de la plateforme (ajoutez-y toute autre zone sensible du
  compte), types A/AAAA uniquement, et idéalement **un compte AWS dédié à la revente de domaines** (AWS Organizations),
  où ne vit aucune autre zone : c'est la seule isolation stricte.
- Instance : **IMDSv2 obligatoire avec `HttpPutResponseHopLimit = 1`**
  (`aws ec2 modify-instance-metadata-options --instance-id i-… --http-tokens required --http-put-response-hop-limit 1`)
  pour qu'un conteneur ou une SSRF ne puisse pas lire les identifiants du rôle.
- **AWS Budgets** : budget mensuel sur le service « Amazon Route 53 » (domaines + zones) avec alertes à 50 / 80 / 100 %
  par e-mail, et alerte CloudTrail (EventBridge) sur `RegisterDomain` / `RenewDomain` pour comparer avec les factures
  payées dans la console Axi.
- Chaque zone hébergée coûte ~0,50 $ / mois : à intégrer dans la marge minimale. Vérification du rôle depuis
  l'instance : `aws sts get-caller-identity`.

## Caddy : HTTPS à la demande

Les domaines des marchands obtiennent leur certificat à la première requête. L'endpoint `ask` existant
`/api/domains/resolve` convient : il répond 200 uniquement pour un domaine **vérifié** d'une boutique visible
(publiée ou fermée temporairement), 404 sinon. Il accepte le paramètre `domain` envoyé par Caddy (et `host` utilisé
par `src/proxy.ts`).

```
{
  on_demand_tls {
    ask http://127.0.0.1:3000/api/domains/resolve
  }
}

axi.africa, *.axi.africa {
  reverse_proxy 127.0.0.1:3000
  tls { dns route53 }   # ou le fournisseur DNS du domaine plateforme (wildcard DNS-01)
}

# Domaines personnalisés (connectés ou achetés via Axi)
https:// {
  tls { on_demand }
  reverse_proxy 127.0.0.1:3000
}
```

Le `ask` empêche quiconque de faire émettre des certificats pour des noms arbitraires (limites Let's Encrypt).

## Limites

- **Extensions non vendables par API** (`.bj`, `.ci`, `.sn`, `.cm`, `.tg`… liste `NON_API_TLDS`) : message clair à la
  recherche ; le marchand l'achète chez le registre national puis le connecte (vérification TXT).
- Noms **premium** et extensions à pré-commande : présentés comme indisponibles.
- Délais : enregistrement de quelques minutes à quelques heures (jusqu'à plusieurs jours pour certaines extensions) ;
  propagation DNS jusqu'à 1 h ; e-mail de vérification du titulaire envoyé par le registre (ICANN) à confirmer sous
  15 jours, sinon suspension du domaine.
- Remboursement, transfert sortant (code d'autorisation), changement de titulaire : traités manuellement par le support
  (console Route 53).
- `DomainRegistration` garde le prix initial ; l'historique complet (achat + renouvellements, coût, prix, marge, taux)
  est dans `DomainCharge`.

## Fichiers

- `src/lib/domains/names.ts`, `pricing.ts` : validation et tarification (purs)
- `src/lib/domains/registrar/{types,route53,fake,index}.ts` : interface `Registrar`, client Route 53, simulé
- `src/lib/domains/service.ts` : commande, facture, paiement, exécution, DNS, rattachement
- `src/lib/domains/lifecycle.ts`, `jobs.ts` : cycle de vie et jobs `domain.register | domain.renew | domain.poll`
- `src/lib/domains/purchase-actions.ts`, `admin-actions.ts` : actions marchand / console
- `src/app/app/[storeId]/domaine/purchase-client.tsx`, `src/app/admin/domaines/**`
- Tests : `tests/domains-pricing.test.ts`, `tests/domains-registration.test.ts`
