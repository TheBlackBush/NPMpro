## Authentification déléguée

L'authentification déléguée place une connexion ou un contrôle anti-robots devant un hôte proxy. Pour chaque requête, nginx demande d'abord à un service d'authentification si le visiteur peut passer. NPMpro l'intègre pour Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia et Authentik. Vous faites tourner le fournisseur dans son propre conteneur.

Cette page définit l'adresse par défaut (upstream) de chaque fournisseur. Un hôte proxy active le contrôle avec **Auth Request** sous Options dans son onglet Détails (ou sur un emplacement personnalisé).

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche un badge cadenas comme « Défini par AUTH_REQUEST_AUTHELIA_UPSTREAM »). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur. Chaque paramètre ici s'applique après le rechargement de nginx que lance l'enregistrement. Si le test nginx échoue, rien n'est enregistré.

### Upstreams par défaut

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik** : utilisés par les hôtes proxy qui ont ce fournisseur et pas d'upstream propre. La valeur propre à un hôte l'emporte. Par défaut : vide (aucun). Variables : `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Format : `scheme://host:port`, par exemple `http://127.0.0.1:9091`, ou `scheme://cu_name` pour votre propre bloc upstream nginx dont le nom commence par `cu_`. Utilisez `http` ou `https` ; le port est obligatoire ; une adresse IPv6 se met entre crochets. Pas de chemin, pas d'espaces et aucun des caractères `; { } # " ' $ \`.

Vous ne pouvez pas vider une valeur par défaut tant que des hôtes proxy utilisent ce fournisseur sans upstream propre. Le message liste ces hôtes.

Un hôte qui utilise un fournisseur sans upstream défini nulle part reçoit une « Config error ».

### Anubis

- **Images Anubis personnalisées** : affiche vos propres `happy.webp`, `reject.webp` et `pensive.webp` sur les pages de challenge d'Anubis. Par défaut : activé quand les trois fichiers existent et ne sont pas vides, sinon désactivé. Variable : `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Les images vont dans `public/anubis` de votre dossier de données.

Plus dans le wiki : Forward-Authentication.
