## Apa itu Host Pengalihan?

Host Pengalihan mengirim pengunjung dari satu domain ke alamat lain. Gunakan saat sebuah situs berganti domain dan tautan lama harus tetap berfungsi, atau untuk mengarahkan `www` ke nama utama.

Gunakan **Duplikat** di menu host untuk menyalin host ke jendela Tambah baru. Salinan dimulai tanpa nama domain, karena sebuah domain hanya boleh dimiliki satu host yang aktif.

### Detail

- **Nama Domain**: nama yang dialihkan. Wajib diisi. Wildcard diizinkan untuk sertifikat baru hanya dengan tantangan DNS.
- **Skema**: skema tujuan. "pertahankan (sama dengan permintaan)" adalah default dan mempertahankan `http` atau `https` dari kunjungan. Atau pilih `http` atau `https`.
- **Domain Terusan**: domain tujuan pengunjung dikirim, misalnya `example.com`. Wajib diisi.
- **Kode HTTP**: kode respons. Default 301 Moved permanently. Pilihan lain: 302 Moved temporarily, 303 See other, 307 Temporary redirect, dan 308 Permanent redirect. Gunakan 301 atau 308 saat perpindahan bersifat permanen; browser dan mesin pencari mengingatnya.
- **Grup**: label bebas yang menjaga daftar panjang tetap rapi. Pilih yang sudah dipakai atau ketik nama baru.
- **Pertahankan Path** (nonaktif secara default): menambahkan path dan query asli ke tujuan. Jika aktif, `old.example/a?b=1` menuju `new.example/a?b=1`. Jika nonaktif, setiap pengunjung tiba di awal tujuan.

### TLS

- **Sertifikat TLS**: Tidak ada, Minta Sertifikat baru, atau sertifikat yang sudah ada. Opsi di bawah ini membutuhkan sertifikat.
- **Sertifikat mTLS**: otoritas sertifikat klien. **Jadikan mTLS Opsional** membiarkan pengunjung tanpa sertifikat klien masuk.
- **Paksa HTTPS**: mengalihkan HTTP ke HTTPS terlebih dahulu.
- **Dukungan HTTP/3**: mengizinkan HTTP/3 (QUIC).
- **HSTS Aktif (2 Tahun)**: membutuhkan Paksa HTTPS. **HSTS Subdomain+Preload** membutuhkan HSTS.
- Untuk sertifikat baru: **Gunakan Ulang Kunci (tidak disarankan)** dan **Gunakan DNS Challenge**, dengan penyedia, kredensial, dan detik propagasi.

Semua opsi TLS nonaktif secara default.

### Lanjutan

Konfigurasi nginx kustom yang ditambahkan di dalam blok server host. Hanya administrator yang dapat mengubahnya; pengguna lain melihatnya hanya-baca.

Selengkapnya di wiki: Host options.
