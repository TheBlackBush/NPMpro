## Apa itu Daftar Akses?

Daftar Akses melindungi host proxy. Daftar ini dapat meminta nama pengguna dan kata sandi dari pengunjung (autentikasi Basic), mengizinkan atau menolak pengunjung berdasarkan alamat IP, atau keduanya. Berguna untuk layanan yang tidak punya login sendiri, atau saat Anda ingin menjaga klien tak dikenal tetap di luar.

Satu daftar dapat dipakai oleh banyak host proxy dan lokasi.

### Detail

- **Nama**: wajib diisi.
- **Penuhi Salah Satu** (nonaktif secara default): pengunjung masuk jika cocok dengan salah satu pemeriksaan, yaitu aturan atau pengguna yang valid. Jika nonaktif, pengunjung harus lolos keduanya. Opsi ini juga melewati Auth Request pada host tersebut.
- **Teruskan Auth ke Upstream** (nonaktif secara default): meneruskan header `Authorization` pengunjung ke layanan. Jika nonaktif, login tetap privat di NPMpro.

### Otorisasi

Tambahkan nama pengguna dan kata sandi. Nama pengguna harus unik dalam daftar dan tidak boleh berisi `:`. Saat mengedit daftar, biarkan kata sandi yang tersimpan kosong untuk mempertahankannya.

### Aturan

Aturan mengizinkan atau menolak alamat IP, rentang CIDR (`192.168.1.0/24`, `2001:db8::/32`) atau `unix:`. Aturan diterapkan sesuai urutan daftar, dan kecocokan pertama menang. Letakkan aturan yang spesifik lebih dulu. Aturan `all` terakhir menutup daftar, diatur untuk mengizinkan atau menolak; aturan ini ditambahkan hanya jika ada setidaknya satu aturan lain. Sebuah daftar membutuhkan setidaknya satu pengguna atau satu aturan.

### Penggunaan pada host proxy

Pada host proxy, pilih daftar di bawah **Daftar Akses Global** pada tab Detail: **Dapat Diakses Publik** (tanpa daftar) atau **Kustom**. Lokasi kustom dapat memakai **Global** (daftar milik host), **Dapat Diakses Publik** atau daftar **Kustom** miliknya sendiri.

Anda dapat melampirkan beberapa daftar ke satu host atau lokasi. Daftar diperiksa dari atas ke bawah, sesuai urutan yang ditampilkan, dan dapat dipindahkan ke atas atau ke bawah. **Penuhi Salah Satu** dan **Teruskan Auth ke Upstream** hanya berlaku pada daftar pertama. Dengan CrowdSec, IP yang diblokir melihat halaman blokir sebelum permintaan kata sandi.

Selengkapnya di wiki: Host options.
