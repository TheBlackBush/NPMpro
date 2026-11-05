## Utilisateurs

Les personnes qui peuvent se connecter à ce NPMpro. Seuls les administrateurs voient cette liste. Les personnes peuvent aussi se connecter avec un fournisseur OIDC, à configurer sous Paramètres, Authentification.

La liste affiche le nom, l'e-mail, les rôles et l'état de chaque utilisateur. Recherchez par nom ou par e-mail, et triez selon une colonne.

### Ajouter ou modifier un utilisateur

**Ajouter Utilisateur** demande le **Nom complet** et l'**Adresse e-mail**. Modifier ouvre la même fenêtre, où vous pouvez aussi téléverser ou retirer l'avatar de l'utilisateur. Sous **Options** :

- **Administrateur** : accès complet, y compris aux Paramètres, aux Utilisateurs et aux Journaux d'audit. Sans cette option, l'utilisateur est un Utilisateur standard, limité par les autorisations ci-dessous.
- **Désactivé** : l'utilisateur ne peut plus se connecter, et ses sessions ouvertes prennent fin.

Vous ne pouvez ni modifier vos propres rôles, ni vous désactiver ou vous supprimer, et votre propre ligne ne propose que Modifier.

### Menu de la ligne

Pour les autres comptes :

- **Autorisations** : voir ci-dessous.
- **Définir le mot de passe** : définit un nouveau mot de passe. Tous les autres appareils de cet utilisateur sont déconnectés.
- **Réinitialiser la MFA** : uniquement pour les utilisateurs qui ont la MFA. Elle la désactive sans code de récupération, et l'utilisateur peut la configurer de nouveau.
- **Révoquer les sessions** : déconnecte l'utilisateur sur tous ses appareils.
- **Désactiver** ou **Activer** : identique à l'option **Désactivé**.
- **Supprimer** : supprime le compte. Ses entrées dans les Journaux d'audit restent.

### Autorisations

Pour un Utilisateur standard, choisissez pour chaque section (Hôtes proxy, Hôtes de redirection, Hôtes 404, Streams, Listes d'accès, Certificats) : **Gérer**, **Voir uniquement** ou **Masquer**. **Éléments visibles** détermine si l'utilisateur voit **Tous les éléments** ou **Éléments créés uniquement**.

Un choix active aussi ce dont la section a besoin : les Hôtes proxy ont besoin des Listes d'accès et des Certificats, et Masquer est indisponible tant qu'une autre section a besoin de celle-ci. Les administrateurs ont accès à tout, seule la visibilité des éléments leur est donc proposée.

Plus dans le wiki : Usage (Users and permissions) et Authentication.
