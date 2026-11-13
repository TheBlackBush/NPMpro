## Pagine di destinazione

Le pagine che i visitatori vedono al posto di un sito: quando per un indirizzo non è configurato nulla, una pagina non viene trovata, il server dietro un host non risponde, una lista di accesso li respinge, un host è in manutenzione, manca un certificato oppure CrowdSec li blocca o li controlla. Ogni pagina appare nella lingua del browser del visitatore, in chiaro e in scuro.

### Pagina predefinita

Ciò che mostra un indirizzo senza host: **Pagina di Congratulazioni**, **Pagina 404**, **Nessuna Risposta (444)**, **Reindirizza** (a un indirizzo che indichi) o **HTML Personalizzato** (la tua pagina).

### Pagine globali

Per ogni pagina: la sua pagina NPMpro (per esempio **Pagina di errore 404** o **Pagina «Accesso negato»**) oppure una **Pagina personalizzata**. Una pagina personalizzata è un file HTML (al massimo 1 MB, UTF-8) con stili e immagini al suo interno; incollalo o usa **Carica .html**. Può mostrare l'IP del visitatore, l'ora, il codice di stato e il nome dell'host con `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` e `host`; le altre inclusioni lato server vengono rifiutate.

Gli host proxy, gli host 404 e le liste di accesso usano queste pagine a meno che non scelgano le proprie (la scheda **Pagine** di un host proxy, il campo **Pagina** di un host 404, **Negato** di una lista di accesso).

**Anteprima** apre la pagina salvata in una nuova scheda con valori di esempio.

### CrowdSec

Impostazioni, CrowdSec decide se un blocco mostra una pagina, reindirizza o risponde solo con un codice di stato; questa sezione decide l'aspetto delle pagine di blocco e di captcha.
