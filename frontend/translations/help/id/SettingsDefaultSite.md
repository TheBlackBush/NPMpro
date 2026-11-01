## Situs Default

Situs default adalah apa yang dijawab nginx saat pengunjung mencapai NPMpro dengan nama host yang tidak dipakai host mana pun, atau dengan alamat IP server. Pilih jawabannya di sini. Ini berlaku untuk semua nama yang tidak dikenal.

Menyimpan menguji pilihan baru dengan nginx terlebih dahulu. Jika pengujian gagal, tidak ada yang disimpan, situs default sebelumnya tetap dipakai, dan error nginx ada di log container.

- **Halaman Ucapan Selamat** (default): menampilkan halaman selamat datang NPMpro.
- **Halaman 404**: menjawab dengan halaman 404 Not Found.
- **Tidak Ada Respons (444)**: menutup koneksi tanpa jawaban apa pun. Gunakan untuk tidak memberi pemindai apa pun yang bisa dilihat. Permintaan HTTPS untuk nama tak dikenal ditolak saat handshake TLS.
- **Pengalihan**: mengirim pengunjung ke alamat lain dengan pengalihan sementara (302). Masukkan URL `http://` atau `https://` lengkap tanpa spasi, tanda kutip, atau `; { } #`, hingga 255 karakter.
- **HTML Kustom**: menampilkan halaman HTML Anda sendiri. **HTTP Status Code** di bawahnya bersifat opsional, dari 400 sampai 599. Biarkan kosong untuk 200 (OK).

Untuk setiap pilihan kecuali Tidak Ada Respons, permintaan ke nama tak dikenal lewat HTTP biasa lebih dulu dialihkan ke HTTPS, dan permintaan HTTPS memakai sertifikat yang dipilih sebagai **Sertifikat default** di Pengaturan, Sertifikat & TLS.

Bagian ini tidak memiliki variabel lingkungan, jadi perubahan berlaku saat Anda menyimpan.
