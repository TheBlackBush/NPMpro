## Aide concernant les certificats

### Certificat HTTP

Un certificat HTTP validé signifie que les serveurs de Certbot testeront d'accéder à vos domaines via HTTP (et non HTTPS !). En cas de succès, ils émettront votre certificat.

Pour cette méthode, vous devrez créer un Hôte Proxy pour votre ou vos domaines. Cet Hôte Proxy devra être accessible via HTTP et pointer vers cette installation Nginx. Une fois le certificat émis, vous pourrez modifier l'Hôte Proxy pour qu'il utilise également ce certificat pour les connexions HTTPS. Cependant, l'Hôte Proxy devra toujours être configuré pour l'accès HTTP afin que le certificat puisse être renouvelé.

Ce processus ne prend pas en charge les domaines génériques.

### Certificat DNS

Un certificat DNS validé nécessite l'utilisation du plugin Fournisseur DNS. Fournisseur DNS créera des enregistrements temporaires sur votre domaine. Certbot interrogera ensuite ces enregistrements pour vérifier que vous en êtes bien le propriétaire. En cas de succès, votre certificat sera émis.

Il n'est pas nécessaire de créer un Hôte Proxy avant de demander ce type de certificat.

Il n'est pas non plus nécessaire de configurer votre Hôte Proxy pour l'accès HTTP.

Ce processus prend en charge les domaines génériques.

#### Identifiants DNS enregistrés

Les identifiants de votre Fournisseur DNS sont enregistrés séparément du certificat, dans
l'onglet _Identifiants DNS_ de la page Certificats. Un certificat choisit ensuite simplement l'un des
identifiants enregistrés, ce qui permet à plusieurs certificats de les partager.

Les secrets sont stockés chiffrés et ne sont plus jamais affichés. Lorsque vous modifiez un identifiant, laissez
un secret vide pour conserver la valeur enregistrée. La clé utilisée pour le chiffrement est le fichier
`/data/npmpro/dns-credentials.key` : sauvegardez-le avec la base de données, sinon
les identifiants enregistrés ne pourront pas être lus après une restauration.

Les fournisseurs sans formulaire utilisent la zone de texte INI, dans laquelle vous collez le contenu du
fichier d'identifiants de ce fournisseur.

## Certificat personnalisé

Utilisez cette option pour importer votre propre certificat TLS, fourni par votre autorité de certification.
