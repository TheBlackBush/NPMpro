## nginx

Bütün hostlara tətbiq olunan nginx-in öz parametrləri: neçə worker işlətdiyi, TLS qaydaları və ixtiyari modullar. Saxlamaq konfiqurasiyanı yoxlayır və nginx-i yenidən yükləyir. Testdən keçməyən konfiqurasiya tətbiq olunmur.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "NGINX_WORKER_PROCESSES ilə təyin edilib" kimi kilid nişanı görünür). Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin. Buradakı hər parametr saxlamanın işlətdiyi nginx reload-undan sonra tətbiq olunur.

### Worker-lər

- **Worker prosesləri**: "Avtomatik (hər CPU thread-i üçün bir)" və ya konteynerin gördüyü CPU thread-lərinə qədər bir rəqəm. Standart: hər thread üçün bir, ən çox 4. Dəyişən: `NGINX_WORKER_PROCESSES`.
- **Worker başına bağlantılar**: hər worker-in eyni anda idarə etdiyi açıq bağlantılar, 64-dən 65535-ə qədər. Standart: 512. Dəyişən: `NGINX_WORKER_CONNECTIONS`.
- **Worker dayandırma vaxt limiti**: reload-dan sonra köhnə worker-lərin bağlantılarını nə qədər saxladığı. `30s`, `10m` və ya `1h` kimi nginx vaxt dəyəri; `0` limitsiz deməkdir. Standart: `1h`. Dəyişən: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Jurnal

- **Fayl tapılmadı xətalarını jurnala yaz**: çatışmayan fayl üçün hər sorğuya error jurnal sətri yazır. Standart: söndürülüb. Dəyişən: `NGINX_LOG_NOT_FOUND`.

### Bütün hostlar üçün TLS

TLS 1.2 və ya NIST P əyrilərini söndürmək köhnə brauzerləri və klientləri kənarda qoyur. TLS 1.3 həmişə aktivdir.

- **TLS 1.2-yə icazə ver**: standart aktivdir. Dəyişən: `NGINX_DISABLE_TLS12` (tərsinə: `true` TLS 1.2-ni söndürür).
- **Yalnız post-kvant açar mübadiləsi**: yalnız X25519MLKEM768-ə icazə verir, bu da yeni klient tələb edir. O, TLS 1.2-ni və NIST P əyrilərini söndürür və aktiv olduğu müddətdə onları kilidləyir. Standart: söndürülüb. Dəyişən: `NGINX_FORCE_X25519MLKEM768`.
- **NIST P əyrilərinə icazə ver**: X25519-un yanında açar mübadiləsi üçün secp521r1, secp384r1 və prime256v1. Standart: aktiv. Dəyişən: `NGINX_TRUST_SECPR1`.
- **RSA PKCS#1 imzalarına icazə ver**: RSA-PSS istifadə edə bilməyən köhnə klientlər üçün. Standart: söndürülüb. Dəyişən: `NGINX_TRUST_RSA_PKCS1`.

### Modullar

Hamısı standart olaraq söndürülüb. Modulu yalnız fərdi konfiqurasiyanız ona ehtiyac duyduqda aktiv edin. Fərdi konfiqurasiya hələ də istifadə edərkən birini söndürmək nginx testini uğursuz edir.

- **njs (JavaScript)**: `js_*` direktivləri. Dəyişən: `NGINX_LOAD_NJS_MODULE`.
- **LDAP autentifikasiyası**: `auth_ldap` direktivləri. Dəyişən: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM upstream-ləri**: upstream bloklarında `ntlm`. Dəyişən: `NGINX_LOAD_NTLM_MODULE`.
- **Virtual host trafik statusu**: `vhost_traffic_status_*` direktivləri. Dəyişən: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Vikidə daha ətraflı: Configuration.
