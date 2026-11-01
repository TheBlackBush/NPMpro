## Sertifikalar ve TLS

NPMpro'nun ACME sunucunuzdan istediği sertifikaların (`ACME_SERVER` ile başka bir sunucu ayarlamadıkça Let's Encrypt), bunların nasıl zımbalandığının (stapling) ve yenilendiğinin ve bilinmeyen host'lar için hangi sertifikanın yanıt vereceğinin varsayılanları. Bu, Ayarlar bölümüdür; Sertifikalar liste sayfası değildir.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan, "ACME_KEY_TYPE tarafından ayarlandı" gibi bir kilit rozeti gösterir). Bazı alanlar bir başkasını izler: bir ECDSA eğrisi olan tek başına `ACME_KEY_SIZE` anahtar türünü ECDSA'da tutar, Must-Staple ise OCSP stapling'i açık tutar. Konteynerde ayarlanmamış her şey için arayüzü kullanın.

### Sertifika istekleri

Bunlar bir sonraki sertifika isteğinden itibaren uygulanır.

- **Anahtar türü**: `ECDSA` (varsayılan, önerilir: daha küçük anahtarlar, daha hızlı el sıkışmalar) veya ECDSA kullanamayan istemciler için `RSA`. Değişken: `ACME_KEY_TYPE`.
- **Anahtar boyutu**: ECDSA için eğri (`secp256r1`, `secp384r1`, `secp521r1`; varsayılan `secp384r1`) veya RSA için bit sayısı (`2048`, `3072`, `4096`; varsayılan `4096`). Değişken: `ACME_KEY_SIZE`.
- **ACME profili**: sunucudan istenen profil; kaydettiğinizde sunucuyla denetlenir. Boş bırakılırsa sunucu varsayılanı kullanılır. Let's Encrypt ile varsayılan `shortlived`'dır; Common Name gerektiren istemciler `shortlived` ve `tlsserver` sertifikalarıyla çalışmaz. Değişken: `ACME_PROFILE` (boş için `none`).
- **OCSP Must-Staple**: yeni sertifikaları must-staple olarak işaretler ve OCSP stapling'i açık tutar. Yalnızca bunu destekleyen CA'lar için (ZeroSSL); Let's Encrypt bu tür istekleri reddeder. Varsayılan: Google Trust Services ve ZeroSSL için açık, aksi halde kapalı. Değişken: `ACME_MUST_STAPLE`.
- **ACME sunucusu sertifikasını doğrula**: varsayılan olarak açık. Yalnızca kendinden imzalı sertifikası olan özel bir ACME sunucusu için kapatın. Değişken: `ACME_SERVER_TLS_VERIFY`.

### Stapling

İkisi de kaydetmenin çalıştırdığı nginx yeniden yüklemesinden sonra uygulanır ve ikisi de TLS sertifika sıkıştırmasını kapatır.

- **ACME sertifikaları için OCSP stapling**: CA OCSP sunuyorsa ACME sunucusundan alınan sertifikalarla birlikte OCSP yanıtını gönderir. Varsayılan: Google Trust Services ve ZeroSSL için açık, aksi halde kapalı. Değişken: `ACME_OCSP_STAPLING`.
- **Özel sertifikalar için OCSP stapling**: yüklenen sertifikalar için aynısı. Varsayılan: kapalı. Değişken: `CUSTOM_OCSP_STAPLING`.

### Varsayılan sertifika

- **Bilinmeyen host'lar ve web arayüzü için sertifika**: NPMpro'nun host'u olmayan host adları için ve web arayüzü portunda sunulur. Varsayılan: yerleşik, oluşturulmuş bir yer tutucu. Değişken: `DEFAULT_CERT_ID` (bir sertifika kimliği; `0` yerleşik olandır). Kaydetmenin çalıştırdığı nginx yeniden yüklemesinden sonra uygulanır.

### Yenileme

- **Yenileme kontrol aralığı**: denetimler arasında 1 ila 499 saat. Bir sertifika yalnızca zamanı geldiğinde yenilenir. Varsayılan: 3. Değişken: `CERTBOT_RUN_INTERVAL`. Hemen uygulanır.

### ECH

- **ECH anahtar döndürme aralığı**: ECH betiğinizin (`/data/tls/ech/cron.sh`) çalıştırmaları arasında 1 ila 24 saat. Yalnızca betik boş değilse kullanılır. Varsayılan: 1. Değişken: `ECH_ROTATION_INTERVAL`. Hemen uygulanır.

Wiki'de devamı: Security.
