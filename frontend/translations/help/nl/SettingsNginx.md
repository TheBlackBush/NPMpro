## nginx

Instellingen van nginx zelf die voor alle hosts gelden: hoeveel workers draaien, TLS-regels en optionele modules. Opslaan test de configuratie en laadt nginx opnieuw. Een configuratie die de test niet doorstaat, wordt niet toegepast.

Een variabele die op de container is gezet, gaat voor op de interface en vergrendelt het veld (het veld toont een slotbadge zoals „Ingesteld door NGINX_WORKER_PROCESSES”). Gebruik de interface voor alles wat niet in de container is ingesteld. Elke instelling hier geldt na de nginx-herlaadactie die het opslaan uitvoert.

### Workers

- **Workerprocessen**: „Automatisch (één per CPU-thread)” of een getal tot het aantal CPU-threads dat de container ziet. Standaard: één per thread, hoogstens 4. Variabele: `NGINX_WORKER_PROCESSES`.
- **Verbindingen per worker**: open verbindingen die elke worker tegelijk afhandelt, 64 tot 65535. Standaard: 512. Variabele: `NGINX_WORKER_CONNECTIONS`.
- **Time-out voor het afsluiten van workers**: hoe lang oude workers hun verbindingen houden na een herlaadactie. Een nginx-tijdwaarde zoals `30s`, `10m` of `1h`; `0` betekent geen limiet. Standaard: `1h`. Variabele: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logging

- **Fouten voor niet-gevonden bestanden loggen**: schrijft een foutlogregel voor elk verzoek om een ontbrekend bestand. Standaard: uit. Variabele: `NGINX_LOG_NOT_FOUND`.

### TLS voor alle hosts

Het uitzetten van TLS 1.2 of de NIST P-curves sluit oudere browsers en clients buiten. TLS 1.3 staat altijd aan.

- **TLS 1.2 toestaan**: standaard aan. Variabele: `NGINX_DISABLE_TLS12` (omgekeerd: `true` zet TLS 1.2 uit).
- **Alleen post-quantum sleuteluitwisseling**: staat alleen X25519MLKEM768 toe, wat een recente client vereist. Het zet TLS 1.2 en de NIST P-curves uit en vergrendelt ze zolang het aan staat. Standaard: uit. Variabele: `NGINX_FORCE_X25519MLKEM768`.
- **De NIST P-curves toestaan**: secp521r1, secp384r1 en prime256v1 voor de sleuteluitwisseling, naast X25519. Standaard: aan. Variabele: `NGINX_TRUST_SECPR1`.
- **RSA PKCS#1-handtekeningen toestaan**: voor oude clients die RSA-PSS niet kunnen gebruiken. Standaard: uit. Variabele: `NGINX_TRUST_RSA_PKCS1`.

### Modules

Allemaal standaard uit. Zet een module alleen aan als een eigen configuratie van u hem nodig heeft. Zet u er een uit terwijl een eigen configuratie hem nog gebruikt, dan mislukt de nginx-test.

- **njs (JavaScript)**: `js_*`-directives. Variabele: `NGINX_LOAD_NJS_MODULE`.
- **LDAP-authenticatie**: `auth_ldap`-directives. Variabele: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM-upstreams**: `ntlm` in upstreamblokken. Variabele: `NGINX_LOAD_NTLM_MODULE`.
- **Verkeersstatus van virtuele hosts**: `vhost_traffic_status_*`-directives. Variabele: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Meer in de wiki: Configuration.
