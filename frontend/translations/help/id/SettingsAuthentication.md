## Autentikasi

Login ke UI web NPMpro dengan penyedia OIDC (misalnya Authentik, Keycloak atau Google), di samping atau sebagai pengganti kata sandi. Ini bukan autentikasi forward: tidak melindungi host proxy Anda. Untuk itu lihat Pengaturan, Autentikasi forward.

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan "Diatur oleh lingkungan"). Jika keempat variabel koneksi semuanya diatur, OIDC aktif tanpa perlu diaktifkan di UI. Gunakan UI untuk apa pun yang tidak diatur di container. Semua yang ada di sini berlaku saat Anda menyimpan.

### Penyedia

- **Aktifkan login OIDC**: menampilkan tombol login di halaman login.
- **URL issuer**: alamat dasar discovery penyedia, misalnya `https://accounts.example.com`. Variabel: `OIDC_ISSUER_URL`.
- **Client ID** dan **Client secret**: dari penyedia Anda. Secret disimpan terenkripsi dan tidak pernah ditampilkan lagi; biarkan kosong untuk mempertahankannya. Jika Anda mengubah URL issuer atau client ID, masukkan secret lagi. Variabel: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Domain redirect**: domain yang dipakai orang untuk membuka NPMpro, dengan port jika bukan 443. Wajib diisi, karena domain ini membentuk URL callback. Variabel: `OIDC_REDIRECT_DOMAIN`.
- **URL callback**: hanya-baca. Daftarkan sebagai redirect URI di penyedia Anda.
- **Scope**: default `openid email profile`. Ubah jika penyedia Anda hanya mengizinkan sebagian, misalnya `openid email`.
- **Uji koneksi**: memeriksa bahwa NPMpro dapat menjangkau issuer.

### Tombol login

Tombol di halaman login: **Nama tampilan** (teks setelah "Masuk dengan"), **Warna** (preset atau `#rrggbb` Anda sendiri) dan **Ikon** (bawaan, diunggah sebagai PNG, JPEG, WebP atau SVG hingga 256 KB, atau diunduh dari URL). Pratinjau ditampilkan.

### Aturan login

- **Wajibkan email terverifikasi**: menolak pengguna yang emailnya belum diverifikasi penyedia. Default: aktif. Variabel: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Lewati dua faktor setelah OIDC**: memercayai pemeriksaan multi-faktor milik penyedia. Default: nonaktif. Variabel: `OIDC_SKIP_MFA`.
- **Nonaktifkan login kata sandi**: hanya OIDC yang dapat dipakai untuk masuk. Anda hanya dapat mengaktifkannya dari sesi yang masuk dengan OIDC. Variabel: `OIDC_DISABLE_PASSWORD`; untuk memulihkan login kata sandi, atur ke `false` dan buat ulang container.

### Pengguna baru

- **Buat pengguna saat login pertama** (default: nonaktif): orang tanpa akun mendapatkan akun dengan izin di bawah ini.
- **Domain email yang diizinkan**: dipisahkan koma; kosong berarti semua domain diizinkan. Dengan daftar kosong dan email terverifikasi tidak diwajibkan, siapa pun yang diterima penyedia Anda mendapatkan akun.
- **Izin default untuk pengguna baru**: diatur per bagian. Pengguna baru tidak pernah menjadi administrator.

Selengkapnya di wiki: Authentication.
