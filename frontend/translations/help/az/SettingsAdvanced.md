## Qabaqcıl

NPMpro-nun davranışını kiçik şəkildə dəyişən parametrlər.

Konteynerdə təyin edilmiş dəyişən UI-dan üstündür və sahəni kilidləyir (sahədə "TZ ilə təyin edilib" kimi kilid nişanı görünür). Konteynerdə təyin edilməyən hər şey üçün UI-dan istifadə edin.

- **Saat qurşağı**: konteynerin saat qurşağı. Jurnallardakı, GoAccess hesabatındakı və planlaşdırılmış ehtiyat nüsxələr kimi planlaşdırılmış işlərdəki vaxtları müəyyən edir. `Europe/Berlin` kimi ad istifadə edin. Standart: `UTC`. Dəyişən: `TZ`. Konteyner yenidən başladıldıqdan sonra tətbiq olunur: saxlama onu yadda saxlayır və bölmə onu "Tətbiq etmək üçün konteyneri yenidən başladın" altında göstərir.
- **nginx konfiqurasiyalarını formatla**: NPMpro-nun yazdığı konfiqurasiyaları nginxbeautifier ilə formatlayır. Qeyri-standart fərdi və ya qabaqcıl konfiqurasiyalarda xəta verirsə, söndürün. Standart: aktiv. Dəyişən: `DISABLE_NGINX_BEAUTIFIER` (tərsinə: `true` formatlamanı söndürür). Dərhal tətbiq olunur.
- **Gravatar profil şəkilləri**: yüklənmiş avatarı olmayan istifadəçilərin Gravatar şəklini göstərir. Şəkli almaq üçün NPMpro istifadəçinin e-poçt ünvanının heşini Gravatar-a göndərir, buna görə bu sizin üçün vacibdirsə, söndürün. Standart: aktiv. Dəyişən: `DISABLE_GRAVATAR` (tərsinə: `true` onu söndürür). Dərhal tətbiq olunur; istifadəçinin şəkli növbəti profil saxlanmasında dəyişir, əvvəlcədən alınmış şəkillər o vaxta qədər qalır.
