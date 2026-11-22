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

#### Domaines

Un identifiant liste les domaines (zones DNS) qu'il gère, par exemple `example.com`. L'onglet **Domaines** de la page Certificats liste les domaines de tous vos identifiants.

## Certificat personnalisé

Utilisez cette option pour importer votre propre certificat TLS, fourni par votre autorité de certification.

Le champ **Noms de domaine** propose les domaines de vos identifiants DNS et les noms que des hôtes et des certificats utilisent déjà (les noms d'un flux viennent de son certificat). Vous pouvez toujours saisir un autre nom : `Ajouter <nom>` vient en premier, et Entrée ajoute ce que vous avez saisi.

Avec le challenge DNS, la fenêtre propose l'identifiant DNS dont les domaines couvrent tous les noms et en donne la raison. Vous pouvez le changer à tout moment, et un identifiant choisi par vous est conservé.

### Autorité de certification

Un certificat demandé à un serveur ACME est délivré par l'AC choisie dans sa fenêtre : l'AC de l'instance (marquée « par défaut ») ou une autre AC qu'un administrateur a ajoutée dans Paramètres, Certificats et TLS, sous **Autres AC**. La liste affiche l'AC de chaque certificat dans la colonne **AC**. **Réémettre** dans le menu du certificat le redemande à une autre AC sous le même nom ; en cas d'échec, le certificat actuel est conservé. **Modifier** sur un certificat ACME change ses noms de domaine : le certificat est redemandé sous la même entrée, la fenêtre avertit des noms que des hôtes utilisent encore, et un échec ne change rien.
