## Authentification

Connexion à l'interface web de NPMpro avec un fournisseur OIDC (par exemple Authentik, Keycloak ou Google), en plus des mots de passe ou à leur place. Ce n'est pas de l'authentification déléguée : cela ne protège pas vos hôtes proxy. Pour cela, voir Paramètres, Authentification déléguée.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche « Défini par l'environnement »). Si les quatre variables de connexion sont toutes définies, OIDC est actif sans être activé dans l'interface. Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur. Tout ce qui se trouve ici s'applique à l'enregistrement.

### Fournisseur

- **Activer la connexion OIDC** : affiche le bouton de connexion sur la page de connexion.
- **URL de l'émetteur** : l'adresse de base de découverte du fournisseur, par exemple `https://accounts.example.com`. Variable : `OIDC_ISSUER_URL`.
- **ID client** et **Secret client** : fournis par votre fournisseur. Le secret est stocké chiffré et n'est plus jamais affiché ; laissez-le vide pour le conserver. Si vous changez l'URL de l'émetteur ou l'ID client, saisissez de nouveau le secret. Variables : `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Domaine de redirection** : le domaine que les gens utilisent pour ouvrir NPMpro, avec le port s'il n'est pas 443. Obligatoire, car il sert à construire l'URL de rappel. Variable : `OIDC_REDIRECT_DOMAIN`.
- **URL de rappel** : en lecture seule. Enregistrez-la comme URI de redirection chez votre fournisseur.
- **Scopes** : par défaut `openid email profile`. Modifiez-les si votre fournisseur n'en accepte que certains, par exemple `openid email`.
- **Tester la connexion** : vérifie que NPMpro peut joindre l'émetteur.

### Bouton de connexion

Le bouton de la page de connexion : **Nom affiché** (le texte après « Se connecter avec »), **Couleur** (un préréglage ou votre propre `#rrggbb`) et **Icône** (intégrée, téléversée en PNG, JPEG, WebP ou SVG jusqu'à 256 Ko, ou téléchargée depuis une URL). Un aperçu est affiché.

### Règles de connexion

- **Exiger une adresse e-mail vérifiée** : refuse les utilisateurs dont le fournisseur n'a pas vérifié l'adresse e-mail. Par défaut : activé. Variable : `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Ignorer la double authentification après OIDC** : fait confiance au contrôle multifacteur du fournisseur. Par défaut : désactivé. Variable : `OIDC_SKIP_MFA`.
- **Désactiver la connexion par mot de passe** : seul OIDC peut se connecter. Vous ne pouvez l'activer que depuis une session connectée avec OIDC. Variable : `OIDC_DISABLE_PASSWORD` ; pour rétablir la connexion par mot de passe, mettez-la à `false` et recréez le conteneur.

### Nouveaux utilisateurs

- **Créer les utilisateurs à leur première connexion** (par défaut : désactivé) : une personne sans compte en reçoit un avec les autorisations ci-dessous.
- **Domaines e-mail autorisés** : séparés par des virgules ; vide autorise tous les domaines. Avec une liste vide et sans adresse e-mail vérifiée exigée, toute personne acceptée par votre fournisseur obtient un compte.
- **Autorisations par défaut des nouveaux utilisateurs** : définies par section. Les nouveaux utilisateurs ne sont jamais administrateurs.

Plus dans le wiki : Authentication.
