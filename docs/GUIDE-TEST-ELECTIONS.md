# Guide de test — les élections (Sprint 4), pas à pas

Ce guide te fait tester sur ton PC, avec Docker, tout ce que fait le Sprint 4 : préparer une élection, ouvrir les candidatures, déposer et valider des candidatures, fermer, annuler.
**Le vote n'existe pas encore** (Sprint 5) : on ne teste pas le vote.

Durée : environ 45 minutes la première fois (la partie « comptes » est la plus longue).

---

## 0. Ce qu'il te faut

- **Docker Desktop** allumé (la baleine en bas à droite doit être « running »).
- **Node.js** installé (pour créer les données de départ et calculer les codes 2FA).
- Un navigateur. Astuce : ouvre **deux profils** ou une fenêtre de navigation privée pour être connecté avec deux comptes en même temps.
- Un fichier **PDF** (n'importe lequel, 1 Mo maximum, pas protégé) pour l'attestation, et une **photo JPEG ou PNG** pour la candidature.
- Un bloc-notes : on va noter des mots de passe et des clés 2FA.

> Un « code 2FA » est le nombre à 6 chiffres qui change toutes les 30 secondes. Les comptes d'administration en ont besoin (règle D-10). On le calcule avec une commande (§3), pas besoin de téléphone.

---

## 1. Préparer les réglages (une seule fois)

Dans le dossier du projet, le fichier `.env` doit exister. Vérifie qu'il contient bien ces lignes **avec une valeur** (au moins 10 caractères pour les mots de passe de démonstration) :

```text
SEED_ADMIN_PASSWORD=...
SEED_OFFICER_PASSWORD=...
SEED_INSTITUTION_ADMIN_PASSWORD=...
```

S'il n'existe pas : `cp .env.example .env`, puis remplis les valeurs « change-me » et les clés (les commandes pour les générer sont écrites en commentaire dans `.env.example`).

Note les e-mails des comptes de démonstration (par défaut) :

| Rôle | E-mail |
|---|---|
| Administrateur d'institution (IA) | `admin-institution@example.test` |
| Vérificateur | `verificateur@example.test` |

---

## 2. Démarrer tout, avec une base vide

Dans un terminal, à la racine du projet :

```bash
docker compose down -v
docker compose up -d --build
```

> `down -v` **efface** la base de développement. C'est voulu : on repart propre (nouvelles migrations, groupes A/B). Ne le fais pas si tu veux garder des données.

Attends 1 à 2 minutes, puis ouvre <http://localhost:4200>. Dans l’espace SUPER_ADMIN (ou sur `/api/v1/health`), l'API et la base doivent être « OK ».

Si ça ne démarre pas : `docker compose logs backend` (voir §12).

### Créer les données de départ (FSJP, comptes, élection de démo)

```bash
cd backend
npm ci
npx prisma generate
npm run seed
cd ..
```

Résultat attendu : le programme affiche ce qu'il a créé, sans erreur. Il a créé :
la Faculté (FSJP), les niveaux L1 à M2, les filières **Droit** (L1-L2), **Droit privé** et **Droit public** (L3, M1, M2), les groupes **A** et **B**, l'année 2026-2027, un administrateur d'institution, un vérificateur, et une élection **brouillon** « Bureau du groupe A — L3 Droit public ».

---

## 3. Le calcul des codes 2FA

Chaque compte d'administration a une **clé secrète** (affichée une fois, à la première connexion). Pour obtenir le code du moment, depuis le dossier `backend` :

```bash
cd backend
node -e "console.log(require('otplib').authenticator.generate('COLLE_LA_CLE_ICI'))"
```

Le code est valable environ 30 secondes. L'heure de ton PC doit être juste.

Tu peux aussi scanner le QR code avec une application (Google Authenticator, Authy…) si tu préfères.

---

## 4. Connexion de l'administrateur d'institution (IA)

1. Va sur <http://localhost:4200>, puis **Connexion**.
2. E-mail `admin-institution@example.test`, mot de passe = `SEED_INSTITUTION_ADMIN_PASSWORD`.
3. L'écran **d'activation de la 2FA** apparaît. Copie la **clé** affichée (note-la : `CLE_IA`), calcule le code (§3), saisis-le.
4. Tu arrives dans l'espace d'administration. Dans le menu à gauche, tu vois **Structure académique** et **Élections**.

À vérifier tout de suite (nouveauté D-24) : **Structure académique → Filières** : la colonne « Niveaux » montre `L1 · L2` pour *Droit* et `L3 · M1 · M2` pour *Droit privé* et *Droit public*. **Groupes** : il n'y a pas de case pour Droit privé / Droit public en L1-L2.

---

## 5. Créer les étudiants (3 étudiants + 3 membres du comité)

Pour chaque compte ci-dessous : **Créer mon compte** (page d'inscription), institution **FSJP**, un e-mail et un mot de passe (≥ 10 caractères). Note-les.

| Compte | E-mail suggéré | Rôle dans le test |
|---|---|---|
| Aïcha | `aicha@example.test` | étudiante éligible, **candidate** |
| Omar | `omar@example.test` | étudiant éligible, **spectateur** (voit les candidats) |
| Sara | `sara@example.test` | étudiante **non éligible** (autre filière) |
| Membre 1, 2, 3 | `comite1@example.test`, `comite2@…`, `comite3@…` | **comité** |

### 5.1 Inscription de chaque étudiant (Aïcha, Omar, Sara)

Connecté en tant qu'étudiant :

1. Remplis le formulaire : numéro étudiant (ex. `C1001`, `C1002`, `C1003`), prénom, nom.
2. **Faculté** : FSJP. **Niveau** : Licence 3. Puis **Filière** (la liste dépend du niveau : tu ne vois que *Droit privé* et *Droit public*, pas *Droit* → c'est D-24).
   - Aïcha et Omar : **Droit public**, **groupe A**.
   - Sara : **Droit privé**, **groupe A**.
3. Enregistre, puis **dépose l'attestation** (ton PDF).
4. Statut attendu : « En cours d'examen ».

Teste au passage D-24 : choisis **Licence 1** → *Droit privé* et *Droit public* disparaissent de la liste, seul *Droit* reste.

### 5.2 Vérification par le vérificateur

1. Connexion `verificateur@example.test` (mot de passe `SEED_OFFICER_PASSWORD`), activation de la 2FA (note `CLE_VERIF`).
2. Menu **Vérification → Inscriptions** : les 3 inscriptions sont dans la file.
3. Ouvre chacune : tu vois la section **« Points à contrôler »** (avec l'aide « المجموعة الأولى = A ، المجموعة الثانية = B »). Clique **Afficher l'attestation**, puis **Valider l'inscription** (le site demande un code 2FA : calcule-le).
4. Les trois étudiants passent à **« Compte vérifié »**.

---

## 6. Préparer l'élection (administrateur d'institution)

Reconnecte-toi en **IA**. Menu **Élections**.

1. Tu vois « Bureau du groupe A — L3 Droit public », état **Brouillon**. Clique **Ouvrir**, puis **Modifier le brouillon**.
2. **Étape 1 – Informations** : mets des dates qui encadrent **aujourd'hui**. Format texte : `AAAA-MM-JJ HH:mm`.
   - Début des candidatures : **hier** (ou aujourd'hui 00:00) · Fin des candidatures : dans 7 jours
   - Début du vote : dans 14 jours · Fin du vote : dans 15 jours
   (Les dates doivent se suivre, sinon le site refuse.) Clique **Enregistrer et continuer**.
3. **Étape 2 – Postes** : Président, Vice-président, Secrétaire sont déjà là. Tu peux en ajouter ou en supprimer un.
4. **Étape 3 – Électeurs** : une règle existe déjà : *Droit public · Licence 3 · groupe A*. Teste :
   - tu peux changer les listes déroulantes ; une règle **sans aucun critère** est refusée ;
   - la case **« Toute l'institution »** est un choix explicite.
   Remets la règle de départ, **Enregistrer et continuer**.
5. **Étape 4 – Comité** : on y revient au §7. Pour l'instant clique **Continuer**.
6. **Récapitulatif** : coches vertes/rouges, et « *2 étudiant(s) éligible(s)* » (Aïcha et Omar). **Sara n'est pas comptée.** Clique **Terminer**.

---

## 7. Le comité de 3 membres

Les 3 membres doivent déjà avoir un compte (§5). Dans la page de l'élection (IA) :

1. **Teste d'abord le refus.** Clique **Ouvrir les candidatures** : le site **refuse** et affiche **la liste de ce qui manque** (ici : *comité d'au moins 3 membres*). Si tu as laissé une condition manquante (dates, poste, règle), elle apparaît aussi dans la liste.
2. Ajoute les membres : **Modifier le brouillon**, clique **Enregistrer et continuer** (étape 1), **Continuer** (postes), **Enregistrer et continuer** (électeurs) pour arriver à l'étape **Comité**, puis saisis l'e-mail `comite1@example.test` → **Ajouter au comité**. Le site peut demander **un code 2FA de l'IA** (calcule avec `CLE_IA`) si ta dernière vérification date de plus de 10 minutes.
   Répète pour `comite2@…` et `comite3@…`. Le compteur passe à **3 / 3 membres**.
3. Plus tard (§9.3), tu essaieras d'ajouter **Aïcha** au comité pour voir le conflit d'intérêts.

Chaque membre du comité doit activer sa propre 2FA **à sa première connexion** (même écran que pour l'IA) : connecte-toi une fois avec chacun des 3 comptes `comite…`, note les clés (`CLE_C1`, `CLE_C2`, `CLE_C3`), puis reviens.

---

## 8. Ouvrir les candidatures

1. IA → page de l'élection → **Ouvrir les candidatures**.
2. Attendu : l'état devient **Candidatures ouvertes** (badge vert), et le bouton **Candidatures** apparaît.
3. **Verrouillage** : le bouton **Modifier le brouillon** a disparu (l'élection n'est plus un brouillon) : titre, postes et règles sont figés.

---

## 9. Côté étudiants

### 9.1 Qui voit quoi
- Connecte **Aïcha** : sur son accueil, la carte **« Mes élections »** → **Voir mes élections** → l'élection est là.
- Connecte **Omar** : il la voit aussi.
- Connecte **Sara** : **aucune élection** (« Aucune élection ne vous concerne »). C'est le test « chaque étudiant voit exactement les élections qui le concernent ».

### 9.2 Déposer une candidature (Aïcha)
1. Ouvre l'élection → **Ma candidature** : choisis le poste **Président**, écris un programme, **Déposer ma candidature**.
2. Attendu : badge **En attente**.
3. Dépose une **photo** (JPEG/PNG) et un **programme** (PDF).
   Essaie un PDF comme photo → refusé (« type de fichier non accepté »).
4. Le formulaire de dépôt a disparu : tant que sa candidature existe, Aïcha ne peut pas en déposer une seconde (**un seul poste par élection**). Elle peut seulement changer le poste de la première, tant qu'elle n'est pas validée.

### 9.3 Conflit d'intérêts (IA)
IA → étape Comité → essaie d'ajouter `aicha@example.test` : **refusé** (« candidate à cette élection : elle ne peut pas siéger au comité »). (L'autre sens — un membre du comité qui candidate — est couvert par les tests automatiques : dans ce guide, les membres du comité n'ont pas d'inscription vérifiée, donc l'élection ne leur est pas visible comme étudiants.)

---

## 10. Validation par le comité

1. Connecte `comite1@example.test` (code 2FA). Menu **Élections** → l'élection → **Candidatures**.
2. Tu vois la candidature d'Aïcha avec sa photo et son programme (boutons **Voir…**). **Aucun numéro étudiant** n'est affiché (voulu).
3. Clique **Rejeter…** : le **motif est obligatoire**. Écris « Programme trop court » → le site demande le code 2FA → **Rejeté**.
4. Reconnecte **Aïcha** : elle voit le badge **Rejetée** et le motif. Elle **corrige** son programme (texte, fichier), puis clique **Redéposer ma candidature** → **En attente**.
5. `comite1` (ou `comite2`) : **Valider** → code 2FA → **Validée**.
6. Connecte **Omar** : dans l'élection, la section **Candidats** montre Aïcha, avec **Voir la photo** et **Voir le programme**. Sara ne peut rien ouvrir.

Essais en plus :
- L'IA voit toutes les candidatures mais n'a **pas** les boutons Valider/Rejeter.
- Un membre du comité ne peut pas décider de sa propre candidature.

---

## 11. Retrait, fermeture, annulation

1. **Retrait** : Omar dépose une candidature (Vice-président), puis **Retirer ma candidature** → **Retirée** ; il peut la déposer de nouveau tant que c'est ouvert.
2. **Fermer les candidatures** : IA ou comité → **Fermer les candidatures** → état **Candidatures fermées**.
   - Aïcha : plus de modification ; **plus de retrait** (règle 04 §10.5) ; plus de redépôt.
   - Le comité peut **encore valider/rejeter** les candidatures en attente.
3. **Annulation** : IA uniquement → **Annuler l'élection** → saisis un **motif** (obligatoire) → code 2FA. L'élection devient **Annulée** et **disparaît** pour les étudiants (Omar, Aïcha ne la voient plus). Le comité n'a pas ce bouton.

---

## 12. Si quelque chose ne marche pas

| Symptôme | Que faire |
|---|---|
| Le site ne répond pas | `docker compose ps` (tout doit être « running / healthy »), puis `docker compose logs backend` |
| « Code incorrect » à la 2FA | Recalcule le code (30 s) ; vérifie l'heure du PC ; vérifie la clé copiée |
| « Il manque… » à l'ouverture des candidatures | C'est normal : lis la liste, corrige (dates, postes, règle, 3 membres, au moins 1 éligible) |
| Un étudiant ne voit pas l'élection | Son inscription doit être **Compte vérifié**, dans **Droit public / L3 / groupe A** |
| « Nous ne sommes pas dans la période de candidature » | Corrige les dates (étape 1 du brouillon, ou via l'IA tant que c'est possible) pour encadrer l'heure actuelle |
| Tout recommencer | `docker compose down -v`, puis §2 |
| Regarder les erreurs de l'API | <http://localhost:4200/api/docs> (Swagger, développement seulement) |

---

## 13. Ce que tu NE dois PAS voir (c'est normal)

- Aucun bouton **Voter**, aucun résultat : le vote est au Sprint 5.
- La fermeture des candidatures **n'est pas automatique** à la date de fin : il faut cliquer (l'automatisme arrive avec la tâche planifiée du Sprint 5).
- Aucune liste de noms des électeurs, seulement un **nombre** d'éligibles.

---

## Rapport de test

Note pour chaque section : **OK** / **Problème** + une phrase + une capture. Envoie-moi la liste : je corrige.
