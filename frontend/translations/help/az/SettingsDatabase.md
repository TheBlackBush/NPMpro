## Verilənlər bazası

NPMpro-nun hostlarını, sertifikatlarını, istifadəçilərini, jurnallarını və statistikasını saxladığı verilənlər bazası. Standart olaraq bu, tək fayl olan SQLite-dir və tövsiyə olunan seçim budur. Buradan hər şeyi MySQL, MariaDB, PostgreSQL və ya yeni SQLite faylına köçürə bilərsiniz. İstifadədə olan verilənlər bazası köçürmə ilə dəyişmir.

### İstifadədəki verilənlər bazası

Mühərriki və versiyanı, yerləşdiyi yeri, ölçüsünü və bağlantının **Mənbə**sini göstərir: **Standart** (SQLite faylı `/data/npmpro/database.sqlite`), **Verilənlər bazası parametrləri faylı** (köçürmə ilə yazılan `/data/npmpro/database.json`) və ya **Mühit** (`DB_MYSQL_*` və ya `DB_POSTGRES_*` dəyişənləri). Köçürmədən sonra nə vaxt və hansı mühərrikdən köçdüyünüzü yazır.

### Cədvəllər

Hər cədvəl sətir sayı və ölçüsü ilə. Kartı yığmaq olar.

### Başqa verilənlər bazasına köç

Əvvəlcə serverinizdə boş verilənlər bazası və cədvəl yarada bilən istifadəçi yaradın; NPMpro verilənlər bazasını yaratmır. Tələblər: MySQL 8.0, MariaDB 10.6 və ya PostgreSQL 13 və daha yeni.

1. **Mühərrik** seçin və **Host**, **Port**, **Verilənlər bazasının adı**, **İstifadəçi** və **Parol** daxil edin. Server tələb edirsə, **TLS istifadə et** aktiv edin (MySQL və MariaDB üçün həmçinin **Server sertifikatını yoxla** və **Server adını yoxla** seçə bilərsiniz). SQLite-a köçürmə heç nə tələb etmir: `/data/npmpro` içində yeni fayl yaradır.
2. **Bağlantını yoxla**. O, versiyanı, verilənlər bazasının boş olduğunu və istifadəçinin cədvəl yarada bildiyini yoxlayır. Heç nəyi dəyişmir.
3. **Köçür**, sonra istənilən sözü yazın və **İndi köçür** düyməsinə basın.

NPMpro dəyişiklikləri dayandırır, təhlükəsizlik ehtiyat nüsxəsi yaradır, cədvəlləri yaradır, hər sətri kopyalayıb yoxlayır, sonra yeni verilənlər bazasında yenidən başlayır. Saytlarınız xidmət göstərməyə davam edir. NPMpro yenidən cavab verəndə səhifə yenilənir və yenidən daxil olmağınız lazım ola bilər.

Hər hansı addım uğursuz olarsa, NPMpro istifadə etdiyi verilənlər bazasında qalır və pəncərə dayanan addımı göstərir. Köhnə verilənlər bazası heç vaxt silinmir, buna görə geri qayıda bilərsiniz: `/data/npmpro/database.json` faylını silin və konteyneri yenidən başladın.

Bağlantı `DB_MYSQL_*` və ya `DB_POSTGRES_*` dəyişənlərindən gəlirsə, bölmə yalnız oxumaq üçündür. Köçmək üçün ehtiyat nüsxə yaradın, dəyişənləri yeni verilənlər bazasına yönəldin, yenidən başladın və ehtiyat nüsxəni bərpa edin.

Vikidə daha ətraflı: Database.
