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
