# Guide de test — le vote de bout en bout (version courte)

But : faire voter Aïcha et Omar sur un téléphone simulé, clôturer, lire les résultats. Environ 20 minutes.
Les commandes `demo:*` sont **réservées au développement** (elles refusent de tourner si `NODE_ENV=production`).

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

`seed:demo` affiche les comptes (même mot de passe `SEED_DEMO_PASSWORD`) : `aicha@example.test`, `omar@example.test`, `mariam@example.test` et `yacoub@example.test` (quatre étudiants **éligibles**, même groupe), `sara@example.test` (non éligible) et `comite1@…` à `comite3@…`.
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

## 7. Scénario « égalité → second tour » (variante, environ 30 minutes)

À faire sur une base **neuve** (`docker compose down -v`, puis le §1). Il y a maintenant **quatre** électeurs éligibles : Aïcha, Omar, Mariam et Yacoub. Avec 3 votants ou plus, le détail des voix est publié (D-32).

1. **Candidatures.** Aïcha **et** Omar se portent candidats au poste **Président** (personne pour Vice-président ni Secrétaire : ces postes sont retirés à l'ouverture, D-34). **Comité 1** valide les deux.
2. **Ouvrir le vote** : `npm run demo:open-vote` (liste gelée : **4 électeurs**).
3. **Voter** (chacun avec son mot de passe, §4) : Aïcha → **Omar**, Omar → **Aïcha**, Mariam → **Aïcha**, Yacoub → **Omar**. Résultat : **2 voix contre 2**.
4. **Clôturer** : `npm run demo:close-vote`, puis `npm run demo:results`. Attendu : le détail des voix (4 votants) et la ligne « **ÉGALITÉ** pour le dernier siège : Aïcha, Omar (second tour) ».
5. **Publier** (comité 1, code 2FA) : l'élection → **Résultats et procès-verbal**. Attendu : intégrité réussie, bandeau « Égalité de voix — second tour ». *Publier les résultats* (confirmation + code). Le procès-verbal est créé en français et en arabe (si Chromium n'est pas disponible, un message l'indique : *Créer le procès-verbal* le relance).
6. **Créer le second tour** (comité 1) : bouton *Créer le second tour* → les dates sont proposées (demain, 8 h–18 h) → confirmer (code 2FA). Attendu : le message « Le second tour est créé » et le lien *Voir le second tour (tour 2)*. Le second tour a la pastille **Tour 2**, **un seul poste** (Président), **seulement Aïcha et Omar** comme candidats, et le même comité.
7. **Ouvrir le second tour** : `npm run demo:open-vote -- second` (avance les dates, comme au premier tour). Attendu : « Liste électorale gelée : **4 électeur(s)** » — la **même liste** qu'au premier tour. Mariam et Yacoub voient l'élection « Tour 2 » dans *Mes élections* ; Sara n'y voit rien.
8. **Voter au second tour** : Aïcha → Omar, Omar → Aïcha, Mariam → **Aïcha**, Yacoub → **Aïcha**. Un deuxième vote du même étudiant est refusé (« Votre vote a déjà été enregistré »).
9. **Clôturer et lire** : `npm run demo:close-vote -- second` puis `npm run demo:results -- second`. Attendu : **Aïcha élue** (3 voix contre 1), pas d'égalité, donc pas de troisième tour. Pour tester un **troisième tour**, votez 2-2 au §8 : l'écran *Résultats* du second tour propose alors *Créer le second tour* (tour 3).
10. **Publier** le second tour (comité 1) : le procès-verbal porte « Tour 2 ».
11. **Marquer le PV signé** : comité 1 → *Résultats et procès-verbal* → *Marquer le PV signé* (code 2FA), pour chacun des deux procès-verbaux.
12. **Tableau de bord** : connecte-toi avec le compte **administrateur d'institution** (`admin-institution@example.test`, mot de passe `SEED_INSTITUTION_ADMIN_PASSWORD`, code 2FA du comité). C'est son écran d'accueil : élections en cours, inscriptions à vérifier, **PV à signer** (ceux que le comité n'a pas encore marqués signés). Des chiffres seulement, jamais une liste de votants.

Les commandes `demo:open-vote`, `demo:close-vote` et `demo:results` visent le **premier tour** sans option, et le **second tour** avec `-- second`.

## 8. Tests automatiques

```bash
cd backend && npm run lint && npm test && npm run test:e2e && npm run test:db   # test:db : voir CLAUDE.md (base elections_test)
cd ../frontend && npm run lint && npm test && npm run test:mobile
```

En cas de souci : `docker compose logs backend`.
