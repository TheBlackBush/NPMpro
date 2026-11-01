## Sauvegarde et restauration

Enregistrez vos hôtes, certificats, utilisateurs et paramètres dans un fichier `.npmpro`, et restaurez-le sur cette instance de NPMpro ou sur une autre. Les statistiques de trafic et les journaux ne font jamais partie d'une sauvegarde.

### Créer une sauvegarde

- **Éléments à inclure** : des parties comme les hôtes, listes d'accès, certificats, identifiants DNS, utilisateurs, paramètres et fichiers personnalisés. Tout est coché au départ.
- **Inclure les secrets** : ajoute les clés privées, mots de passe, secrets de double authentification, valeurs des identifiants DNS, le secret client OIDC et la clé de licence GeoIP. Le fichier est chiffré avec une **Phrase secrète** d'au moins 12 caractères, que vous saisissez deux fois. NPMpro ne la stocke pas : sans elle, la sauvegarde ne peut pas être restaurée.
- Sans secrets, le fichier n'est pas chiffré et laisse les secrets de côté. Il contient quand même des noms d'hôtes, des utilisateurs et des paramètres, gardez-le donc privé.
- **Télécharger** enregistre le fichier sur votre ordinateur. **Conserver sur le serveur** le place dans `/data/backups`.

### Sauvegardes planifiées

Ajoutez des planifications qui créent des sauvegardes automatiquement et les conservent sur le serveur.

- **Quand** : toutes les N heures, chaque jour, chaque semaine ou chaque mois, dans le fuseau horaire du conteneur.
- **Protection** : **Phrase secrète** (restauration partout), **Clé de l'instance** (rien à retenir, restauration uniquement sur cette instance) ou **Sans secrets**.
- **Conserver** : combien de fichiers de cette planification sont conservés. Les plus anciens sont supprimés après chaque exécution réussie.
- Une planification peut être exécutée tout de suite, mise en pause, modifiée ou supprimée. Une exécution échouée est signalée sur la planification et sur le tableau de bord.

Les sauvegardes planifiées vous protègent des mauvaises modifications, pas de la perte du disque. Pour cela, copiez les fichiers sur une autre machine.

### Sauvegardes stockées

Liste les fichiers du serveur. Téléchargez-les, restaurez-les ou supprimez-les, ou choisissez **Téléverser une sauvegarde**. NPMpro crée une sauvegarde **Automatique** avant chaque restauration, fusion et déplacement de base de données ; elle ne demande aucune phrase secrète et ne se restaure que sur cette instance.

### Restauration

- **Remplacer** échange les parties que vous choisissez sur cette instance contre celles de la sauvegarde. Votre propre compte n'est jamais remplacé.
- **Fusionner** ajoute les éléments de la sauvegarde et ne supprime rien. Il affiche un aperçu et vous laisse choisir pour chaque conflit : ignorer, utiliser l'élément existant, ajouter comme nouveau ou remplacer.

Une restauration est annulée si nginx rejette le résultat. Une sauvegarde d'une version plus récente de NPMpro ne peut pas être restaurée. Certains paramètres restaurés demandent un redémarrage du conteneur.

Cette section n'a pas de variables d'environnement.

Plus dans le wiki : Backup-and-restore.
