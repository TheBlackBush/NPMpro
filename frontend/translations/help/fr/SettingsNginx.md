## nginx

Les paramètres de nginx lui-même qui s'appliquent à tous les hôtes : combien de workers tournent, les règles TLS et les modules facultatifs. L'enregistrement teste la configuration et recharge nginx. Une configuration qui échoue au test n'est pas appliquée.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche un badge cadenas comme « Défini par NGINX_WORKER_PROCESSES »). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur. Chaque paramètre ici s'applique après le rechargement de nginx que lance l'enregistrement.

### Workers

- **Processus workers** : « Automatique (un par thread CPU) » ou un nombre jusqu'aux threads CPU que voit le conteneur. Par défaut : un par thread, 4 au plus. Variable : `NGINX_WORKER_PROCESSES`.
- **Connexions par worker** : connexions ouvertes que chaque worker gère à la fois, de 64 à 65535. Par défaut : 512. Variable : `NGINX_WORKER_CONNECTIONS`.
- **Délai d'arrêt des workers** : combien de temps les anciens workers gardent leurs connexions après un rechargement. Une durée nginx comme `30s`, `10m` ou `1h` ; `0` signifie sans limite. Par défaut : `1h`. Variable : `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Journalisation

- **Journaliser les erreurs de fichier introuvable** : écrit une ligne d'erreur pour chaque requête d'un fichier manquant. Par défaut : désactivé. Variable : `NGINX_LOG_NOT_FOUND`.

### TLS pour tous les hôtes

Désactiver TLS 1.2 ou les courbes NIST P exclut les navigateurs et clients plus anciens. TLS 1.3 est toujours activé.

- **Autoriser TLS 1.2** : activé par défaut. Variable : `NGINX_DISABLE_TLS12` (inversée : `true` désactive TLS 1.2).
- **Échange de clés post-quantique uniquement** : n'autorise que X25519MLKEM768, ce qui demande un client récent. Il désactive TLS 1.2 et les courbes NIST P et les verrouille tant qu'il est activé. Par défaut : désactivé. Variable : `NGINX_FORCE_X25519MLKEM768`.
- **Autoriser les courbes NIST P** : secp521r1, secp384r1 et prime256v1 pour l'échange de clés, en plus de X25519. Par défaut : activé. Variable : `NGINX_TRUST_SECPR1`.
- **Autoriser les signatures RSA PKCS#1** : pour les anciens clients qui ne peuvent pas utiliser RSA-PSS. Par défaut : désactivé. Variable : `NGINX_TRUST_RSA_PKCS1`.

### Modules

Tous sont désactivés par défaut. N'activez un module que si une de vos configurations personnalisées en a besoin. En désactiver un alors qu'une configuration personnalisée l'utilise encore fait échouer le test nginx.

- **njs (JavaScript)** : directives `js_*`. Variable : `NGINX_LOAD_NJS_MODULE`.
- **Authentification LDAP** : directives `auth_ldap`. Variable : `NGINX_LOAD_LDAP_MODULE`.
- **Upstreams NTLM** : `ntlm` dans les blocs upstream. Variable : `NGINX_LOAD_NTLM_MODULE`.
- **Statut du trafic des hôtes virtuels** : directives `vhost_traffic_status_*`. Variable : `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Plus dans le wiki : Configuration.
