## Log di Audit

Un registro di chi ha cambiato cosa. Solo gli amministratori lo vedono.

Ogni voce mostra l'utente, l'oggetto e l'azione. Vengono registrati:

- **Creato**, **Aggiornato** ed **Eliminato** per host proxy, host di reindirizzamento, hosts 404, stream, liste di accesso, certificati, credenziali DNS, pianificazioni del backup e utenti. Le impostazioni registrano solo **Aggiornato**.
- **Abilitato** e **Disabilitato** per host proxy, host di reindirizzamento, hosts 404, stream e pianificazioni del backup.
- Backup: **Creato**, **Caricato**, **Eliminato**, **Ripristinato** e **Unito** per un backup, e **Backup riuscito** e **Backup non riuscito** per le esecuzioni dei backup pianificati.
- **Scaricato** per i certificati. **Esportato** e **Importato** per il backup di una singola pagina (host, liste di accesso, certificati, credenziali DNS).
- Spostamenti del database: **Spostato** e **Spostamento non riuscito**.

Le voci più recenti vengono prima. **Carica altri** mostra le 50 successive e il numero sotto l'elenco indica quante sono caricate sul totale.

### Trovare una voce

- **Cerca** esamina i dettagli di tutte le voci, quindi un nome di dominio o un indirizzo email trova le voci corrispondenti.
- **Tipo di oggetto**, **Azione** e **Utente** restringono l'elenco. Si combinano tra loro e con la ricerca.
- Con un filtro o una ricerca attivi, l'elenco indica quante voci sono mostrate. **Cancella filtri** li rimuove tutti.

### Dettagli

Il pulsante a forma di occhio di una riga (**Visualizza Dettagli**) apre la voce: l'utente, che cosa è successo e i dati salvati con essa. Per una modifica è l'oggetto così come è stato salvato. I valori lunghi vanno a capo e la finestra scorre.

Un utente eliminato in seguito compare come **Utente eliminato**. NPMpro non rimuove mai le voci da solo e il log di audit non fa parte di un backup.

Altro nel wiki: Usage (Audit Logs).
