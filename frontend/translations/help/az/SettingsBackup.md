## Ehtiyat nüsxə və bərpa

Hostlarınızı, sertifikatlarınızı, istifadəçilərinizi və parametrlərinizi `.npmpro` faylına saxlayın və bu və ya başqa NPMpro instansiyasında bərpa edin. Trafik statistikası və jurnallar heç vaxt ehtiyat nüsxəyə daxil olmur.

### Ehtiyat nüsxə yarat

- **Nələr daxil edilsin**: hostlar, giriş siyahıları, sertifikatlar, DNS etibarnamələri, istifadəçilər, parametrlər və fərdi fayllar kimi hissələr. Əvvəlcə hamısı seçilib.
- **Gizli məlumatları daxil et**: şəxsi açarları, parolları, iki faktorlu secret-ləri, DNS etibarnamə dəyərlərini, OIDC client secret-i və GeoIP lisenziya açarını əlavə edir. Fayl iki dəfə daxil etdiyiniz ən azı 12 simvollu **Parol ifadəsi** ilə şifrələnir. NPMpro onu saxlamır, buna görə onsuz ehtiyat nüsxəni bərpa etmək mümkün deyil.
- Gizli məlumatlar olmadan fayl şifrələnmir və gizli məlumatları buraxır. Yenə də host adlarını, istifadəçiləri və parametrləri ehtiva edir, buna görə onu gizli saxlayın.
- **Endir** faylı kompüterinizə saxlayır. **Serverdə saxla** onu `/data/backups` qovluğunda saxlayır.

### Planlaşdırılmış ehtiyat nüsxələr

Özbaşına ehtiyat nüsxə yaradan və onları serverdə saxlayan cədvəllər əlavə edin.

- **Nə vaxt**: hər N saatdan bir, gündəlik, həftəlik və ya aylıq, konteynerin saat qurşağında.
- **Qoruma**: **Parol ifadəsi** (hər yerdə bərpa olunur), **İnstansiya açarı** (heç nəyi yadda saxlamaq lazım deyil, yalnız bu instansiyada bərpa olunur) və ya **Gizli məlumatlar olmadan**.
- **Saxla**: bu cədvəldən neçə faylın saxlanılacağı. Hər uğurlu icradan sonra köhnələri silinir.
- Cədvəli indi işlətmək, dayandırmaq, redaktə etmək və ya silmək olar. Uğursuz icra cədvəldə və idarə panelində göstərilir.

Planlaşdırılmış ehtiyat nüsxələr sizi pis dəyişikliklərdən qoruyur, diskin itirilməsindən yox. Bunun üçün faylları başqa maşına kopyalayın.

### Saxlanılmış ehtiyat nüsxələr

Serverdəki faylları göstərir. Onları endirin, bərpa edin və ya silin, yaxud **Ehtiyat nüsxə yüklə**. NPMpro hər bərpa, birləşdirmə və verilənlər bazası köçürməsindən əvvəl **Avtomatik** ehtiyat nüsxə yaradır; ona parol ifadəsi lazım deyil və yalnız bu instansiyada bərpa olunur.

### Bərpa

- **Əvəz et** bu instansiyada seçdiyiniz hissələri ehtiyat nüsxədəkilərlə əvəz edir. Öz hesabınız heç vaxt əvəz olunmur.
- **Birləşdir** ehtiyat nüsxənin elementlərini əlavə edir və heç nəyi silmir. O, önizləmə göstərir və hər toqquşma üçün seçim etməyə imkan verir: keç, mövcud elementi istifadə et, yeni kimi əlavə et və ya əvəz et.

Nəticəni nginx rədd edərsə, bərpa geri qaytarılır. Daha yeni NPMpro versiyasından olan ehtiyat nüsxə bərpa oluna bilməz. Bəzi bərpa edilmiş parametrlər konteynerin yenidən başladılmasını tələb edir.

Bu bölmənin mühit dəyişənləri yoxdur.

Vikidə daha ətraflı: Backup-and-restore.
