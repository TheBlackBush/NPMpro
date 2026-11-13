## CrowdSec

Connecte le bouncer CrowdSec intégré à NPMpro à votre conteneur CrowdSec. Chaque requête vers vos hôtes est vérifiée d'après les décisions de l'API locale de CrowdSec (LAPI) et, avec une URL AppSec, d'après les règles d'AppSec. L'enregistrement applique les paramètres aussitôt par un rechargement de nginx ; le conteneur ne redémarre pas.

NPMpro écrit `/data/crowdsec/crowdsec.conf` à partir de ces paramètres. Les modifications manuelles de ce fichier sont écrasées. `ban.html` et `captcha.html` du même dossier sont à vous de modifier.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ : `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### État et Tester la connexion

Indique si nginx charge le bouncer et quand NPMpro a joint la LAPI pour la dernière fois. **Tester la connexion** vérifie les valeurs du formulaire : une requête de décisions vers la LAPI avec la clé (ou le certificat client TLS) et, avec une URL AppSec, une requête vers AppSec. Un champ de clé laissé vide utilise la clé enregistrée.

L'enregistrement avec le bouncer activé lance d'abord le même test. S'il échoue, les raisons s'affichent et **Enregistrer quand même** enregistre malgré tout, par exemple quand CrowdSec ne tourne pas encore.

**Enregistrer quand même** n'est pas proposé quand AppSec échoue, que **Quand AppSec est injoignable** vaut **Refuser la requête** et que l'interface d'administration est vérifiée, car cet enregistrement vous bloquerait l'accès à l'interface d'administration : corrigez la **Clé API** ou l'**URL d'AppSec**, réglez l'action en cas d'échec sur **Laisser passer la requête**, ou activez **Exclure l'interface d'administration de CrowdSec**.

### Connexion

- **Activer le bouncer** : vérifie chaque requête.
- **URL de la LAPI** : par exemple `http://127.0.0.1:8080`.
- **Clé API** : obtenue avec `docker exec crowdsec cscli bouncers add npmpro`. Stockée chiffrée, jamais réaffichée. **Supprimer la clé enregistrée** la supprime.
- **Certificat client TLS** : à la place de la clé, un fichier de certificat et un fichier de clé sous `/data/crowdsec/` ; nécessite une URL de LAPI en `https://`.
- **Vérifier les certificats TLS** : vérifie le certificat d'une URL de LAPI ou d'AppSec en https.

### Blocage

- **Mode** : live interroge la LAPI pour chaque IP cliente et met la réponse en cache pendant le nombre de secondes indiqué ; stream télécharge toutes les décisions à l'intervalle indiqué.
- **Réponse à un bannissement** : la page de bannissement (avec un code d'état facultatif, 403 par défaut), une redirection, ou un code d'état sans page.
- **Mesure de repli** et **Types de décisions** : comment sont traitées les décisions que le bouncer ne peut pas appliquer, et quels types sont appliqués.
- **Exclure l'interface d'administration de CrowdSec** : les requêtes vers l'interface d'administration contournent le bouncer et AppSec. Activez-le avant d'utiliser AppSec avec le refus, afin qu'une panne de CrowdSec ne puisse pas vous bloquer l'accès.

### Captcha

Le fournisseur (reCAPTCHA, hCaptcha, Cloudflare Turnstile), sa clé de site et sa clé secrète, et la durée de validité d'un captcha résolu. Utilisé pour les décisions de type captcha.

### AppSec

- **URL d'AppSec** : par exemple `http://127.0.0.1:7422` ; vide désactive AppSec.
- **Quand AppSec est injoignable** : refuser bloque toutes les requêtes vérifiées tant qu'AppSec est indisponible ; laisser passer les laisse sans vérification.

### Avancé

Le délai des requêtes vers la LAPI, les filtres de scénarios, les chemins exclus, les requêtes internes, les délais et options d'AppSec, et les fichiers des pages de bannissement et de captcha avec un **Aperçu**.

### Accès bloqué ?

Redémarrez CrowdSec, ou définissez `CROWDSEC_ENABLED=false` sur le conteneur et recréez-le ; corrigez ensuite les paramètres ici.

Plus dans le wiki : CrowdSec.
