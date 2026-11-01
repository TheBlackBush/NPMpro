## Database

Database tempat NPMpro menyimpan host, sertifikat, pengguna, log, dan statistik. Secara default ini adalah SQLite, satu file, dan itulah pilihan yang disarankan. Dari sini Anda dapat memindahkan semuanya ke MySQL, MariaDB, PostgreSQL, atau file SQLite baru. Database yang sedang dipakai tidak diubah oleh pemindahan.

### Database yang digunakan

Menampilkan engine dan versi, lokasinya, ukurannya, dan **Sumber** koneksi: **Default** (file SQLite `/data/npmpro/database.sqlite`), **File pengaturan database** (`/data/npmpro/database.json`, ditulis oleh pemindahan) atau **Lingkungan** (variabel `DB_MYSQL_*` atau `DB_POSTGRES_*`). Setelah pemindahan, halaman menyebutkan kapan dan dari engine mana Anda pindah.

### Tabel

Setiap tabel dengan jumlah baris dan ukurannya. Kartu ini dapat diciutkan.

### Pindah ke database lain

Buat dulu database kosong dan pengguna yang dapat membuat tabel di server Anda; NPMpro tidak membuat database. Persyaratan: MySQL 8.0, MariaDB 10.6 atau PostgreSQL 13 atau lebih baru.

1. Pilih **Engine** dan masukkan **Host**, **Port**, **Nama database**, **Pengguna** dan **Kata sandi**. Aktifkan **Gunakan TLS** jika server membutuhkannya (untuk MySQL dan MariaDB Anda juga dapat **Periksa sertifikat server** dan **Periksa nama server**). Pemindahan ke SQLite tidak membutuhkan apa pun: ini membuat file baru di `/data/npmpro`.
2. **Uji koneksi**. Ini memeriksa versi, bahwa database kosong, dan bahwa pengguna dapat membuat tabel. Tidak ada yang diubah.
3. **Pindahkan**, lalu ketik kata yang diminta dan klik **Pindahkan sekarang**.

NPMpro menjeda perubahan, membuat backup pengaman, membuat tabel, menyalin dan memeriksa setiap baris, lalu memulai ulang pada database baru. Situs Anda tetap dilayani. Halaman dimuat ulang saat NPMpro menjawab lagi, dan Anda mungkin perlu masuk kembali.

Jika sebuah langkah gagal, NPMpro tetap memakai database yang dipakainya dan jendela menyebutkan langkah yang berhenti. Database lama tidak pernah dihapus, jadi Anda dapat kembali: hapus `/data/npmpro/database.json` dan mulai ulang container.

Jika koneksi berasal dari variabel `DB_MYSQL_*` atau `DB_POSTGRES_*`, bagian ini hanya-baca. Untuk pindah, buat backup, arahkan variabel ke database baru, mulai ulang, dan pulihkan backup.

Selengkapnya di wiki: Database.
