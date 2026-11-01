## Base de données

La base de données dans laquelle NPMpro garde ses hôtes, certificats, utilisateurs, journaux et statistiques. Par défaut, c'est SQLite, un seul fichier, et c'est le choix recommandé. Vous pouvez tout déplacer d'ici vers MySQL, MariaDB, PostgreSQL ou un nouveau fichier SQLite. La base utilisée n'est pas modifiée par un déplacement.

### Base de données utilisée

Affiche le moteur et la version, où elle se trouve, sa taille et la **Source** de la connexion : **Par défaut** (le fichier SQLite `/data/npmpro/database.sqlite`), **Fichier de paramètres de la base de données** (`/data/npmpro/database.json`, écrit par un déplacement) ou **Environnement** (variables `DB_MYSQL_*` ou `DB_POSTGRES_*`). Après un déplacement, elle indique quand et depuis quel moteur vous avez déménagé.

### Tables

Chaque table avec ses lignes et sa taille. La carte peut être repliée.

### Déplacer vers une autre base de données

Créez d'abord sur votre serveur une base de données vide et un utilisateur qui peut créer des tables ; NPMpro ne crée pas la base. Prérequis : MySQL 8.0, MariaDB 10.6 ou PostgreSQL 13 ou plus récent.

1. Choisissez le **Moteur** et saisissez **Hôte**, **Port**, **Nom de la base de données**, **Utilisateur** et **Mot de passe**. Activez **Utiliser TLS** si le serveur l'exige (pour MySQL et MariaDB, vous pouvez aussi **Vérifier le certificat du serveur** et **Vérifier le nom du serveur**). Un déplacement vers SQLite n'a besoin de rien : il crée un nouveau fichier dans `/data/npmpro`.
2. **Tester la connexion**. Cela vérifie la version, que la base est vide et que l'utilisateur peut créer des tables. Rien n'est modifié.
3. **Déplacer**, puis saisissez le mot demandé et cliquez sur **Déplacer maintenant**.

NPMpro met les modifications en pause, fait une sauvegarde de sécurité, crée les tables, copie et vérifie chaque ligne, puis redémarre sur la nouvelle base. Vos sites continuent d'être servis. La page se recharge quand NPMpro répond de nouveau, et vous devrez peut-être vous reconnecter.

Si une étape échoue, NPMpro reste sur la base qu'il utilisait et la fenêtre indique l'étape qui s'est arrêtée. L'ancienne base n'est jamais supprimée, vous pouvez donc revenir en arrière : supprimez `/data/npmpro/database.json` et redémarrez le conteneur.

Si la connexion vient de variables `DB_MYSQL_*` ou `DB_POSTGRES_*`, la section est en lecture seule. Pour déplacer, faites une sauvegarde, faites pointer les variables vers la nouvelle base, redémarrez et restaurez la sauvegarde.

Plus dans le wiki : Database.
