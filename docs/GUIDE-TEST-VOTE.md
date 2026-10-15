# Guide de test — le vote de bout en bout (Sprint 5)

But : sur ton PC, avec Docker, faire voter Aïcha et Omar sur un téléphone simulé, clôturer, et lire les résultats.
Durée : environ 30 minutes. Tu as déjà fait le guide `GUIDE-TEST-ELECTIONS.md` : les mêmes outils servent ici.

---

## 0. Ce qu'il te faut

- Docker Desktop allumé, Node.js installé, un terminal à la racine du projet.
- Dans `.env` : `SEED_DEMO_PASSWORD` (≥ 10 caractères) et `SEED_DEMO_TOTP_SECRET` (clé base32, ex. `JBSWY3DPEHPK3PXP`) remplis, ainsi que `SEED_ADMIN_PASSWORD`, `SEED_OFFICER_PASSWORD`, `SEED_INSTITUTION_ADMIN_PASSWORD`.
- Une application ou une commande pour les codes 2FA (§2).

## 1. Démarrer avec une base vide et les données de démo

```bash
docker compose down -v
docker compose up -d --build
cd backend
npm ci
npx prisma generate
npm run seed
npm run seed:demo
cd ..
```

`seed:demo` affiche la liste des comptes. Tous ont le mot de passe `SEED_DEMO_PASSWORD`. Ceux qui nous servent :

| Compte | E-mail | Rôle |
|---|---|---|
| Aïcha | `aicha@…` | étudiante, Droit public L3 groupe A |
| Omar | `omar@…` | étudiant, Droit public L3 groupe A |
| Sara | `sara@…` | étudiante **non éligible** (Droit privé) |
| Comité 1 à 3 | `comite1@…`, `comite2@…`, `comite3@…` | comité de l'élection |

(Le domaine exact est écrit par `seed:demo`.) L'élection « Bureau du groupe A — L3 Droit public » est en `CANDIDACY_OPEN`, avec deux postes : **Président** et **Vice-président**.

## 2. Code 2FA du comité

Les comités ont la clé `SEED_DEMO_TOTP_SECRET`. Pour obtenir le code du moment :

```bash
cd backend
node -e "console.log(require('otplib').authenticator.generate('TA_CLE_ICI'))"
cd ..
```

Valable environ 30 secondes.

## 3. Deux candidatures (en simulant un téléphone)

Ouvre <http://localhost:4200> dans **Chrome**, puis `F12` → icône « mobile » (Ctrl+Maj+M) → appareil **iPhone 14**. Pour tester l'arabe/RTL, change la langue avec l'icône du globe.

1. Connecte-toi en **Aïcha** → *Mes élections* → ouvre l'élection → **Candidature** : poste **Président**, texte libre → *Déposer*.
2. Fenêtre de navigation privée : connecte-toi en **Omar**, candidature au poste **Vice-président**.
3. Dans une troisième session, connecte-toi en **comité 1** (code 2FA), ouvre l'élection → *Candidatures* → **valide** les deux candidatures (2FA récente demandée).

## 4. Avancer les dates (le vote s'ouvre à l'heure prévue)

L'ouverture exige que l'heure de la base soit ≥ `votingStartsAt`. On avance les dates avec une commande (base de dev) :

```bash
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" elections -e "UPDATE elections SET candidacyEndsAt = UTC_TIMESTAMP() - INTERVAL 5 MINUTE, votingStartsAt = UTC_TIMESTAMP() - INTERVAL 1 MINUTE, votingEndsAt = UTC_TIMESTAMP() + INTERVAL 2 HOUR WHERE title LIKE \"Bureau du groupe A%\";"'
```

Dans la minute qui suit, la **tâche planifiée** ferme les candidatures puis ouvre le vote toute seule (liste électorale gelée). Vérifie :

- en **comité 1** : le détail de l'élection passe à « Vote ouvert » ;
- sinon, l'ouverture manuelle existe aussi : `POST /api/v1/elections/<id>/voting/open` (2FA récente).

> Si le statut reste « Candidatures closes » : une condition manque (candidature encore en attente, poste sans candidat validé, moins de 3 membres de comité). Le comité reçoit alors une notification `VOTING_OPEN_BLOCKED` (pas encore affichée dans l'interface) ; regarde `docker compose logs backend`.

## 5. Le vote d'Aïcha (téléphone simulé)

1. Session Aïcha → *Mes élections* : bouton **Voter**.
2. Poste 1 (**Président**) : choisis un candidat **ou** *Vote blanc* ; l'ordre des candidats peut changer d'un électeur à l'autre. *Suivant* reste grisé tant que rien n'est choisi.
3. Poste 2 (**Vice-président**) : choisis, puis *Récapitulatif*.
4. Récapitulatif : *Modifier* ramène à un poste. *Continuer*.
5. Confirmation : le message « Votre vote est définitif ». Saisis un **mauvais** mot de passe → message d'erreur, rien n'est enregistré. Après 5 mauvais mots de passe en 15 minutes, le compte est bloqué (429), même avec le bon mot de passe.
6. Saisis le bon mot de passe → *Envoyer* → écran **« Votre vote a bien été enregistré »** avec l'heure, sans rappel des choix.
7. Retour à *Mes élections* : « Vous avez voté », plus de bouton *Voter*. L'accueil étudiant affiche la notification « Un vote a été enregistré pour vous… ».
8. Recharge la page du vote (`/student/elections/<id>/vote`) : « Votre vote a déjà été enregistré ».

Refais avec **Omar** (autre navigateur privé). **Sara** ne voit pas l'élection (non éligible).

## 6. Participation (chiffres seulement)

Avec le jeton du comité, la participation se lit sur `GET /api/v1/elections/<id>/turnout` (pas encore d'écran). Pour moins de 50 électeurs, le nombre de votants ne change que par tranches de 15 minutes : attends la prochaine tranche. Il n'y a **aucune liste de votants**.

Vérifie le secret directement dans la base :

```bash
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" elections -e "SELECT COUNT(*) AS votants FROM voting_participations; SELECT COUNT(*) AS bulletins FROM ballots; DESCRIBE ballots; DESCRIBE ballot_choices;"'
```

Les deux nombres doivent être égaux ; `ballots` n'a que `id` et `electionId` ; aucune colonne d'étudiant ni de date.

## 7. Clôture et résultats

Clôture anticipée par le comité (🔐, motif obligatoire) : `POST /api/v1/elections/<id>/voting/close` avec `{"reason":"test"}`. Ou attends `votingEndsAt` (la tâche planifiée ferme à la minute près). Le **décompte** est lancé tout de suite.

Lecture (avec le jeton du comité ; il n'y a pas encore d'écran de résultats) :

- `GET /api/v1/results/<id>` : voix par poste, élus, `integrityOk: true`. Avec 2 votants par poste, le détail est **masqué** (seuil de 3, D-32) : seuls les élus et la mention « effectif trop faible » apparaissent. C'est normal ici.
- Avant la clôture, la même route répond **409**, pour tous.
- Publication : `POST /api/v1/elections/<id>/results/publish` (2FA) ; ensuite les électeurs lisent `GET /api/v1/results/<id>`.

## 8. Les tests automatiques de ce sprint

```bash
cd backend && npm run lint && npm test && npm run test:e2e
# base de test séparée (voir CLAUDE.md pour la création d'elections_test) :
npm run test:db
cd ../frontend && npm run lint && npm test && npm run test:mobile
```

Si quelque chose bloque : `docker compose logs backend`.
