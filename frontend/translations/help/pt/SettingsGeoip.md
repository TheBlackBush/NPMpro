## GeoIP

O NPMpro descarrega sozinho as bases de dados gratuitas MaxMind GeoLite2 e procura países e redes no seu servidor, por isso os IPs dos visitantes nunca são enviados para lado nenhum. Não precisa de um contentor geoipupdate separado. As bases de dados alimentam o mapa e as listas da Monitorização, o GoAccess e as regras de país do nginx.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra "Definido pelo ambiente"). Use a interface para tudo o que não esteja definido no contentor. Ao guardar inicia-se o descarregamento em segundo plano, e o estado abaixo atualiza-se quando terminar.

### Conta MaxMind

Precisa de uma conta MaxMind gratuita e de uma chave de licença (na MaxMind: Account, Manage license keys). Há uma ligação de registo na página.

- **ID da conta**: variável `GEOIP_ACCOUNT_ID`.
- **Chave de licença**: guardada cifrada e nunca mais mostrada. Se a chave guardada não puder ser decifrada, introduza-a de novo. Variável: `GEOIP_LICENSE_KEY`.

### Bases de dados

- **GeoLite2 Country**: países para o mapa, as listas de países e as regras de país do nginx. Ativada por predefinição.
- **GeoLite2 ASN**: redes (número e nome AS) para as listas de redes. Ativada por predefinição.
- **GeoLite2 City**: opcional, cidades para o GoAccess. Um descarregamento muito maior. Desativada por predefinição.

Variável: `GEOIP_EDITIONS`, separada por espaços, por exemplo `GeoLite2-Country GeoLite2-ASN`. Sem nenhuma base de dados selecionada, nada é descarregado nem atualizado, e as bases de dados já descarregadas são mantidas.

### Estado

Mostra a última atualização e o último erro. O NPMpro atualiza as bases de dados quando altera a conta ou as bases de dados, quando clica em **Atualizar agora** e automaticamente a cada 3 dias. Uma atualização automática falhada é tentada de novo passadas 24 horas. **Atualizar agora** precisa de um ID de conta e uma chave de licença guardados.

Sem bases de dados, o mapa e as listas de países e redes ficam ocultos; o resto funciona.

Mais na wiki: Monitoring.
