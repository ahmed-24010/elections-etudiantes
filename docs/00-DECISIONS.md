# 00 — Journal des décisions

## Plateforme de gestion des élections étudiantes

Ce fichier liste toutes les décisions de conception validées. En cas de doute pendant le développement, **ce journal fait foi**. Pour changer une décision : ajouter une nouvelle ligne qui la remplace (ne jamais effacer l'ancienne), puis mettre à jour les documents concernés.

**Dernière mise à jour :** 09/10/2026

---

## Décisions validées

| Réf. | Date | Sujet | Décision | Raison | Documents |
|---|---|---|---|---|---|
| D-01 | 09/10/2026 | Égalité de voix | **Second tour** : le comité crée une nouvelle élection, liée à la première, limitée aux ex-aequo | Juste, compréhensible, aucune règle arbitraire | 02 §13, 04 |
| D-02 | 09/10/2026 | Visibilité des électeurs | Le comité voit **uniquement des chiffres** (inscrits, votants, taux). Ni liste électorale nominative, ni liste d'émargement | Évite la pression sur les électeurs et limite l'exposition des données personnelles | 03 §9 |
| D-03 | 09/10/2026 | Taille du comité | **3 membres minimum** pour ouvrir le vote, contrôle bloquant | Une seule personne ne doit jamais contrôler une élection | 03 §9, 04 |
| D-04 | 09/10/2026 | Langues | **Arabe + français dès le MVP**, avec RTL et LTR | Évite une reprise coûteuse de l'interface plus tard | 07 Sprint 1 |
| D-05 | 09/10/2026 | Candidatures multiples | Un étudiant = **un seul poste par élection** | Évite qu'un même étudiant occupe plusieurs postes d'un même bureau | 02 §13 |
| D-06 | 09/10/2026 | Vote blanc / nul | Vote **blanc** autorisé (par poste, configurable). Pas de vote **nul** : l'interface empêche les bulletins invalides | Un vote électronique ne peut pas être « mal rempli » | 02 §6.3 |
| D-07 | 09/10/2026 | Conservation des documents | Attestations supprimées **12 mois** après la fin de l'année universitaire. Données OCR effacées dès la décision du vérificateur | Minimisation des données personnelles | 02 §10 |
| D-08 | 09/10/2026 | Étudiant sans groupe | Inscription acceptée sans groupe. L'étudiant ne vote pas aux élections de groupe | Certaines filières n'ont pas de groupes | 02 §13 |
| D-09 | 09/10/2026 | Observateurs | Pas de rôle OBSERVER au MVP | Peut s'ajouter sans changer le modèle | 03 §9 |
| D-10 | 09/10/2026 | 2FA | Obligatoire pour tous les rôles administratifs ; optionnelle pour les étudiants | Sécurité forte là où sont les pouvoirs, sans freiner l'inscription des étudiants | 03 §3 |
| D-11 | 09/10/2026 | Connexion « en tant que » | **Jamais** développée | Trop risqué pour une plateforme de vote | 03 §9 |
| D-12 | 09/10/2026 | Publication des résultats | Résultats publiés **par poste uniquement**, jamais ventilés par groupe, niveau ou filière | Protège le secret du vote dans les petits effectifs | 02 §6.6 |
| D-13 | 09/10/2026 | Protection du vote au MVP | Séparation identité / urne en base + transaction unique. Protocole cryptographique reporté après le MVP | Bon niveau de protection, complexité raisonnable ; limite documentée | 02 §6.5 |
| D-14 | 09/10/2026 | OCR | **Pas d'OCR au MVP**, vérification manuelle. POC comparatif en Phase 3 | Ne pas bloquer le MVP sur un composant incertain | 01 §2 |
| D-15 | 09/10/2026 | Jeton de configuration 2FA | Un compte administratif **sans 2FA active** reçoit à la connexion un jeton de configuration, au lieu d'un jeton d'accès. Ce jeton permet **uniquement** d'activer la 2FA (rien d'autre), dure **10 minutes**, est à **usage unique**. Sa création et son utilisation sont écrites dans `audit_logs`. Implémentation au Sprint 2 | Rend la 2FA obligatoire (D-10) sans compte administrateur bloqué ni accès partiel à l'application | 03 §3, 07 Sprint 2 |
| D-16 | 09/10/2026 | Bibliothèque UI (décision A-03) | **Bootstrap 5.3**, avec sa feuille RTL officielle pour l'arabe | Fournit le RTL nativement ; le plus simple pour un développeur seul | 01 §2, 07 Sprint 1 |

---

## Décisions en attente

| Réf. | Sujet | À décider avant |
|---|---|---|
| A-01 | Institution pilote et ses règlements électoraux | Sprint 4 |
| A-02 | Hébergement de production (VPS, cloud, serveur de l'université) | Sprint 6 |
| ~~A-03~~ | ~~Bibliothèque UI : Bootstrap ou Angular Material~~ — **Décidée le 09/10/2026 : Bootstrap 5.3 (voir D-16)** | ~~Sprint 1~~ |
