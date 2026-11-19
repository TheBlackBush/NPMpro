## API-toegang

Alle API-tokens van alle gebruikers. Alleen beheerders zien deze pagina.

Tokens worden door hun eigenaren aangemaakt in het gebruikersmenu, onder **API-tokens**. Hier zie je elk token met zijn eigenaar, rechten, vervaldatum, laatste gebruik en aanmaakdatum.

- **Intrekken** stopt een token meteen. Scripts en AI-assistenten die het gebruiken krijgen daarna een authenticatiefout.
- Een token heeft nooit meer rechten dan zijn eigenaar. Het token van een beheerder werkt alleen als beheerder met zijn schakelaar **Beheerder**, en geen enkel token beheert gebruikers.
- Aanmaken, intrekken, verlopen en het eerste gebruik van een token komen in het auditlogboek, met de naam van het token naast de gebruiker.

**API-documentatie** opent de API-referentie van elk eindpunt in een nieuw tabblad en toont de header waarin een token wordt meegestuurd. **MCP-server** toont het eindpunt, de instelling voor Claude Code en voor Claude Desktop en andere clients, en de tools die een token kan gebruiken.
