## Jaringan

Beri tahu NPMpro proxy mana di depannya yang dapat dipercaya soal alamat klien yang sebenarnya. Tanpa ini, log, daftar akses, dan CrowdSec melihat alamat proxy, bukan alamat pengunjung.

Variabel yang diatur pada container lebih diutamakan daripada UI dan mengunci kolom (kolom menampilkan lencana kunci seperti "Diatur oleh TRUST_IP"). Gunakan UI untuk apa pun yang tidak diatur di container.

- **IP proxy tepercaya**: satu alamat IPv4 atau IPv6 atau rentang CIDR per baris, misalnya `10.0.0.0/8`, `192.168.1.5` atau `fd00::/8`. Permintaan dari alamat ini boleh meneruskan IP klien sebenarnya di `X-Forwarded-For`. Gunakan untuk load balancer atau tunnel yang berada langsung di depan NPMpro. Default: kosong (tidak ada yang dipercaya). Variabel: `TRUST_IP` (dipisahkan spasi). Berlaku setelah reload nginx yang dijalankan saat menyimpan.
- **Percayai Cloudflare**: mengambil rentang IP Cloudflare, menyegarkannya secara berkala, dan memercayainya, sehingga nginx melihat IP klien sebenarnya di balik Cloudflare. Default: nonaktif. Variabel: `TRUST_CLOUDFLARE`. Berlaku setelah reload nginx yang dijalankan saat menyimpan. Baca dulu catatan tentang Cloudflare di wiki (Security): menempatkan Cloudflare di depan NPMpro memiliki biaya privasi dan keamanan.

Percayai hanya alamat yang Anda kendalikan atau andalkan sepenuhnya. Alamat tepercaya dapat mengaku sebagai pengunjung mana pun.

Jika penyimpanan gagal pada pengujian nginx, tidak ada yang disimpan dan pesan nginx ditampilkan.

Selengkapnya di wiki: Security.
