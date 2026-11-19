## Dostęp do API

Wszystkie tokeny API wszystkich użytkowników. Tę stronę widzą tylko administratorzy.

Tokeny tworzą ich właściciele w menu użytkownika, w sekcji **Tokeny API**. Tutaj widać każdy token z jego właścicielem, uprawnieniami, datą wygaśnięcia, ostatnim użyciem i datą utworzenia.

- **Unieważnij** zatrzymuje token natychmiast. Skrypty i asystenci AI, którzy go używają, dostają potem błąd uwierzytelniania.
- Token nigdy nie ma więcej uprawnień niż jego właściciel. Token administratora działa jako administrator tylko z włączonym przełącznikiem **Administrator**, a żaden token nie zarządza użytkownikami.
- Utworzenie, unieważnienie, wygaśnięcie i pierwsze użycie tokenu trafiają do dziennika audytu, z nazwą tokenu obok użytkownika.

**Dokumentacja API** otwiera w nowej karcie dokumentację API każdego punktu końcowego i pokazuje nagłówek, w którym wysyła się token. **Serwer MCP** pokazuje punkt końcowy, konfigurację dla Claude Code oraz dla Claude Desktop i innych klientów, a także narzędzia, z których może korzystać token.
