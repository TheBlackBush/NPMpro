## Database

Il database in cui NPMpro conserva host, certificati, utenti, log e statistiche. Per impostazione predefinita è SQLite, un singolo file, ed è la scelta consigliata. Da qui puoi spostare tutto su MySQL, MariaDB, PostgreSQL o un nuovo file SQLite. Lo spostamento non modifica il database in uso.

### Database in uso

Mostra il motore e la versione, dove si trova, la sua dimensione e l'**Origine** della connessione: **Predefinita** (il file SQLite `/data/npmpro/database.sqlite`), **File delle impostazioni del database** (`/data/npmpro/database.json`, scritto da uno spostamento) oppure **Ambiente** (variabili `DB_MYSQL_*` o `DB_POSTGRES_*`). Dopo uno spostamento indica quando e da quale motore hai spostato.

### Tabelle

Ogni tabella con le sue righe e dimensione. La scheda può essere compressa.

### Sposta su un altro database

Prima crea sul tuo server un database vuoto e un utente che possa creare tabelle; NPMpro non crea il database. Requisiti: MySQL 8.0, MariaDB 10.6 o PostgreSQL 13 o più recenti.

1. Scegli il **Motore** e inserisci **Host**, **Porta**, **Nome del database**, **Utente** e **Password**. Attiva **Usa TLS** se il server lo richiede (per MySQL e MariaDB puoi anche **Verifica il certificato del server** e **Verifica il nome del server**). Uno spostamento su SQLite non richiede nulla: crea un nuovo file in `/data/npmpro`.
2. **Verifica connessione**. Controlla la versione, che il database sia vuoto e che l'utente possa creare tabelle. Non modifica nulla.
3. **Sposta**, poi scrivi la parola richiesta e fai clic su **Sposta ora**.

NPMpro sospende le modifiche, crea un backup di sicurezza, crea le tabelle, copia e controlla ogni riga, poi si riavvia sul nuovo database. I tuoi siti continuano a essere serviti. La pagina si ricarica quando NPMpro risponde di nuovo e potresti dover accedere un'altra volta.

Se un passaggio fallisce, NPMpro resta sul database che usava e la finestra indica il passaggio che si è fermato. Il vecchio database non viene mai eliminato, quindi puoi tornare indietro: rimuovi `/data/npmpro/database.json` e riavvia il container.

Se la connessione deriva dalle variabili `DB_MYSQL_*` o `DB_POSTGRES_*`, la sezione è in sola lettura. Per spostare, crea un backup, punta le variabili al nuovo database, riavvia e ripristina il backup.

Altro nel wiki: Database.
