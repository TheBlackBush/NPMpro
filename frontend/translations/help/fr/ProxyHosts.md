## Qu'est-ce qu'un hôte proxy ?

Un hôte proxy est la porte d'entrée d'un service web. Les visiteurs ouvrent votre domaine dans NPMpro, et NPMpro transmet la requête au service qui se trouve derrière. Il peut aussi ajouter TLS (HTTPS) pour les services qui n'en ont pas. Les hôtes proxy sont l'usage le plus courant de NPMpro.

Utilisez **Dupliquer** dans le menu de l'hôte pour copier un hôte dans une nouvelle fenêtre d'ajout. La copie démarre sans les noms de domaine, car un domaine ne peut appartenir qu'à un seul hôte activé.

### Détails

- **Noms de domaine** : les noms utilisés par les visiteurs. Obligatoire. Pour un nouveau certificat, les jokers (`*.example.com`) demandent le challenge DNS.
- **Schéma** : la façon dont NPMpro parle au service : `http://`, `https://`, `grpc://`, `grpcs://`, `path` (servir des fichiers ou du PHP depuis un dossier) ou `empty` (pas d'amont). Par défaut `http://`. Un changement de schéma désactive les options qui ne lui conviennent pas.
- **Nom d'hôte / IP / chemin de destination** : l'adresse du service. Vous pouvez ajouter un sous-chemin, par exemple `127.0.0.1/path`. Avec `path`, saisissez plutôt un dossier. Montez vos fichiers sous `/var/www` ; seuls les administrateurs peuvent utiliser un dossier en dehors. Un nom commençant par `cu_` désigne votre propre bloc upstream nginx (voir Load balancing dans le wiki).
- **Port de destination** : facultatif. Avec `path`, c'est la version de PHP.
- **Groupe** : une étiquette libre qui garde les longues listes en ordre.
- **Options** (toutes désactivées par défaut) :
  - **Envoyer l'en-tête noindex et bloquer certains user agents de robots** : demande aux moteurs de recherche de ne pas indexer le site et bloque certains robots d'indexation.
  - **Désactiver CrowdSec AppSec** : désactive CrowdSec AppSec pour cet hôte seulement. N'a d'effet que si AppSec est configuré.
  - **Désactiver la mise en tampon des requêtes** et **Désactiver la mise en tampon des réponses** : pour les amonts http et https. Gardez la mise en tampon activée, sauf si vous diffusez en flux ou envoyez de gros fichiers sur une liaison rapide et stable. Désactiver la mise en tampon des requêtes désactive aussi AppSec.
  - **Activer la compression par l'upstream** : laisse le service compresser lui-même ses réponses. Gardez-le désactivé sauf si le service en a besoin. Pas pour `path` ni `empty`.
  - **Activer fancyindex** : affiche une liste de fichiers quand un dossier n'a pas de fichier d'index. Seulement pour `path`.
- **X-Frame-Options** : `SAMEORIGIN` (par défaut), `DENY`, `none` (supprime l'en-tête) ou `upstream` (garde ce que le service envoie).
- **Auth Request** : place une connexion ou un contrôle anti-robots devant l'hôte (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Par défaut `none`. **Upstream Auth Request** est facultatif ; vide, il utilise la valeur par défaut de Paramètres, Authentification déléguée.
- **Listes d'accès globales** : **Accessible au public** (par défaut, sans connexion) ou **Personnalisée**, une ou plusieurs listes d'accès.

Les websockets sont toujours activés.

### Emplacements personnalisés

Un emplacement envoie un chemin de l'hôte (par exemple `/api/`) vers un autre service. Chacun a **Activé**, un chemin avec un type de correspondance facultatif (`=`, `~`, `~*`, `^~` ou `@`), son propre schéma, hôte, port, options, Auth Request et listes d'accès. Sa liste d'accès peut être **Globale**, ce qui utilise les listes de l'hôte. Il n'hérite pas de l'Auth Request de l'hôte. Ajoutez une barre oblique finale à un chemin, sauf si vous voulez une correspondance par préfixe. Les administrateurs peuvent ajouter une configuration nginx propre à chaque emplacement avec le bouton en forme d'engrenage.

### TLS

- **Certificat TLS** : Aucun, Demander un nouveau certificat, ou un certificat existant. Les options ci-dessous demandent un certificat.
- **Certificat mTLS** : une autorité de certification de clients. **Rendre mTLS facultatif** laisse entrer les visiteurs sans certificat. **mTLS contourne Auth Request** laisse les visiteurs ayant un certificat valide ignorer l'Auth Request.
- **Forcer HTTPS** redirige HTTP vers HTTPS. **Prise en charge de HTTP/3** autorise HTTP/3 (QUIC).
- **HSTS activé (2 ans)** : demande Forcer HTTPS. **HSTS sous-domaines + preload** demande HSTS.
- Pour un nouveau certificat : **Réutiliser la clé (déconseillé)** et **Utiliser le challenge DNS**, avec fournisseur, identifiants et secondes de propagation.

### Avancé

Configuration nginx personnalisée pour tout l'hôte (bloc server) et pour l'emplacement principal `location /`. Seuls les administrateurs peuvent la modifier.

Plus dans le wiki : Host options.
