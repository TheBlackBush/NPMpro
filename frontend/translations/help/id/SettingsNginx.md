## nginx

Pengaturan nginx itu sendiri yang berlaku untuk semua host: berapa banyak worker yang dijalankan, aturan TLS, dan modul opsional. Menyimpan menguji konfigurasi dan me-reload nginx. Konfigurasi yang gagal diuji tidak diterapkan.

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan lencana kunci seperti "Diatur oleh NGINX_WORKER_PROCESSES"). Gunakan UI untuk apa pun yang tidak diatur di container. Setiap pengaturan di sini berlaku setelah reload nginx yang dijalankan saat menyimpan.

### Worker

- **Proses worker**: "Otomatis (satu per thread CPU)" atau angka hingga jumlah thread CPU yang dilihat container. Default: satu per thread, paling banyak 4. Variabel: `NGINX_WORKER_PROCESSES`.
- **Koneksi per worker**: koneksi terbuka yang ditangani setiap worker sekaligus, 64 sampai 65535. Default: 512. Variabel: `NGINX_WORKER_CONNECTIONS`.
- **Batas waktu shutdown worker**: berapa lama worker lama mempertahankan koneksinya setelah reload. Nilai waktu nginx seperti `30s`, `10m` atau `1h`; `0` berarti tanpa batas. Default: `1h`. Variabel: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Pencatatan

- **Catat error file tidak ditemukan**: menulis baris log error untuk setiap permintaan file yang tidak ada. Default: nonaktif. Variabel: `NGINX_LOG_NOT_FOUND`.

### TLS untuk semua host

Mematikan TLS 1.2 atau kurva NIST P menutup akses browser dan klien yang lebih lama. TLS 1.3 selalu aktif.

- **Izinkan TLS 1.2**: default aktif. Variabel: `NGINX_DISABLE_TLS12` (terbalik: `true` mematikan TLS 1.2).
- **Hanya pertukaran kunci pasca-kuantum**: hanya mengizinkan X25519MLKEM768, yang membutuhkan klien terbaru. Ini mematikan TLS 1.2 dan kurva NIST P dan mengunci keduanya selama aktif. Default: nonaktif. Variabel: `NGINX_FORCE_X25519MLKEM768`.
- **Izinkan kurva NIST P**: secp521r1, secp384r1 dan prime256v1 untuk pertukaran kunci, di samping X25519. Default: aktif. Variabel: `NGINX_TRUST_SECPR1`.
- **Izinkan tanda tangan RSA PKCS#1**: untuk klien lama yang tidak dapat memakai RSA-PSS. Default: nonaktif. Variabel: `NGINX_TRUST_RSA_PKCS1`.

### Modul

Semuanya nonaktif secara default. Aktifkan modul hanya jika konfigurasi kustom Anda membutuhkannya. Mematikan modul saat konfigurasi kustom masih memakainya membuat pengujian nginx gagal.

- **njs (JavaScript)**: direktif `js_*`. Variabel: `NGINX_LOAD_NJS_MODULE`.
- **Autentikasi LDAP**: direktif `auth_ldap`. Variabel: `NGINX_LOAD_LDAP_MODULE`.
- **Upstream NTLM**: `ntlm` dalam blok upstream. Variabel: `NGINX_LOAD_NTLM_MODULE`.
- **Status lalu lintas virtual host**: direktif `vhost_traffic_status_*`. Variabel: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Selengkapnya di wiki: Configuration.
