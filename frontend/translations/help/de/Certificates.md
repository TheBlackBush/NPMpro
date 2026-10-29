## Hilfe zu Zertifikaten

### HTTP-Zertifikat

Ein HTTP-validiertes Zertifikat bedeutet, dass Certbot-Server
versuchen, Ihre Domains über HTTP (nicht HTTPS!) zu erreichen, und wenn dies erfolgreich ist,
stellen sie Ihr Zertifikat aus.

Für diese Methode müssen Sie einen _Proxy-Host_ für Ihre Domain(s) erstellen, der
über HTTP zugänglich ist und auf diese Nginx-Installation verweist. Nachdem ein Zertifikat
ausgestellt wurde, können Sie den _Proxy-Host_ so ändern, dass dieses Zertifikat auch für HTTPS-Verbindungen
verwendet wird. Der _Proxy-Host_ muss jedoch weiterhin für den HTTP-Zugriff konfiguriert sein,
 damit das Zertifikat erneuert werden kann.

Dieser Prozess unterstützt keine Wildcard-Domains.

### DNS-Zertifikat

Für ein DNS-validiertes Zertifikat müssen Sie ein DNS-Provider-Plugin verwenden. Dieser DNS-
Provider wird verwendet, um temporäre Einträge auf Ihrer Domain zu erstellen. Anschließend fragt Certbot
diese Einträge ab, um sicherzustellen, dass Sie der Eigentümer sind. Bei Erfolg wird
Ihr Zertifikat ausgestellt.

Sie müssen vor der Beantragung dieser Art von Zertifikat keinen _Proxy-Host_ erstellen.
Sie müssen Ihren _Proxy-Host_ auch nicht für den HTTP-Zugriff konfigurieren.

Dieser Prozess unterstützt Wildcard-Domains.

#### Gespeicherte DNS-Zugangsdaten

Die Zugangsdaten für Ihren DNS-Provider werden getrennt vom Zertifikat gespeichert, im
Tab _DNS-Zugangsdaten_ der Zertifikate-Seite. Ein Zertifikat wählt dann nur einen der
gespeicherten Zugangsdaten aus, sodass mehrere Zertifikate sie gemeinsam nutzen können.

Geheimnisse werden verschlüsselt gespeichert und nie wieder angezeigt. Wenn Sie Zugangsdaten bearbeiten,
lassen Sie ein Geheimnis leer, um den gespeicherten Wert zu behalten. Der Schlüssel für die Verschlüsselung ist die Datei
`/data/npmpro/dns-credentials.key`. Sichern Sie sie zusammen mit der Datenbank, sonst
können die gespeicherten Zugangsdaten nach einer Wiederherstellung nicht gelesen werden.

Provider ohne Formular verwenden das INI-Textfeld, in das Sie den Inhalt der
Zugangsdaten-Datei für diesen Provider einfügen.

### Benutzerdefiniertes Zertifikat

Verwenden Sie diese Option, um Ihr eigenes TLS-Zertifikat hochzuladen, das Ihnen von Ihrer eigenen
Zertifizierungsstelle bereitgestellt wurde.
