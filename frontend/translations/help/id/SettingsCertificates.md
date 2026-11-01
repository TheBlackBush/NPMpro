## Sertifikat & TLS

Default untuk sertifikat yang diminta NPMpro dari server ACME Anda (Let's Encrypt kecuali Anda menetapkan yang lain dengan `ACME_SERVER`), bagaimana sertifikat di-staple dan diperbarui, serta sertifikat mana yang menjawab host yang tidak dikenal. Ini adalah bagian Pengaturan, bukan halaman daftar Sertifikat.

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan lencana kunci seperti "Diatur oleh ACME_KEY_TYPE"). Beberapa kolom mengikuti kolom lain: `ACME_KEY_SIZE` tunggal yang berupa kurva ECDSA menjaga jenis kunci tetap ECDSA, dan Must-Staple menjaga OCSP stapling tetap aktif. Gunakan UI untuk apa pun yang tidak diatur di container.

### Permintaan sertifikat

Ini berlaku mulai permintaan sertifikat berikutnya.

- **Jenis kunci**: `ECDSA` (default, disarankan: kunci lebih kecil, handshake lebih cepat) atau `RSA` untuk klien yang tidak dapat memakai ECDSA. Variabel: `ACME_KEY_TYPE`.
- **Ukuran kunci**: kurva untuk ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; default `secp384r1`) atau bit untuk RSA (`2048`, `3072`, `4096`; default `4096`). Variabel: `ACME_KEY_SIZE`.
- **Profil ACME**: profil yang diminta dari server, diperiksa dengan server saat Anda menyimpan. Kosong memakai default server. Dengan Let's Encrypt defaultnya adalah `shortlived`; klien yang membutuhkan Common Name tidak berfungsi dengan sertifikat `shortlived` dan `tlsserver`. Variabel: `ACME_PROFILE` (`none` untuk kosong).
- **OCSP Must-Staple**: menandai sertifikat baru sebagai must-staple dan menjaga OCSP stapling tetap aktif. Hanya untuk CA yang mendukungnya (ZeroSSL); Let's Encrypt menolak permintaan seperti itu. Default: aktif untuk Google Trust Services dan ZeroSSL, selain itu nonaktif. Variabel: `ACME_MUST_STAPLE`.
- **Verifikasi sertifikat server ACME**: default aktif. Matikan hanya untuk server ACME privat dengan sertifikat yang ditandatangani sendiri. Variabel: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Keduanya berlaku setelah reload nginx yang dijalankan saat menyimpan, dan keduanya mematikan kompresi sertifikat TLS.

- **OCSP stapling untuk sertifikat ACME**: mengirim respons OCSP bersama sertifikat dari server ACME, bila CA menawarkan OCSP. Default: aktif untuk Google Trust Services dan ZeroSSL, selain itu nonaktif. Variabel: `ACME_OCSP_STAPLING`.
- **OCSP stapling untuk sertifikat kustom**: sama untuk sertifikat yang diunggah. Default: nonaktif. Variabel: `CUSTOM_OCSP_STAPLING`.

### Sertifikat default

- **Sertifikat untuk host tidak dikenal dan UI web**: disajikan untuk nama host yang tidak punya host di NPMpro dan pada port UI web. Default: bawaan, yaitu placeholder yang dibuat otomatis. Variabel: `DEFAULT_CERT_ID` (ID sertifikat; `0` adalah bawaan). Berlaku setelah reload nginx yang dijalankan saat menyimpan.

### Perpanjangan

- **Interval pemeriksaan perpanjangan**: 1 sampai 499 jam antar pemeriksaan. Sertifikat diperpanjang hanya saat sudah waktunya. Default: 3. Variabel: `CERTBOT_RUN_INTERVAL`. Berlaku seketika.

### ECH

- **Interval rotasi kunci ECH**: 1 sampai 24 jam antar eksekusi skrip ECH Anda (`/data/tls/ech/cron.sh`). Dipakai hanya jika skrip tidak kosong. Default: 1. Variabel: `ECH_ROTATION_INTERVAL`. Berlaku seketika.

Selengkapnya di wiki: Security.
