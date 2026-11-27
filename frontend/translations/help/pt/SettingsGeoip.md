## GeoIP

O NPMpro descarrega ele próprio bases de dados GeoIP gratuitas (DB-IP Lite ou MaxMind GeoLite2) e consulta países e redes no seu servidor, por isso os IPs dos visitantes nunca são enviados para lado nenhum. Não precisa de um contentor geoipupdate separado. As bases de dados alimentam o mapa e as listas da Monitorização, o GoAccess e as regras de país do nginx.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra "Definido pelo ambiente"). Use a interface para tudo o que não esteja definido no contentor. Ao guardar inicia-se o descarregamento em segundo plano, e o estado abaixo atualiza-se quando terminar.

### Fornecedor

- **DB-IP Lite** é a predefinição: gratuito, sem necessidade de conta, com novos ficheiros todos os meses (o NPMpro verifica uma vez por semana).
- **MaxMind GeoLite2** é mantido: requer uma conta gratuita e uma chave de licença e é atualizado duas vezes por semana.

Só um fornecedor está ativo de cada vez e só são usadas as suas bases de dados. Os ficheiros do outro fornecedor ficam no disco, por isso voltar atrás não exige nova descarga. O GoAccess aplica a mudança no próximo arranque do contentor. Variável: `GEOIP_PROVIDER` (`dbip` ou `maxmind`).

### Bases de dados DB-IP

- **Country**: países para o mapa, as listas de países e as regras de país das listas de acesso.
- **ASN**: redes (número AS e nome) para as listas de redes.

Ambas estão ativadas por predefinição. Variável: `GEOIP_DBIP_EDITIONS`.

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

Mostra a última atualização, a última verificação e o último erro. O NPMpro atualiza as bases de dados do fornecedor ativo quando altera o fornecedor, a conta ou as bases de dados, quando clica em **Atualizar agora** e automaticamente: MaxMind a cada 3 dias, DB-IP a cada 7 dias (o DB-IP publica novos ficheiros todos os meses e só é descarregado um ficheiro mais recente). Uma atualização automática falhada é repetida após 24 horas. Com o MaxMind, **Atualizar agora** precisa de um ID de conta e de uma chave de licença guardados; com o DB-IP, de pelo menos uma base de dados selecionada.

Sem bases de dados, o mapa e as listas de países e redes ficam ocultos; o resto funciona.

Mais na wiki: Monitoring.
