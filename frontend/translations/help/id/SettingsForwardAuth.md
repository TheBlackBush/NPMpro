## Autentikasi forward

Autentikasi forward menempatkan login atau pemeriksaan bot di depan host proxy. Untuk setiap permintaan, nginx lebih dulu bertanya kepada layanan autentikasi apakah pengunjung boleh lewat. NPMpro memilikinya bawaan untuk Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, dan Authentik. Anda menjalankan penyedianya di container tersendiri.

Halaman ini mengatur alamat default (upstream) dari setiap penyedia. Host proxy mengaktifkan pemeriksaan dengan **Auth Request** di bawah Opsi pada tab Detail (atau pada lokasi kustom).

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan lencana kunci seperti "Diatur oleh AUTH_REQUEST_AUTHELIA_UPSTREAM"). Gunakan UI untuk apa pun yang tidak diatur di container. Setiap pengaturan di sini berlaku setelah reload nginx yang dijalankan saat menyimpan. Jika pengujian nginx gagal, tidak ada yang disimpan.

### Upstream default

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik**: dipakai oleh host proxy dengan penyedia itu yang tidak punya upstream sendiri. Nilai milik host sendiri lebih diutamakan. Default: kosong (tidak ada). Variabel: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Format: `scheme://host:port`, misalnya `http://127.0.0.1:9091`, atau `scheme://cu_name` untuk blok upstream nginx milik Anda yang namanya diawali `cu_`. Gunakan `http` atau `https`; port wajib; alamat IPv6 ditulis dalam tanda kurung siku. Tanpa path, tanpa spasi, dan tanpa salah satu dari `; { } # " ' $ \`.

Anda tidak dapat mengosongkan default selama host proxy memakai penyedia itu tanpa upstream sendiri. Pesan akan mencantumkan host tersebut.

Host yang memakai penyedia tanpa upstream di mana pun mendapat "Error konfigurasi".

### Anubis

- **Gambar Anubis kustom**: menampilkan `happy.webp`, `reject.webp`, dan `pensive.webp` milik Anda di halaman tantangan Anubis. Default: aktif jika ketiga file ada dan tidak kosong, selain itu nonaktif. Variabel: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Gambar disimpan di `public/anubis` dalam folder data Anda.

Selengkapnya di wiki: Forward-Authentication.
