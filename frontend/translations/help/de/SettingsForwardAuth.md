## Forward-Authentifizierung

Die Forward-Authentifizierung setzt eine Anmeldung oder eine Bot-Prüfung vor einen Proxy-Host. Bei jeder Anfrage fragt nginx zuerst einen Authentifizierungsdienst, ob der Besucher passieren darf. NPMpro hat dies fest eingebaut für Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia und Authentik. Den Anbieter betreiben Sie in einem eigenen Container.

Diese Seite legt die Standardadresse (Upstream) jedes Anbieters fest. Ein Proxy-Host schaltet die Prüfung mit **Auth Request** unter Optionen auf seinem Tab Details ein (oder bei einer Custom Location).

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt ein Schloss-Badge wie „Gesetzt durch AUTH_REQUEST_AUTHELIA_UPSTREAM“). Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist. Jede Einstellung hier gilt nach dem nginx-Reload, den das Speichern auslöst. Schlägt der nginx-Test fehl, wird nichts gespeichert.

### Standard-Upstreams

- **Anubis-Upstream**, **Tinyauth-Upstream**, **OAuth2-Proxy-Upstream**, **VoidAuth-Upstream**, **Authelia-Upstream**, **Authentik-Upstream**: werden von Proxy-Hosts mit diesem Anbieter verwendet, die keinen eigenen Upstream haben. Der eigene Wert eines Hosts gewinnt. Standard: leer (keiner). Variablen: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Format: `scheme://host:port`, zum Beispiel `http://127.0.0.1:9091`, oder `scheme://cu_name` für Ihren eigenen nginx-Upstream-Block, dessen Name mit `cu_` beginnt. Verwenden Sie `http` oder `https`; der Port ist erforderlich; eine IPv6-Adresse steht in eckigen Klammern. Kein Pfad, keine Leerzeichen und keines der Zeichen `; { } # " ' $ \`.

Sie können einen Standard nicht leeren, solange Proxy-Hosts diesen Anbieter ohne eigenen Upstream verwenden. Die Meldung listet diese Hosts auf.

Ein Host, der einen Anbieter ohne Upstream an irgendeiner Stelle verwendet, bekommt einen „Config error“.

### Anubis

- **Eigene Anubis-Bilder**: zeigt Ihre eigenen `happy.webp`, `reject.webp` und `pensive.webp` auf den Challenge-Seiten von Anubis. Standard: an, wenn alle drei Dateien existieren und nicht leer sind, sonst aus. Variable: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Die Bilder gehören nach `public/anubis` in Ihrem Datenordner.

Mehr im Wiki: Forward-Authentication.
