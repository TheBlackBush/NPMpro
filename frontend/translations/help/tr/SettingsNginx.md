## nginx

nginx'in kendisinin tüm host'lara uygulanan ayarları: kaç worker çalıştırdığı, TLS kuralları ve isteğe bağlı modüller. Kaydetmek yapılandırmayı sınar ve nginx'i yeniden yükler. Sınamayı geçemeyen bir yapılandırma uygulanmaz.

Konteynerde ayarlanmış bir değişken arayüze üstün gelir ve alanı kilitler (alan, "NGINX_WORKER_PROCESSES tarafından ayarlandı" gibi bir kilit rozeti gösterir). Konteynerde ayarlanmamış her şey için arayüzü kullanın. Buradaki her ayar, kaydetmenin çalıştırdığı nginx yeniden yüklemesinden sonra uygulanır.

### Worker'lar

- **Worker süreçleri**: "Otomatik (CPU iş parçacığı başına bir tane)" veya konteynerin gördüğü CPU iş parçacığı sayısına kadar bir sayı. Varsayılan: iş parçacığı başına bir tane, en çok 4. Değişken: `NGINX_WORKER_PROCESSES`.
- **Worker başına bağlantı**: her worker'ın aynı anda işlediği açık bağlantılar, 64 ila 65535. Varsayılan: 512. Değişken: `NGINX_WORKER_CONNECTIONS`.
- **Worker kapatma zaman aşımı**: eski worker'ların yeniden yüklemeden sonra bağlantılarını ne kadar süre tuttuğu. `30s`, `10m` veya `1h` gibi bir nginx süre değeri; `0` sınır yok demektir. Varsayılan: `1h`. Değişken: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Günlük kaydı

- **Dosya bulunamadı hatalarını günlüğe yaz**: eksik bir dosya için yapılan her istek için hata günlüğüne bir satır yazar. Varsayılan: kapalı. Değişken: `NGINX_LOG_NOT_FOUND`.

### Tüm host'lar için TLS

TLS 1.2'yi veya NIST P eğrilerini kapatmak eski tarayıcıları ve istemcileri dışarıda bırakır. TLS 1.3 her zaman açıktır.

- **TLS 1.2'ye izin ver**: varsayılan olarak açık. Değişken: `NGINX_DISABLE_TLS12` (ters: `true` TLS 1.2'yi kapatır).
- **Yalnızca kuantum sonrası anahtar değişimi**: yalnızca X25519MLKEM768'e izin verir; bunun için yeni bir istemci gerekir. Açıkken TLS 1.2'yi ve NIST P eğrilerini kapatır ve kilitler. Varsayılan: kapalı. Değişken: `NGINX_FORCE_X25519MLKEM768`.
- **NIST P eğrilerine izin ver**: X25519'un yanında anahtar değişimi için secp521r1, secp384r1 ve prime256v1. Varsayılan: açık. Değişken: `NGINX_TRUST_SECPR1`.
- **RSA PKCS#1 imzalarına izin ver**: RSA-PSS kullanamayan eski istemciler için. Varsayılan: kapalı. Değişken: `NGINX_TRUST_RSA_PKCS1`.

### Modüller

Hepsi varsayılan olarak kapalıdır. Bir modülü yalnızca özel yapılandırmanız ona ihtiyaç duyuyorsa açın. Özel bir yapılandırma hâlâ kullanırken bir modülü kapatmak nginx sınamasını başarısız kılar.

- **njs (JavaScript)**: `js_*` yönergeleri. Değişken: `NGINX_LOAD_NJS_MODULE`.
- **LDAP kimlik doğrulaması**: `auth_ldap` yönergeleri. Değişken: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM yukarı akışları**: upstream bloklarında `ntlm`. Değişken: `NGINX_LOAD_NTLM_MODULE`.
- **Sanal host trafik durumu**: `vhost_traffic_status_*` yönergeleri. Değişken: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Wiki'de devamı: Configuration.
