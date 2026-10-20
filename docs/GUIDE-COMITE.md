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

## Publier les résultats 🔐

Une fois le vote clôturé, ouvrez **Résultats et procès-verbal**. Vous y voyez les chiffres, le contrôle d'intégrité, les éventuelles **égalités** (un second tour est alors à organiser, avec les seuls ex-aequo) et, si l'effectif est trop faible, les postes dont le détail n'est pas publié.

- **Seul le comité publie** (*Publier les résultats*, avec confirmation et code 2FA). L'administrateur d'institution lit, télécharge le PV et peut le regénérer, mais ne publie pas.
- La publication est **refusée** si le nombre de votants ne correspond pas au nombre de bulletins, si l'urne a changé depuis le décompte, ou si la chaîne du journal d'audit est rompue. L'écran liste les causes : prévenez l'administrateur d'institution, ne cherchez pas à contourner.
- Elle est **définitive**.

## Le procès-verbal

À la publication, deux procès-verbaux sont créés ensemble, **un en arabe et un en français**, avec le même code de vérification. *Télécharger* donne la version de la langue de votre site ; l'autre langue est un bouton en dessous.

1. Imprimez le PV (une page).
2. Chaque membre du comité écrit son **nom** et **signe** dans sa case ; les **observations** éventuelles vont dans la case prévue.
3. Conservez l'original signé. (Le dépôt du scan signé dans la plateforme viendra plus tard.)

Si la génération a échoué (message sur l'écran), utilisez *Créer le procès-verbal*. *Regénérer* crée un nouveau rapport avec un nouveau code : l'ancien n'est pas effacé.

## Vérifier l'urne

*Vérifier l'urne* recalcule à l'instant l'empreinte de tous les bulletins et la compare à celle du décompte et à celle imprimée sur le PV. **Identique** : l'urne n'a pas changé. **Différente** : ne publiez pas, ou signalez-le tout de suite à l'administrateur d'institution. La vérification ne montre jamais un bulletin ni un choix.

## Égalité de voix : le second tour 🔐

Si deux candidats ou plus sont à égalité pour le dernier siège d'un poste, personne n'est déclaré élu pour ce siège. Une fois les résultats **publiés**, l'écran *Résultats* propose *Créer le second tour* (comité seulement).

1. Confirmez les **dates du vote** du second tour (proposées : le lendemain, de 8 h à 18 h ; vous pouvez les changer).
2. Le second tour est créé **en un clic** : seuls les **candidats à égalité**, sur les **seuls postes concernés**, avec le **même comité**, les **mêmes règles** et la **même liste électorale** que le premier tour (ajouts exceptionnels compris). Les photos et programmes sont repris.
3. Le vote s'ouvre à l'heure prévue, ou à la main (*Suivi du vote*). Ensuite tout se passe comme pour une élection : clôture, résultats, publication, procès-verbal (« Tour 2 »).

Il n'y a qu'**un second tour actif** par élection. Si l'égalité persiste, créez un troisième tour depuis le second. Les sièges déjà attribués au premier tour restent acquis.

## Marquer le PV signé 🔐

Quand l'exemplaire imprimé est signé par les membres du comité, ouvrez *Résultats et procès-verbal* et choisissez *Marquer le PV signé*. C'est ce qui retire le PV de la liste « PV à signer » du tableau de bord de l'administrateur d'institution. Un PV regénéré est un nouveau rapport : il est à faire signer de nouveau.
