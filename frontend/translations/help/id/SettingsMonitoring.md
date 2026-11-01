## Log & pemantauan

File log, laporan log GoAccess, dan statistik lalu lintas di balik halaman Pemantauan.

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan lencana kunci seperti "Diatur oleh LOGROTATE", atau "Diatur oleh lingkungan" untuk statistik). Gunakan UI untuk apa pun yang tidak diatur di container. Pengaturan yang ditandai "Perlu dimulai ulang" disimpan seketika tetapi dibaca saat container dimulai; bagian ini lalu mencantumkannya di bawah "Mulai ulang container untuk menerapkan".

### File log

- **Tulis file log**: menulis log error, stream, dan access nginx ke `/data/nginx/logs` dan merotasinya setiap hari. Default: nonaktif. Variabel: `LOGROTATE`. Berlaku setelah reload nginx yang dijalankan saat menyimpan. Tetap aktif selama GoAccess berjalan.
- **Rotasi log yang disimpan**: berapa banyak file log hasil rotasi yang disimpan sebelum yang terlama dihapus, 1 sampai 1000. Default: 3. Variabel: `LOGROTATIONS`. Berlaku seketika.

### GoAccess

- **Laporan GoAccess**: menjalankan GoAccess, laporan log web untuk administrator, di bawah `/goaccess` pada UI web. Default: nonaktif. Variabel: `GOA`. Berlaku setelah container dimulai ulang. Ini tidak mengaktifkan statistik lalu lintas.

Saat laporan aktif, opsi berikut ditampilkan. Semuanya berlaku setelah container dimulai ulang. Satu variabel, `GOACLA`, menggantikan semuanya dengan opsi GoAccess Anda sendiri dan mengunci opsi tersebut.

- **Simpan data laporan**: 1 sampai 366 hari. Default: 30.
- **Anonimkan IP pengunjung**: Mati, Level 1 (default), Level 2 (kuat) atau Level 3 (ketat). Level 1 menyembunyikan byte terakhir IPv4 (64 bit terakhir IPv6), level 2 dua byte (80 bit), level 3 tiga byte (96 bit).
- **Buang query string**: menghapus query string dari URL di laporan, sehingga token dalam URL tidak disimpan. Default: aktif.
- **Versi sistem operasi lengkap**: menampilkan versi lengkap, bukan hanya keluarganya. Default: aktif.
- **Resolve nama host**: mencari nama host dari IP pengunjung. Ini mengirim kueri DNS untuknya. Default: aktif.

### Pemantauan

Bagian ini mengendalikan tab Lalu lintas pada halaman Pemantauan. Semuanya berlaku seketika saat disimpan. Variabel: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Statistik lalu lintas**: membaca access log nginx dan menghitung permintaan per host, status, negara, dan jaringan. Default: nonaktif. Mematikannya menghentikan penghitungan baru; statistik tersimpan tetap ada hingga kedaluwarsa, kecuali Anda mencentang "Hapus juga statistik yang tersimpan" di dialog.
- **Simpan statistik selama**: 7 sampai 365 hari. Default: 30. Data per menit disimpan selama 24 jam, data per jam selama sekian hari ini.
- **Tampilkan IP pengunjung**: menyimpan IP pengunjung per jam untuk mendaftar IP teratas. Default: nonaktif, demi privasi. Mematikannya menghapus IP yang tersimpan.
- **Hitung pengunjung unik**: menyimpan hash berkunci dari setiap IP pengunjung per host dan hari untuk menghitung pengunjung unik. Default: nonaktif. Mematikannya menghapus hash tersebut.
- **Batas pengunjung per host per hari**: 1000 sampai 1000000. Default: 100000. Host yang mencapainya berhenti menghitung pengunjung baru pada hari itu dan menampilkan tanda plus.

Negara dan jaringan membutuhkan database GeoIP (Pengaturan, GeoIP).

Selengkapnya di wiki: Monitoring.
