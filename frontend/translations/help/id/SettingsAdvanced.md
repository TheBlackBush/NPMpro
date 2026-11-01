## Lanjutan

Pengaturan yang mengubah perilaku NPMpro dengan cara kecil.

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan lencana kunci seperti "Diatur oleh TZ"). Gunakan UI untuk apa pun yang tidak diatur di container.

- **Zona waktu**: zona waktu container. Ini menentukan waktu di log, laporan GoAccess, dan tugas terjadwal seperti backup terjadwal. Gunakan nama seperti `Europe/Berlin`. Default: `UTC`. Variabel: `TZ`. Berlaku setelah container dimulai ulang: menyimpan akan menyimpannya, dan bagian ini mencantumkannya di bawah "Mulai ulang container untuk menerapkan".
- **Format konfigurasi nginx**: memformat konfigurasi yang ditulis NPMpro dengan nginxbeautifier. Matikan jika gagal pada konfigurasi kustom atau lanjutan yang tidak standar. Default: aktif. Variabel: `DISABLE_NGINX_BEAUTIFIER` (terbalik: `true` mematikan pemformatan). Berlaku seketika.
- **Gambar profil Gravatar**: menampilkan gambar Gravatar milik pengguna yang tidak punya avatar unggahan. Untuk mengambil gambar, NPMpro mengirim hash alamat email pengguna ke Gravatar, jadi matikan jika hal itu penting bagi Anda. Default: aktif. Variabel: `DISABLE_GRAVATAR` (terbalik: `true` mematikannya). Berlaku seketika; gambar pengguna berubah pada penyimpanan profil berikutnya, dan gambar yang sudah diambil tetap ada hingga saat itu.
