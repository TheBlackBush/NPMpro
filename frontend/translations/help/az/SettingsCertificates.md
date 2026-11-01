## Sertifikatlar və TLS

NPMpro-nun ACME serverinizdən (başqasını `ACME_SERVER` ilə təyin etməsəniz, Let's Encrypt) tələb etdiyi sertifikatlar üçün standartlar, onların necə stapling edildiyi və yeniləndiyi və naməlum hostlar üçün hansı sertifikatın cavab verdiyi. Bu, Parametrlər bölməsidir, Sertifikatlar siyahı səhifəsi deyil.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "ACME_KEY_TYPE ilə təyin edilib" kimi kilid nişanı görünür). Bəzi sahələr başqasını izləyir: ECDSA əyrisi olan tək `ACME_KEY_SIZE` açar növünü ECDSA-da saxlayır, Must-Staple isə OCSP stapling-i aktiv saxlayır. Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin.

### Sertifikat sorğuları

Bunlar növbəti sertifikat sorğusundan tətbiq olunur.

- **Açar növü**: `ECDSA` (standart, tövsiyə olunur: kiçik açarlar, sürətli əl sıxma) və ya ECDSA-dan istifadə edə bilməyən klientlər üçün `RSA`. Dəyişən: `ACME_KEY_TYPE`.
- **Açar ölçüsü**: ECDSA üçün əyri (`secp256r1`, `secp384r1`, `secp521r1`; standart `secp384r1`) və ya RSA üçün bitlər (`2048`, `3072`, `4096`; standart `4096`). Dəyişən: `ACME_KEY_SIZE`.
- **ACME profili**: serverdən tələb olunan profil, saxlayanda server ilə yoxlanılır. Boş olduqda serverin standartı istifadə olunur. Let's Encrypt ilə standart `shortlived`-dir; Common Name tələb edən klientlər `shortlived` və `tlsserver` sertifikatları ilə işləmir. Dəyişən: `ACME_PROFILE` (boş üçün `none`).
- **OCSP Must-Staple**: yeni sertifikatları must-staple kimi işarələyir və OCSP stapling-i aktiv saxlayır. Yalnız onu dəstəkləyən CA-lar üçün (ZeroSSL); Let's Encrypt belə sorğuları rədd edir. Standart: Google Trust Services və ZeroSSL üçün aktiv, əks halda söndürülüb. Dəyişən: `ACME_MUST_STAPLE`.
- **ACME server sertifikatını yoxla**: standart aktivdir. Yalnız özü imzalı sertifikatı olan şəxsi ACME serveri üçün söndürün. Dəyişən: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Hər ikisi saxlamanın işlətdiyi nginx reload-undan sonra tətbiq olunur və hər ikisi TLS sertifikat sıxılmasını söndürür.

- **ACME sertifikatları üçün OCSP stapling**: CA OCSP təklif edirsə, ACME serverindən olan sertifikatlarla OCSP cavabını göndərir. Standart: Google Trust Services və ZeroSSL üçün aktiv, əks halda söndürülüb. Dəyişən: `ACME_OCSP_STAPLING`.
- **Fərdi sertifikatlar üçün OCSP stapling**: yüklənmiş sertifikatlar üçün eyni. Standart: söndürülüb. Dəyişən: `CUSTOM_OCSP_STAPLING`.

### Standart sertifikat

- **Naməlum hostlar və veb interfeys üçün sertifikat**: NPMpro-da hostu olmayan host adları üçün və veb interfeys portunda təqdim olunur. Standart: daxili, yaradılmış yertutan. Dəyişən: `DEFAULT_CERT_ID` (sertifikat ID-si; `0` daxilidir). Saxlamanın işlətdiyi nginx reload-undan sonra tətbiq olunur.

### Yeniləmə

- **Yeniləmə yoxlama intervalı**: yoxlamalar arasında 1-dən 499 saata qədər. Sertifikat yalnız vaxtı çatdıqda yenilənir. Standart: 3. Dəyişən: `CERTBOT_RUN_INTERVAL`. Dərhal tətbiq olunur.

### ECH

- **ECH açar rotasiyası intervalı**: ECH skriptinizin (`/data/tls/ech/cron.sh`) icraları arasında 1-dən 24 saata qədər. Yalnız skript boş olmadıqda istifadə olunur. Standart: 1. Dəyişən: `ECH_ROTATION_INTERVAL`. Dərhal tətbiq olunur.

Vikidə daha ətraflı: Security.
