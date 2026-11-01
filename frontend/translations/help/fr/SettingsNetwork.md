## Réseau

Indiquez à NPMpro quels proxys placés devant lui peuvent être crus sur l'adresse réelle du client. Sans cela, les journaux, les listes d'accès et CrowdSec voient l'adresse du proxy, pas celle du visiteur.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche un badge cadenas comme « Défini par TRUST_IP »). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur.

- **IP de proxy de confiance** : une adresse IPv4 ou IPv6 ou une plage CIDR par ligne, par exemple `10.0.0.0/8`, `192.168.1.5` ou `fd00::/8`. Les requêtes de ces adresses peuvent transmettre l'IP réelle du client dans `X-Forwarded-For`. Utilisez-le pour un répartiteur de charge ou un tunnel placé directement devant NPMpro. Par défaut : vide (personne n'est de confiance). Variable : `TRUST_IP` (séparées par des espaces). S'applique après le rechargement de nginx que lance l'enregistrement.
- **Faire confiance à Cloudflare** : récupère les plages d'IP de Cloudflare, les actualise régulièrement et leur fait confiance, de sorte que nginx voit les IP réelles des clients derrière Cloudflare. Par défaut : désactivé. Variable : `TRUST_CLOUDFLARE`. S'applique après le rechargement de nginx que lance l'enregistrement. Lisez d'abord les remarques sur Cloudflare dans le wiki (Security) : placer Cloudflare devant NPMpro a un coût pour la vie privée et la sécurité.

Ne faites confiance qu'aux adresses que vous contrôlez ou en lesquelles vous avez pleinement confiance. Une adresse de confiance peut se faire passer pour n'importe quel visiteur.

Si l'enregistrement échoue au test nginx, rien n'est enregistré et le message de nginx est affiché.

Plus dans le wiki : Security.
