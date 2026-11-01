## GeoIP

NPMpro mengunduh sendiri database MaxMind GeoLite2 yang gratis dan mencari negara serta jaringan di server Anda, sehingga IP pengunjung tidak pernah dikirim ke mana pun. Anda tidak membutuhkan container geoipupdate terpisah. Database ini mendukung peta dan daftar Pemantauan, GoAccess, dan aturan negara nginx.

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan "Diatur oleh lingkungan"). Gunakan UI untuk apa pun yang tidak diatur di container. Menyimpan memulai pengunduhan di latar belakang, dan status di bawah diperbarui saat selesai.

### Akun MaxMind

Anda membutuhkan akun MaxMind gratis dan kunci lisensi (di MaxMind: Account, Manage license keys). Ada tautan pendaftaran di halaman.

- **ID akun**: variabel `GEOIP_ACCOUNT_ID`.
- **Kunci lisensi**: disimpan terenkripsi dan tidak pernah ditampilkan lagi. Jika kunci yang tersimpan tidak dapat didekripsi, masukkan lagi. Variabel: `GEOIP_LICENSE_KEY`.

### Database

- **GeoLite2 Country**: negara untuk peta, daftar negara, dan aturan negara nginx. Aktif secara default.
- **GeoLite2 ASN**: jaringan (nomor dan nama AS) untuk daftar jaringan. Aktif secara default.
- **GeoLite2 City**: opsional, kota untuk GoAccess. Unduhan yang jauh lebih besar. Nonaktif secara default.

Variabel: `GEOIP_EDITIONS`, dipisahkan spasi, misalnya `GeoLite2-Country GeoLite2-ASN`. Jika tidak ada database yang dipilih, tidak ada yang diunduh atau diperbarui, dan database yang sudah diunduh tetap disimpan.

### Status

Menampilkan pembaruan terakhir dan error terakhir. NPMpro memperbarui database saat Anda mengubah akun atau database, saat Anda mengklik **Perbarui sekarang**, dan otomatis setiap 3 hari. Pembaruan otomatis yang gagal dicoba lagi setelah 24 jam. **Perbarui sekarang** membutuhkan ID akun dan kunci lisensi yang tersimpan.

Tanpa database, peta serta daftar negara dan jaringan disembunyikan; sisanya berfungsi.

Selengkapnya di wiki: Monitoring.
