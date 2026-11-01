## Avancé

Des paramètres qui modifient en petit le comportement de NPMpro.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche un badge cadenas comme « Défini par TZ »). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur.

- **Fuseau horaire** : le fuseau horaire du conteneur. Il fixe les heures dans les journaux, le rapport GoAccess et les tâches planifiées comme les sauvegardes planifiées. Utilisez un nom comme `Europe/Berlin`. Par défaut : `UTC`. Variable : `TZ`. S'applique après un redémarrage du conteneur : l'enregistrement le mémorise, et la section le liste sous « Redémarrez le conteneur pour appliquer ».
- **Formater les configurations nginx** : met en forme les configurations écrites par NPMpro, avec nginxbeautifier. Désactivez-le s'il échoue sur des configurations personnalisées ou avancées non standard. Par défaut : activé. Variable : `DISABLE_NGINX_BEAUTIFIER` (inversée : `true` désactive la mise en forme). S'applique immédiatement.
- **Photos de profil Gravatar** : affiche l'image Gravatar des utilisateurs qui n'ont pas d'avatar téléversé. Pour récupérer une image, NPMpro envoie à Gravatar un hachage de l'adresse e-mail de l'utilisateur ; désactivez-le donc si cela compte pour vous. Par défaut : activé. Variable : `DISABLE_GRAVATAR` (inversée : `true` le désactive). S'applique immédiatement ; l'image d'un utilisateur change à son prochain enregistrement de profil, et les images déjà récupérées restent jusque-là.
