## Backup dan pemulihan

Simpan host, sertifikat, pengguna, dan pengaturan Anda ke file `.npmpro`, lalu pulihkan pada instans NPMpro ini atau yang lain. Statistik lalu lintas dan log tidak pernah menjadi bagian dari backup.

### Buat backup

- **Yang akan disertakan**: bagian seperti host, daftar akses, sertifikat, kredensial DNS, pengguna, pengaturan, dan file kustom. Semuanya dicentang pada awalnya.
- **Sertakan rahasia**: menambahkan kunci privat, kata sandi, rahasia dua faktor, nilai kredensial DNS, client secret OIDC, dan kunci lisensi GeoIP. File dienkripsi dengan **Frasa sandi** minimal 12 karakter, yang Anda masukkan dua kali. NPMpro tidak menyimpannya, jadi tanpanya backup tidak dapat dipulihkan.
- Tanpa rahasia, file tidak dienkripsi dan tidak memuat rahasia. File tetap berisi nama host, pengguna, dan pengaturan, jadi jaga agar tetap privat.
- **Unduh** menyimpan file ke komputer Anda. **Simpan di server** menyimpannya di `/data/backups`.

### Backup terjadwal

Tambahkan jadwal yang membuat backup secara otomatis dan menyimpannya di server.

- **Kapan**: setiap N jam, harian, mingguan, atau bulanan, dalam zona waktu container.
- **Perlindungan**: **Frasa sandi** (dapat dipulihkan di mana saja), **Kunci instans** (tidak ada yang perlu diingat, hanya dapat dipulihkan pada instans ini) atau **Tanpa rahasia**.
- **Simpan**: berapa banyak file dari jadwal ini yang dipertahankan. Yang lebih lama dihapus setelah setiap eksekusi yang berhasil.
- Jadwal dapat dijalankan sekarang, dijeda, diedit, atau dihapus. Eksekusi yang gagal ditampilkan pada jadwal dan di dasbor.

Backup terjadwal melindungi Anda dari perubahan yang buruk, bukan dari hilangnya disk. Salin file ke mesin lain untuk itu.

### Backup tersimpan

Mencantumkan file di server. Unduh, pulihkan, atau hapus, atau **Unggah backup**. NPMpro membuat backup **Otomatis** sebelum setiap pemulihan, penggabungan, dan pemindahan database; backup ini tidak butuh frasa sandi dan hanya dapat dipulihkan pada instans ini.

### Pulihkan

- **Ganti** menukar bagian yang Anda pilih pada instans ini dengan yang ada di backup. Akun Anda sendiri tidak pernah diganti.
- **Gabungkan** menambahkan item dari backup dan tidak menghapus apa pun. Ini menampilkan pratinjau dan memungkinkan Anda memilih untuk setiap bentrokan: lewati, pakai item yang ada, tambahkan sebagai baru, atau ganti.

Pemulihan dibatalkan jika nginx menolak hasilnya. Backup dari versi NPMpro yang lebih baru tidak dapat dipulihkan. Beberapa pengaturan yang dipulihkan membutuhkan container dimulai ulang.

Bagian ini tidak memiliki variabel lingkungan.

Selengkapnya di wiki: Backup-and-restore.
