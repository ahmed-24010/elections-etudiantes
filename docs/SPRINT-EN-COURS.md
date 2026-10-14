# Sprint en cours — Sprint 4 (Élections, éligibilité, candidatures), SANS le vote

Branche : `feat/sprint-4-elections`. **Ne rien fusionner.** Mis à jour à chaque étape : une nouvelle session reprend ici.
`docs/04-ELECTION-VOTING-FLOW.md` n'est **pas** à rédiger : il sera fourni.

## Décisions déjà prises (hors `docs/00-DECISIONS.md`)

- Une élection est visible par l'étudiant à partir de `CANDIDACY_OPEN`.
- Zéro règle d'éligibilité = **personne** n'est éligible ; « toute l'institution » est un choix explicite (règle vide créée volontairement).
- **3 membres du comité** exigés dès `CANDIDACY_OPEN`.
- Règles génériques ; institution pilote = FSJP.
- États du sprint : `DRAFT → CANDIDACY_OPEN → CANDIDACY_CLOSED`, plus `CANCELLED` (IA 🔐). **Jamais** `VOTING_OPEN`.
- Comité = `RoleAssignment ELECTION_COMMITTEE` (institution + élection).

## Plan et avancement

| # | Étape | État |
|---|---|---|
| 0 | Créer ce fichier | fait |
| 1 | Références de D-24 / D-25 : « 02 §13 » → « 02 §4.2 » | fait |
| 2 | D-24 / D-25 : schéma + migration (niveaux autorisés par filière) | à faire |
| 2 | Écran admin des niveaux autorisés par filière | à faire |
| 2 | Grille des groupes sans case DP/DPU en L1-L2 | à faire |
| 2 | Contrôle serveur à l'inscription | à faire |
| 2 | Seed : tronc commun « Droit » L1-L2, groupes 1/2/3, élection de démo | à faire |
| 2 | Textes ar/fr, tests verts, commit séparé | à faire |
| 3a | `eligibility` : requête 02 §5 + 5 exemples + cas limites | à faire |
| 3b | `elections` : brouillon, postes, règles, calendrier, états, comité, `GET /elections/mine`, `GET /elections/:id/eligible-count` | à faire |
| 3c | `candidates` : dépôt (photo, programme S3), retrait, validation/rejet 🔐, unicité, comité ≠ candidat | à faire |
| 3d | Point d'étape backend : lint, tests, build, résumé | à faire |
| 3e | Frontend : section « Élections » du menu latéral | à faire |

## Décisions prises en cours de route (à reporter dans `docs/` si elles tiennent)

_(aucune pour l'instant)_

## Reste à faire / notes de reprise

_(voir le tableau)_
