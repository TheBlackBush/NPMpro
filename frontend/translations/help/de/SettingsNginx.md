## nginx

Einstellungen von nginx selbst, die für alle Hosts gelten: wie viele Worker laufen, TLS-Regeln und optionale Module. Das Speichern testet die Konfiguration und lädt nginx neu. Eine Konfiguration, die den Test nicht besteht, wird nicht angewendet.

Eine am Container gesetzte Variable hat Vorrang vor der Oberfläche und sperrt das Feld (das Feld zeigt ein Schloss-Badge wie „Gesetzt durch NGINX_WORKER_PROCESSES“). Verwenden Sie die Oberfläche für alles, was nicht im Container gesetzt ist. Jede Einstellung hier gilt nach dem nginx-Reload, den das Speichern auslöst.

### Worker

- **Worker-Prozesse**: „Automatisch (einer pro CPU-Thread)“ oder eine Zahl bis zu den CPU-Threads, die der Container sieht. Standard: einer pro Thread, höchstens 4. Variable: `NGINX_WORKER_PROCESSES`.
- **Verbindungen pro Worker**: offene Verbindungen, die jeder Worker gleichzeitig bedient, 64 bis 65535. Standard: 512. Variable: `NGINX_WORKER_CONNECTIONS`.
- **Timeout beim Beenden von Workern**: wie lange alte Worker nach einem Reload ihre Verbindungen behalten. Ein nginx-Zeitwert wie `30s`, `10m` oder `1h`; `0` bedeutet keine Begrenzung. Standard: `1h`. Variable: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logging

- **Fehler „Datei nicht gefunden“ protokollieren**: schreibt für jede Anfrage nach einer fehlenden Datei eine Zeile ins Fehlerlog. Standard: aus. Variable: `NGINX_LOG_NOT_FOUND`.

### TLS für alle Hosts

Das Ausschalten von TLS 1.2 oder der NIST-P-Kurven sperrt ältere Browser und Clients aus. TLS 1.3 ist immer an.

- **TLS 1.2 erlauben**: Standard an. Variable: `NGINX_DISABLE_TLS12` (invertiert: `true` schaltet TLS 1.2 aus).
- **Nur Post-Quanten-Schlüsselaustausch**: erlaubt nur X25519MLKEM768, was einen aktuellen Client braucht. Es schaltet TLS 1.2 und die NIST-P-Kurven aus und sperrt sie, solange es an ist. Standard: aus. Variable: `NGINX_FORCE_X25519MLKEM768`.
- **NIST-P-Kurven erlauben**: secp521r1, secp384r1 und prime256v1 für den Schlüsselaustausch, neben X25519. Standard: an. Variable: `NGINX_TRUST_SECPR1`.
- **RSA-PKCS#1-Signaturen erlauben**: für alte Clients, die RSA-PSS nicht nutzen können. Standard: aus. Variable: `NGINX_TRUST_RSA_PKCS1`.

### Module

Alle sind standardmäßig aus. Schalten Sie ein Modul nur ein, wenn eine eigene Konfiguration von Ihnen es braucht. Schalten Sie eines aus, während eine eigene Konfiguration es noch verwendet, schlägt der nginx-Test fehl.

- **njs (JavaScript)**: `js_*`-Direktiven. Variable: `NGINX_LOAD_NJS_MODULE`.
- **LDAP-Authentifizierung**: `auth_ldap`-Direktiven. Variable: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM-Upstreams**: `ntlm` in Upstream-Blöcken. Variable: `NGINX_LOAD_NTLM_MODULE`.
- **Traffic-Status virtueller Hosts**: `vhost_traffic_status_*`-Direktiven. Variable: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Mehr im Wiki: Configuration.
