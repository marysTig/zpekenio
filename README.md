# Z-pekenio Caisse

Création de l'interface Caisse — Z-pekenio

Crée l'interface principale de Caisse (POS) pour le restaurant Z-pekenio.

🎯 Objectif

Cette interface est le cœur opérationnel du logiciel. Elle doit permettre au caissier de prendre une commande rapidement, sélectionner les produits, modifier les quantités et voir en permanence le panier ainsi que le total.

Pour cette première étape, ne crée pas encore le Dashboard, les rapports, les crédits clients, les imprimantes, les RH, le KDS ou le multi-restaurant.

Concentre-toi uniquement sur l'interface Caisse.

🎨 Direction artistique

Créer une interface :

Moderne

Premium

Professionnelle

Minimaliste

Très rapide à utiliser

Inspirée des meilleurs logiciels POS de restaurants modernes

Optimisée pour un écran Desktop 1366px / 1440px

Responsive pour tablette

Couleurs

Utilise principalement :

Background général : #F5F6F8

Sidebar : #111827

Cartes : #FFFFFF

Texte principal : #111827

Texte secondaire : #6B7280

Couleur principale/action : #F97316

Succès : #22C55E

Erreur : #EF4444

Bordures : #E5E7EB

L'orange doit être utilisé principalement pour les actions importantes et les éléments actifs.

Ne surcharge pas l'interface avec trop de couleurs.

Typographie

Utilise Inter ou une police moderne similaire.

Les montants importants doivent être très lisibles.

🖥️ STRUCTURE DE L'INTERFACE

L'écran doit être divisé en 3 zones principales :

┌─────────────────────────────────────────────────────────────────────────┐

│ TOP BAR                                                                  │

├───────────────┬───────────────────────────────────────┬─────────────────┤

│               │                                       │                 │

│   SIDEBAR     │       PRODUITS / CATÉGORIES           │   COMMANDE      │

│               │                                       │                 │

│               │                                       │                 │

│               │                                       │                 │

│               │                                       │                 │

│               │                                       │                 │

│               │                                       │                 │

└───────────────┴───────────────────────────────────────┴─────────────────┘

1. SIDEBAR — NAVIGATION

Créer une sidebar verticale fixe à gauche.

En haut :

Z-PEKENIO

avec une petite icône/logo de restaurant.

Navigation :

🧾 Caisse — actif

🪑 Tables

📋 Commandes

💳 Crédits

📊 Rapports

Séparateur.

⚙️ Paramètres

En bas :

Avatar du caissier

Nom : Caissier

Statut : En ligne

Déconnexion

État actif

La section Caisse doit être clairement visible avec :

fond orange très léger ou orange

icône orange/blanche

texte plus contrasté

La sidebar doit être élégante et compacte.

2. TOP BAR

Créer une barre supérieure dans la zone principale.

À gauche :

Caisse

Prise de commande

À droite :

🔍 Rechercher un produit...

🔔

👤 Caissier

Ajouter également une petite indication :

Aujourd'hui — 17 Août 2026

3. ZONE PRODUITS

La partie centrale doit être dédiée aux produits.

Catégories

Afficher les catégories horizontalement sous le header.

Exemple :

[Tous] [Pizzas] [Burgers] [Plats] [Boissons] [Desserts]

La catégorie active doit être orange.

Les catégories doivent être faciles à cliquer avec de grandes zones tactiles.

4. RECHERCHE PRODUIT

Ajouter une barre de recherche :

🔍 Rechercher un produit...

La recherche doit filtrer les produits instantanément.

Prévoir également la recherche par :

nom

catégorie

5. GRILLE PRODUITS

Afficher les produits sous forme de cartes.

Exemple :

┌─────────────┐ ┌─────────────┐ ┌─────────────┐

│             │ │             │ │             │

│    IMAGE    │ │    IMAGE    │ │    IMAGE    │

│             │ │             │ │             │

├─────────────┤ ├─────────────┤ ├─────────────┤

│ Margherita  │ │ 4 Fromages  │ │ Burger      │

│ Pizza       │ │ Pizza       │ │ Classic     │

│             │ │             │ │             │

│ 650 DA      │ │ 900 DA      │ │ 750 DA      │

└─────────────┘ └─────────────┘ └─────────────┘

Chaque carte doit contenir :

image

nom

catégorie

prix

statut disponible/indisponible

Interaction

Lorsqu'on clique sur un produit :

Ajouter immédiatement le produit au panier.

Ne demande pas de confirmation inutile.

Si le produit est déjà dans le panier :

augmenter automatiquement sa quantité de +1.

6. PANIER / COMMANDE À DROITE

La partie droite doit être une sidebar de commande fixe.

Elle doit rester visible même lorsque l'utilisateur navigue dans les catégories.

Header :

Commande

Table 12

Ajouter éventuellement :

[Changer de table]

Articles du panier

Exemple :

🍔 Burger Classic

[-] 2 [+]

750 DA

Chaque article doit permettre :

augmenter quantité

diminuer quantité

supprimer

modifier

Afficher clairement le prix total de la ligne.

Exemple :

Burger Classic

2 × 750 DA                  1 500 DA

7. NOTES / MODIFICATION

Prévoir une petite action sur chaque article :

Modifier

Elle ouvrira plus tard une modal permettant :

Suppléments

Modificateurs

Notes

Pour cette première version, créer simplement l'interface de la modal sans connecter toute la logique métier.

Exemple :

Modifier Burger Classic

Suppléments

☐ Fromage +100 DA

☐ Œuf +100 DA

☐ Bacon +150 DA

Note

[ Sans oignons                  ]

[Annuler] [Ajouter]

8. RÉSUMÉ DE LA COMMANDE

En bas du panier :

────────────────────────────

Sous-total                  2 220 DA

Remise                          0 DA

────────────────────────────

TOTAL                       2 220 DA

Le TOTAL doit être beaucoup plus visible que les autres informations.

9. BOUTON PAIEMENT

Créer un gros bouton orange en bas du panier :

💳 PAYER — 2 220 DA

Le bouton doit être :

très visible

large

facilement cliquable

fixé en bas du panneau panier

Pour cette première étape, le bouton peut ouvrir une modal de paiement placeholder, mais ne développe pas encore toute la logique de paiement.

10. ÉTAT PANIER VIDE

Prévoir également l'état lorsque aucune commande n'est créée.

Afficher :

        🛒

Aucune commande

Sélectionnez un produit

pour commencer une commande.

Ne pas laisser un grand espace vide sans indication.

11. DONNÉES DE DÉMONSTRATION

Utilise de fausses données réalistes pour rendre l'interface immédiatement exploitable.

Catégories :

Tous

Pizzas

Burgers

Plats

Boissons

Desserts

Produits :

Pizza Margherita — 650 DA

Pizza 4 Fromages — 900 DA

Pizza Viande — 950 DA

Burger Classic — 750 DA

Chicken Burger — 800 DA

Double Burger — 950 DA

Frites — 250 DA

Coca Cola — 120 DA

Eau — 80 DA

Tiramisu — 400 DA

Utiliser des images de démonstration cohérentes avec les produits.

12. UX IMPORTANTE

Cette interface est utilisée dans un restaurant pendant le service.

Donc :

éviter les animations inutiles

éviter les popups inutiles

privilégier les gros boutons

privilégier les clics rapides

garder le panier toujours visible

afficher immédiatement les changements de quantité

mettre à jour le total en temps réel

éviter les pages inutiles

rendre les actions principales accessibles en 1 clic

Le caissier doit pouvoir faire :

Choisir catégorie → Cliquer produit → Produit ajouté → Payer

avec le minimum d'étapes.

13. RESPONSIVE

Desktop :

Sidebar 220px

Produits environ 65%

Panier environ 35%

Sur tablette :

réduire la sidebar

conserver les produits et le panier

garder le bouton paiement visible

Ne transforme pas l'application en une interface mobile classique.

Elle doit rester une interface POS tactile.

14. ARCHITECTURE DU CODE

Construis l'interface avec des composants réutilisables :

Sidebar

TopBar

CategoryTabs

ProductSearch

ProductGrid

ProductCard

OrderPanel

OrderItem

OrderSummary

PaymentButton

ModifierModal

Utilise une structure propre afin que les prochaines interfaces puissent réutiliser les mêmes composants.

15. IMPORTANT — NE PAS AJOUTER

Pour cette première version, ne développe pas :

❌ Dashboard

❌ RH

❌ KDS

❌ Multi-restaurants

❌ Analytics avancés

❌ Gestion des imprimantes

❌ Rapport Z complet

❌ Gestion complète des crédits

❌ Backend complexe

Nous construisons d'abord le frontend de l'écran Caisse et son expérience utilisateur.

Prépare cependant l'architecture pour pouvoir connecter ces modules plus tard.

✅ RÉSULTAT ATTENDU

Je veux obtenir une interface qui ressemble à un vrai logiciel POS professionnel de restaurant, et non à une simple dashboard web.

Le résultat doit être :

rapide + élégant + tactile + lisible + professionnel + orienté prise de commande.

Priorité absolue :

Produits au centre + commande toujours visible à droite + total très visible + bouton PAYER accessible en permanence.

Ne crée aucune autre page inutile pour le moment.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d1abcd29-6bee-4825-87f6-99c58d5f836b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
