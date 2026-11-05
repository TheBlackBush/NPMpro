## Utenti

Le persone che possono accedere a questo NPMpro. Solo gli amministratori vedono questo elenco. Si può accedere anche con un provider OIDC, da configurare in Impostazioni, Autenticazione.

L'elenco mostra nome, email, ruoli e stato di ogni utente. Cerca per nome o email e ordina per colonna.

### Aggiungere o modificare un utente

**Aggiungi Utente** chiede il **Nome Completo** e l'**Indirizzo Email**. Modifica apre la stessa finestra, dove puoi anche caricare o rimuovere l'avatar dell'utente. In **Opzioni**:

- **Amministratore**: accesso completo, comprese Impostazioni, Utenti e Log di Audit. Senza questa opzione l'utente è un Utente Standard, limitato dai permessi qui sotto.
- **Disabilitato**: l'utente non può più accedere e le sue sessioni aperte terminano.

Non puoi cambiare i tuoi ruoli, disabilitarti o eliminarti, e la tua riga offre solo Modifica.

### Menu della riga

Per gli altri account:

- **Permessi**: vedi sotto.
- **Imposta Password**: imposta una nuova password. Tutti gli altri dispositivi dell'utente vengono disconnessi.
- **Reimposta MFA**: solo per gli utenti che hanno la MFA. La disattiva senza codice di ripristino e l'utente può configurarla di nuovo.
- **Revoca sessioni**: disconnette l'utente da tutti i dispositivi.
- **Disabilita** o **Abilita**: come l'opzione **Disabilitato**.
- **Elimina**: rimuove l'account. Le sue voci nei Log di Audit restano.

### Permessi

Per un Utente Standard scegli per ogni sezione (Host proxy, Host di Reindirizzamento, Hosts 404, Stream, Liste di Accesso, Certificati): **Gestisci**, **Sola Lettura** o **Nascosto**. **Visibilità Elementi** decide se l'utente vede **Tutti gli Elementi** o **Solo Elementi Creati**.

Una scelta attiva anche ciò di cui la sezione ha bisogno: gli Host proxy richiedono Liste di Accesso e Certificati, e Nascosto non è disponibile finché un'altra sezione richiede quella. Gli amministratori hanno accesso a tutto, quindi per loro è offerta solo la visibilità degli elementi.

Altro nel wiki: Usage (Users and permissions) e Authentication.
