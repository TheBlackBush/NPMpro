## Notifications

NPMpro envoie les messages par un serveur SMTP de votre choix. La messagerie sert pour l'instant au message de test, puis à la réinitialisation du mot de passe et aux alertes. Les réglages ici peuvent aussi venir de variables du conteneur : une variable définie sur le conteneur l'emporte sur l'interface et verrouille son champ (le champ affiche « Défini par l'environnement »). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur.

### Serveur de messagerie

Chaque connexion est vérifiée comme les autres requêtes sortantes : le nom du serveur doit se résoudre, et les adresses locales et link-local sont refusées. La messagerie est considérée comme configurée quand l'hôte et l'adresse de l'expéditeur sont renseignés.

- **Hôte** et **Port** : le serveur SMTP. Variables : `SMTP_HOST`, `SMTP_PORT` (587 par défaut).
- **Sécurité** : **STARTTLS** fait passer une connexion en clair au chiffrement (généralement le port 587), **TLS** est chiffré dès le début (généralement le port 465), **Aucune** envoie sans chiffrement. Variable : `SMTP_SECURITY` (`starttls`, `tls` ou `none`).
- **Vérifier le certificat** : refuse un serveur dont le certificat n'est pas valide. Variable : `SMTP_VERIFY_TLS` (`false` le désactive).
- **Utilisateur** et **Mot de passe** : la connexion. Le mot de passe est enregistré chiffré et jamais affiché de nouveau ; **Supprimer** l'efface, et si celui enregistré ne peut pas être déchiffré, saisissez-le à nouveau. Variables : `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Nom de l'expéditeur** et **Adresse de l'expéditeur** : comment les messages de NPMpro apparaissent. Variables : `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Répondre à** : où vont les réponses ; vide, l'adresse de l'expéditeur est utilisée. Variable : `SMTP_REPLY_TO`.

Avec la sécurité **Aucune** et un utilisateur, le mot de passe circulerait en clair ; ce n'est donc autorisé que pour un serveur de votre réseau local.

**Envoyer un message de test** envoie un message avec les réglages enregistrés à l'adresse saisie (la vôtre par défaut) et affiche la réponse du serveur en cas d'échec. Enregistrez d'abord : le bouton est désactivé tant que le formulaire a des modifications non enregistrées, et masqué tant que la messagerie n'est pas configurée.

### Alertes par e-mail

Affichées une fois un serveur de messagerie configuré. Des e-mails sur les problèmes détectés par NPMpro et sur leur résolution ; un problème qui reste ouvert est rappelé.

- **Envoyer aux administrateurs** : chaque administrateur activé ayant une adresse valide reçoit les alertes.
- **Envoyer aussi à** : d'autres adresses, 20 au maximum, par exemple une liste d'équipe. Une adresse refusée est marquée sur sa pastille. Variable : `ALERT_ADDRESSES` (séparées par des virgules).
- **Événements** : cochez les problèmes pour lesquels vous voulez un e-mail, groupés par domaine. Cocher un événement couvre aussi sa résolution.
- **Rappeler toutes les (heures)** : le temps pendant lequel un problème reste silencieux avant d'être envoyé de nouveau ; 0 ne le répète jamais, 168 au maximum.

**Envoyer un exemple** envoie aussitôt une alerte d'exemple, avec les paramètres enregistrés, à tous ceux qui recevraient les alertes. Enregistrez d'abord : le bouton est désactivé tant que le formulaire a des modifications non enregistrées. Si un envoi échoue, le message indique l'adresse.

### Liens et langue

- **URL publique** : l'adresse à laquelle les personnes ouvrent NPMpro, utilisée pour les liens des messages, par exemple `https://npm.example.com`. HTTPS uniquement, sans chemin. **Utiliser l'adresse de ce navigateur** la remplit avec l'adresse de cette page lorsqu'elle est ouverte en HTTPS. Variable : `PUBLIC_URL`.
- **Langue des messages par défaut** : la langue des messages pour les personnes qui n'en ont pas choisi. La langue d'interface de chaque utilisateur est mémorisée et utilisée pour ses messages. Variable : `MAIL_LANGUAGE`.

Plus d'informations dans le wiki : Configuration.
