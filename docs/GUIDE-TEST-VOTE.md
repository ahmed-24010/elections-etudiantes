# Guide de test — le vote de bout en bout (version courte)

But : faire voter Aïcha et Omar sur un téléphone simulé, clôturer, lire les résultats. Environ 20 minutes.
Les trois commandes `demo:*` sont **réservées au développement** (elles refusent de tourner si `NODE_ENV=production`).

## 0. Prérequis

Docker Desktop allumé, Node.js installé. Dans `.env` : `SEED_ADMIN_PASSWORD`, `SEED_OFFICER_PASSWORD`, `SEED_INSTITUTION_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` (≥ 10 caractères) et `SEED_DEMO_TOTP_SECRET` (ex. `JBSWY3DPEHPK3PXP`).

## 1. Démarrer et semer

```bash
docker compose down -v
docker compose up -d --build
cd backend
npm ci
npx prisma generate
npm run seed
npm run seed:demo
```

`seed:demo` affiche les comptes (même mot de passe `SEED_DEMO_PASSWORD`) : `aicha@example.test`, `omar@example.test`, `sara@example.test` (non éligible) et `comite1@…` à `comite3@…`.
Code 2FA du comité, si besoin : `node -e "console.log(require('otplib').authenticator.generate('TA_CLE'))"` (dans `backend`).

## 2. Deux candidatures validées

Ouvre <http://localhost:4200> dans Chrome, `F12` puis `Ctrl+Maj+M`, appareil **iPhone 14**. Le globe change la langue (arabe = droite à gauche).

1. **Aïcha** → *Mes élections* → l'élection → candidature au poste **Président** → *Déposer*.
2. **Omar** (fenêtre privée) → candidature au poste **Vice-président**.
3. **comité 1** (fenêtre privée, code 2FA) → l'élection → *Candidatures* → **valider** les deux.

## 3. Ouvrir le vote

```bash
npm run demo:open-vote
```

La commande avance les dates, ferme les candidatures, retire le poste *Secrétaire* (aucune candidature : le vote exige un candidat validé par poste, D-34) et ouvre le vote. Si une condition manque, elle l'écrit en clair (candidature en attente, moins de 3 membres de comité…).

## 4. Voter (téléphone simulé)

Pour Aïcha, puis pour Omar :

1. *Mes élections* → **Voter**. Un poste par écran ; l'ordre des candidats peut différer d'un électeur à l'autre ; **Suivant** reste grisé tant que rien n'est choisi.
2. Récapitulatif (*Modifier* ramène à un poste) → *Continuer*.
3. Confirmation : tape un **mauvais** mot de passe → erreur, rien n'est enregistré (5 échecs en 15 minutes bloquent le compte).
4. Bon mot de passe → **« Votre vote a bien été enregistré »** avec l'heure, sans rappel des choix.
5. *Mes élections* : « Vous avez voté ». Accueil étudiant : notification « Un vote a été enregistré pour vous… ». Recharger la page du vote : « Votre vote a déjà été enregistré ».

**Panne simulée :** ouvre la page du vote, puis dans `F12` → *Network* choisis **Offline** juste avant *Envoyer*. Attendu : « Votre vote n'a PAS été enregistré » (ou « n'a PAS pu être confirmé » si le serveur est injoignable), **jamais** l'écran de succès. Repasse en *No throttling* et réessaie : le vote part.

## 5. Clôturer et lire les résultats

```bash
npm run demo:close-vote
npm run demo:results
```

`demo:close-vote` ferme le vote et lance le décompte (votants = bulletins, intégrité OK). `demo:results` affiche inscrits, votants, participation, élus et empreinte de l'urne.
Avec **2 votants** par poste, le détail des voix est **masqué** : seuls les élus s'affichent (seuil de 3, D-32). C'est normal. Avant la clôture, `demo:results` répond qu'il n'y a pas de décompte.

## 6. Vérifier le secret (facultatif)

```bash
cd ..
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" elections -e "SELECT COUNT(*) votants FROM voting_participations; SELECT COUNT(*) bulletins FROM ballots; DESCRIBE ballots;"'
```

Votants = bulletins ; `ballots` n'a que `id` et `electionId` (aucun étudiant, aucune date).

## 7. Tests automatiques

```bash
cd backend && npm run lint && npm test && npm run test:e2e && npm run test:db   # test:db : voir CLAUDE.md (base elections_test)
cd ../frontend && npm run lint && npm test && npm run test:mobile
```

En cas de souci : `docker compose logs backend`.
