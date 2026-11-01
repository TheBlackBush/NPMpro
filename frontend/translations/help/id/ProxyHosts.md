## Apa itu Host Proxy?

Host Proxy adalah pintu depan sebuah layanan web. Pengunjung membuka domain Anda di NPMpro, dan NPMpro meneruskan permintaan ke layanan di belakangnya. Host Proxy juga dapat menambahkan TLS (HTTPS) untuk layanan yang tidak memilikinya. Host Proxy adalah penggunaan NPMpro yang paling umum.

Gunakan **Duplikat** di menu host untuk menyalin host ke jendela Tambah baru. Salinan dimulai tanpa nama domain, karena sebuah domain hanya boleh dimiliki satu host yang aktif.

### Detail

- **Nama Domain**: nama yang dipakai pengunjung. Wajib diisi. Untuk sertifikat baru, wildcard (`*.example.com`) membutuhkan tantangan DNS.
- **Skema**: cara NPMpro berbicara dengan layanan: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (menyajikan file atau PHP dari sebuah folder) atau `empty` (tanpa upstream). Default `http://`. Mengubah skema menonaktifkan opsi yang tidak cocok dengannya.
- **Hostname / IP / Path Terusan**: alamat layanan. Anda dapat menambahkan sub path, misalnya `127.0.0.1/path`. Dengan `path`, masukkan sebuah folder. Pasang file Anda di bawah `/var/www`; hanya administrator yang dapat memakai folder di luarnya. Nama yang diawali `cu_` menunjuk ke blok upstream nginx milik Anda sendiri (lihat Load balancing di wiki).
- **Port Terusan**: opsional. Dengan `path` ini adalah versi PHP.
- **Grup**: label bebas yang menjaga daftar panjang tetap rapi.
- **Opsi** (semuanya nonaktif secara default):
  - **Kirim header noindex dan blokir beberapa user agent bot**: meminta mesin pencari tidak mengindeks situs dan memblokir beberapa crawler.
  - **Nonaktifkan CrowdSec AppSec**: mematikan CrowdSec AppSec hanya untuk host ini. Hanya berpengaruh jika AppSec sudah disiapkan.
  - **Nonaktifkan Buffering Permintaan** dan **Nonaktifkan Buffering Respons**: untuk upstream http dan https. Biarkan buffering tetap aktif kecuali Anda melakukan streaming atau mengunggah file besar melalui koneksi yang cepat dan stabil. Menonaktifkan buffering permintaan juga menonaktifkan AppSec.
  - **Aktifkan kompresi oleh upstream**: membiarkan layanan memampatkan responsnya sendiri. Biarkan nonaktif kecuali layanan membutuhkannya. Tidak untuk `path` dan `empty`.
  - **Aktifkan fancyindex**: menampilkan daftar file saat sebuah folder tidak punya file index. Hanya untuk `path`.
- **X-Frame-Options**: `SAMEORIGIN` (default), `DENY`, `none` (menghapus header) atau `upstream` (mempertahankan apa yang dikirim layanan).
- **Auth Request**: menempatkan login atau pemeriksaan bot di depan host (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Default `none`. **Upstream Auth Request** bersifat opsional; jika kosong memakai default dari Pengaturan, Autentikasi forward.
- **Daftar Akses Global**: **Dapat Diakses Publik** (default, tanpa login) atau **Kustom**, satu atau lebih Daftar Akses.

Websocket selalu aktif.

### Lokasi Kustom

Sebuah lokasi mengirim satu path dari host (misalnya `/api/`) ke layanan yang berbeda. Masing-masing memiliki **Diaktifkan**, sebuah path dengan jenis pencocokan opsional (`=`, `~`, `~*`, `^~` atau `@`), skema, host, port, opsi, Auth Request, dan daftar akses sendiri. Daftar aksesnya dapat berupa **Global**, yang memakai daftar milik host. Lokasi tidak mewarisi Auth Request milik host. Tambahkan garis miring di akhir path kecuali Anda ingin pencocokan prefiks. Administrator dapat menambahkan konfigurasi nginx kustom per lokasi dengan tombol roda gigi.

### TLS

- **Sertifikat TLS**: Tidak ada, Minta Sertifikat baru, atau sertifikat yang sudah ada. Opsi di bawah ini membutuhkan sertifikat.
- **Sertifikat mTLS**: otoritas sertifikat klien. **Jadikan mTLS Opsional** membiarkan pengunjung tanpa sertifikat masuk. **mTLS melewati Auth Request** membiarkan pengunjung dengan sertifikat valid melewati Auth Request.
- **Paksa HTTPS** mengalihkan HTTP ke HTTPS. **Dukungan HTTP/3** mengizinkan HTTP/3 (QUIC).
- **HSTS Aktif (2 Tahun)**: membutuhkan Paksa HTTPS. **HSTS Subdomain+Preload** membutuhkan HSTS.
- Untuk sertifikat baru: **Gunakan Ulang Kunci (tidak disarankan)** dan **Gunakan DNS Challenge**, dengan penyedia, kredensial, dan detik propagasi.

### Lanjutan

Konfigurasi nginx kustom untuk seluruh host (blok server) dan untuk lokasi utama `location /`. Hanya administrator yang dapat mengubahnya.

Selengkapnya di wiki: Host options.
