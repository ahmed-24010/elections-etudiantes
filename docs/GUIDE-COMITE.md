# Guide du comité électoral

Pour les membres du comité d'une élection. Tout se fait depuis un téléphone : **Administration → Élections → l'élection → Suivi du vote**.
Les actions marquées 🔐 demandent un code 2FA récent (moins de 10 minutes) et sont écrites dans le journal d'audit.

## Ce que vous voyez

Des **chiffres seulement** : inscrits, votants, taux de participation (D-02). Jamais la liste de ceux qui ont voté.
Si l'élection compte **moins de 50 électeurs**, le chiffre des votants n'est mis à jour que **toutes les 15 minutes** (l'écran indique l'heure des chiffres) : ce n'est pas une panne, c'est voulu, pour qu'on ne puisse pas deviner qui vient de voter (D-31).

## Ouvrir le vote 🔐

Le vote s'ouvre tout seul à l'heure prévue si les conditions sont réunies. Pour l'ouvrir à la main : *Ouvrir le vote maintenant*. Conditions : aucune candidature en attente, au moins un candidat validé par poste, trois membres du comité actifs. Si une condition manque, l'écran la liste.
À l'ouverture, la liste électorale est **figée** : un étudiant vérifié après ce moment ne peut pas voter, sauf ajout exceptionnel (ci-dessous).

## Clôturer le vote avant l'heure 🔐

*Clôturer le vote* demande un **motif**. L'arrêt est immédiat et définitif, le décompte démarre.

## Prolonger le vote après une panne 🔐

À utiliser si le service a été indisponible pendant le vote.

- **Une seule fois**, et **seulement pendant que le vote est ouvert.**
- **Prolongez AVANT l'heure de fin.** Une fois l'heure de fin passée, le vote est clôturé et dépouillé : il n'est plus possible de le prolonger ni de le rouvrir (D-40). N'attendez donc pas la dernière minute.
- Vous déclarez **le début et la fin de la panne** (heure locale, format `AAAA-MM-JJ HH:mm`), puis la **nouvelle heure de fin**.
- La prolongation ne peut dépasser **ni la durée de la panne déclarée, ni 24 heures**, et ne peut jamais raccourcir le vote.
- Un **motif** est obligatoire. La panne déclarée, l'ancienne et la nouvelle heure de fin sont conservées dans le journal d'audit et dans le procès-verbal.

## Ajouter un électeur oublié 🔐

Cas : un étudiant éligible a été oublié de la liste gelée (par exemple, sa vérification a été faite en retard par erreur). Possible seulement pendant le vote.

1. Saisissez le **matricule** de l'étudiant, puis *Vérifier*.
2. L'écran montre sa **faculté, filière, niveau et groupe** (pas son nom) : vérifiez que c'est bien l'électeur attendu.
3. Écrivez le **motif** et confirmez.

Son compte doit être actif et son inscription **vérifiée** ; il doit être éligible à cette élection. Si l'ajout est impossible, le message est toujours le même : il ne dit pas si le matricule existe, pour ne pas servir à fouiller la base. Vérifiez la saisie, ou demandez au vérificateur de contrôler l'inscription.
Les ajouts sont comptés et signalés dans le procès-verbal. On **ne retire jamais** un électeur de la liste (04 §5.3).
