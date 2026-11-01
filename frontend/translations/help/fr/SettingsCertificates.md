## Certificats et TLS

Valeurs par défaut pour les certificats que NPMpro demande à votre serveur ACME (Let's Encrypt, sauf si vous en définissez un autre avec `ACME_SERVER`), pour la façon dont ils sont agrafés (stapling) et renouvelés, et pour le certificat qui répond aux hôtes inconnus. Il s'agit de la section Paramètres, pas de la page de liste Certificats.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche un badge cadenas comme « Défini par ACME_KEY_TYPE »). Certains champs en suivent un autre : un `ACME_KEY_SIZE` seul qui est une courbe ECDSA garde le type de clé sur ECDSA, et Must-Staple garde l'agrafage OCSP activé. Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur.

### Demandes de certificat

Elles s'appliquent à partir de la prochaine demande de certificat.

- **Type de clé** : `ECDSA` (par défaut, recommandé : clés plus petites, négociations plus rapides) ou `RSA` pour les clients qui ne peuvent pas utiliser ECDSA. Variable : `ACME_KEY_TYPE`.
- **Taille de clé** : la courbe pour ECDSA (`secp256r1`, `secp384r1`, `secp521r1` ; par défaut `secp384r1`) ou les bits pour RSA (`2048`, `3072`, `4096` ; par défaut `4096`). Variable : `ACME_KEY_SIZE`.
- **Profil ACME** : le profil demandé au serveur, vérifié auprès du serveur à l'enregistrement. Vide utilise la valeur par défaut du serveur. Avec Let's Encrypt, la valeur par défaut est `shortlived` ; les clients qui ont besoin d'un Common Name ne fonctionnent pas avec les certificats `shortlived` et `tlsserver`. Variable : `ACME_PROFILE` (`none` pour vide).
- **OCSP Must-Staple** : marque les nouveaux certificats comme must-staple et garde l'agrafage OCSP activé. Seulement pour les AC qui le prennent en charge (ZeroSSL) ; Let's Encrypt refuse ces demandes. Par défaut : activé pour Google Trust Services et ZeroSSL, sinon désactivé. Variable : `ACME_MUST_STAPLE`.
- **Vérifier le certificat du serveur ACME** : activé par défaut. Ne le désactivez que pour un serveur ACME privé avec un certificat auto-signé. Variable : `ACME_SERVER_TLS_VERIFY`.

### Agrafage (stapling)

Les deux s'appliquent après le rechargement de nginx que lance l'enregistrement, et les deux désactivent la compression des certificats TLS.

- **OCSP stapling pour les certificats ACME** : envoie la réponse OCSP avec les certificats du serveur ACME, quand l'AC propose OCSP. Par défaut : activé pour Google Trust Services et ZeroSSL, sinon désactivé. Variable : `ACME_OCSP_STAPLING`.
- **OCSP stapling pour les certificats personnalisés** : la même chose pour les certificats téléversés. Par défaut : désactivé. Variable : `CUSTOM_OCSP_STAPLING`.

### Certificat par défaut

- **Certificat pour les hôtes inconnus et l'interface web** : présenté pour les noms d'hôte pour lesquels NPMpro n'a pas d'hôte et sur le port de l'interface web. Par défaut : intégré, un certificat de remplacement généré. Variable : `DEFAULT_CERT_ID` (un ID de certificat ; `0` est l'intégré). S'applique après le rechargement de nginx que lance l'enregistrement.

### Renouvellement

- **Intervalle de vérification du renouvellement** : 1 à 499 heures entre les vérifications. Un certificat n'est renouvelé que lorsqu'il arrive à échéance. Par défaut : 3. Variable : `CERTBOT_RUN_INTERVAL`. S'applique immédiatement.

### ECH

- **Intervalle de rotation des clés ECH** : 1 à 24 heures entre les exécutions de votre script ECH (`/data/tls/ech/cron.sh`). Utilisé seulement si le script n'est pas vide. Par défaut : 1. Variable : `ECH_ROTATION_INTERVAL`. S'applique immédiatement.

Plus dans le wiki : Security.
