## Qu'est-ce qu'une liste d'accès ?

Une liste d'accès protège des hôtes proxy. Elle peut demander aux visiteurs un nom d'utilisateur et un mot de passe (authentification Basic), autoriser ou refuser des visiteurs selon leur adresse IP, ou les deux. Elle sert pour les services sans connexion propre, ou quand vous voulez tenir à l'écart les clients inconnus.

Une même liste peut être utilisée par plusieurs hôtes proxy et emplacements.

### Détails

- **Nom** : obligatoire.
- **Satisfaire au moins une condition** (désactivé par défaut) : un visiteur entre dès qu'il satisfait une seule vérification, une règle ou un utilisateur valide. Désactivé signifie qu'il doit réussir les deux. Cela ignore aussi une Auth Request sur cet hôte.
- **Transmettre l'authentification au serveur en amont** (désactivé par défaut) : transmet l'en-tête `Authorization` du visiteur au service. Désactivé garde la connexion privée à NPMpro.

### Autorisations

Ajoutez des noms d'utilisateur et des mots de passe. Les noms d'utilisateur doivent être uniques dans la liste et ne peuvent pas contenir `:`. Quand vous modifiez une liste, laissez vide un mot de passe enregistré pour le conserver.

### Règles

Les règles autorisent ou refusent une adresse IP, une plage CIDR (`192.168.1.0/24`, `2001:db8::/32`) ou `unix:`. Elles sont appliquées dans l'ordre de la liste, et la première correspondance l'emporte. Placez d'abord les règles précises. Une règle finale `all` ferme la liste, en autorisation ou en refus ; elle n'est ajoutée que s'il y a au moins une autre règle. Une liste a besoin d'au moins un utilisateur ou une règle.

### Utilisation sur les hôtes proxy

Sur un hôte proxy, choisissez la liste sous **Listes d'accès globales** dans l'onglet Détails : **Accessible au public** (aucune liste) ou **Personnalisée**. Un emplacement personnalisé peut utiliser **Globale** (les listes de l'hôte), **Accessible au public** ou ses propres listes **Personnalisée**.

Vous pouvez associer plusieurs listes à un hôte ou à un emplacement. Elles sont vérifiées de haut en bas, dans l'ordre affiché, et vous pouvez les monter et les descendre. **Satisfaire au moins une condition** et **Transmettre l'authentification au serveur en amont** ne comptent que pour la première liste. Avec CrowdSec, les IP bannies voient la page de bannissement avant la demande de mot de passe.

Plus dans le wiki : Host options.

### Page de refus

**Refusé** (401, 403) est ce que voit un visiteur quand la liste le refuse (pas sur les hôtes avec authentification déléguée) : **Réglage global** (la page de Paramètres, Pages d'accueil), la **Page « Accès refusé »**, une **Page personnalisée** pour cette liste seulement (collez ou téléversez un fichier HTML), ou **La page simple de nginx**, qui garde celle de nginx.

### Pays

Autorisez ou bloquez les visiteurs selon leur pays. **Règles de pays** vaut **Désactivé**, **Autoriser uniquement ces pays** ou **Bloquer ces pays** ; ajoutez des pays avec **Ajouter un pays** (recherche par nom du pays dans la langue de l'interface ou par code à deux lettres) et donnez à chacun un commentaire facultatif. Une liste en mode autorisation ou blocage a besoin d'au moins un pays.

- **Bloquer les visiteurs dont le pays est inconnu** concerne les adresses publiques pour lesquelles la base GeoIP n'a pas de pays. Le mode autorisation les bloque par défaut, le mode blocage les laisse passer.
- **Fermer la connexion sans réponse (444)** ne s'applique qu'aux visiteurs bloqués par pays. Les refus par IP et mot de passe gardent la page de refus.
- Les adresses privées et locales passent toujours. Les pays sont vérifiés avant les règles d'IP et de mot de passe, y compris avec **Satisfaire au moins une condition**.
- Les règles de pays nécessitent une base de données de pays GeoIP (Paramètres, GeoIP). Sans elle, ou tant que nginx refuse la ligne de la base, tous les visiteurs passent : les pays enregistrés sont conservés, mais une liste ne peut pas recevoir de nouveau mode ni de nouveaux pays tant qu'aucune base n'est disponible.
