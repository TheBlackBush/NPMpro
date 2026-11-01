## Giriş siyahısı nədir?

Giriş siyahısı proksi hostları qoruyur. Ziyarətçilərdən istifadəçi adı və parol (Basic autentifikasiya) tələb edə, ziyarətçilərə IP ünvanına görə icazə verə və ya onları rədd edə, yaxud hər ikisini edə bilər. Öz giriş mexanizmi olmayan xidmətlər üçün və ya naməlum klientləri kənarda saxlamaq istədiyiniz hallarda faydalıdır.

Bir siyahı çoxlu proksi host və məkan tərəfindən istifadə oluna bilər.

### Təfərrüatlar

- **Ad**: məcburidir.
- **İstənilən şərti ödə** (standart olaraq söndürülüb): ziyarətçi yoxlamalardan hər hansı birinə, yəni qaydaya və ya etibarlı istifadəçiyə uyğun gəldikdə daxil olur. Söndürülübsə, hər ikisindən keçməlidir. Bu, həmin hostda Auth Request-i də keçir.
- **Doğrulamanı yuxarı axına ötür** (standart olaraq söndürülüb): ziyarətçinin `Authorization` başlığını xidmətə ötürür. Söndürülübsə, giriş məlumatı NPMpro daxilində qalır.

### Səlahiyyətlər

İstifadəçi adları və parollar əlavə edin. İstifadəçi adları siyahı daxilində unikal olmalıdır və tərkibində `:` ola bilməz. Siyahını redaktə edərkən saxlanılmış parolu saxlamaq üçün onu boş buraxın.

### Qaydalar

Qaydalar IP ünvanına, CIDR aralığına (`192.168.1.0/24`, `2001:db8::/32`) və ya `unix:` seçiminə icazə verir və ya onu rədd edir. Onlar sizin göstərdiyiniz ardıcıllıqla tətbiq olunur və ilk uyğunluq qalib gəlir. Konkret qaydaları əvvələ qoyun. Yekun `all` qaydası siyahını bağlayır, icazə və ya rədd kimi təyin edilir; yalnız ən azı bir başqa qayda olduqda əlavə olunur. Siyahıda ən azı bir istifadəçi və ya bir qayda olmalıdır.

### Proksi hostlarda istifadə

Proksi hostda siyahını Təfərrüatlar tabında **Qlobal giriş siyahıları** altında seçin: **İctimai əlçatan** (siyahısız) və ya **Fərdi**. Fərdi məkan **Qlobal** (hostun siyahıları), **İctimai əlçatan** və ya öz **Fərdi** siyahılarını istifadə edə bilər.

Bir host və ya məkana bir neçə siyahı qoşa bilərsiniz. Onlar yuxarıdan aşağıya, göstərilən ardıcıllıqla yoxlanılır və onları yuxarı-aşağı köçürə bilərsiniz. **İstənilən şərti ödə** və **Doğrulamanı yuxarı axına ötür** yalnız birinci siyahıda nəzərə alınır. CrowdSec ilə qadağan olunmuş IP-lər parol sorğusundan əvvəl qadağa səhifəsini görür.

Vikidə daha ətraflı: Host options.
