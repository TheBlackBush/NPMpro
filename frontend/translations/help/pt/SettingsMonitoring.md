## Registos e monitorização

Ficheiros de registo, o relatório de registos GoAccess e as estatísticas de tráfego por trás da página Monitorização.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo com cadeado, como "Definido por LOGROTATE", ou "Definido pelo ambiente" nas estatísticas). Use a interface para tudo o que não esteja definido no contentor. As definições marcadas "Reinício necessário" são guardadas logo mas lidas quando o contentor arranca; a secção lista-as depois em "Reinicie o contentor para aplicar".

### Ficheiros de registo

- **Escrever ficheiros de registo**: escreve os registos de erro, stream e acesso do nginx em `/data/nginx/logs` e roda-os diariamente. Predefinição: desativado. Variável: `LOGROTATE`. Aplica-se após o reload do nginx que o guardar executa. Fica ativado enquanto o GoAccess estiver a correr.
- **Rotações de registo mantidas**: quantos ficheiros de registo rodados são mantidos antes de o mais antigo ser eliminado, de 1 a 1000. Predefinição: 3. Variável: `LOGROTATIONS`. Aplica-se logo.

### GoAccess

- **Relatório GoAccess**: executa o GoAccess, um relatório de registos web para administradores, em `/goaccess` da interface web. Predefinição: desativado. Variável: `GOA`. Aplica-se após reiniciar o contentor. Não ativa as estatísticas de tráfego.

Com o relatório ativado, aparecem estas opções. Todas se aplicam após reiniciar o contentor. Uma só variável, `GOACLA`, substitui-as todas pelas suas próprias opções do GoAccess e bloqueia-as.

- **Manter dados do relatório**: 1 a 366 dias. Predefinição: 30.
- **Anonimizar IPs dos visitantes**: Off, Level 1 (predefinição), Level 2 (strong) ou Level 3 (pedantic). O nível 1 oculta o último byte IPv4 (os últimos 64 bits do IPv6), o nível 2 dois bytes (80 bits), o nível 3 três bytes (96 bits).
- **Remover query strings**: remove as query strings dos URLs no relatório, para que os tokens nos URLs não sejam guardados. Predefinição: ativado.
- **Versões completas do sistema operativo**: mostra a versão completa, não só a família. Predefinição: ativado.
- **Resolver nomes de host**: procura os nomes de host dos IPs dos visitantes. Isto envia consultas DNS para eles. Predefinição: ativado.

### Monitorização

Controlam o separador Tráfego da página Monitorização. Todas se aplicam logo ao guardar. Variáveis: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Estatísticas de tráfego**: lê o registo de acesso do nginx e conta pedidos por host, estado, país e rede. Predefinição: desativado. Desativar pára a nova contagem; as estatísticas guardadas ficam até expirarem, a não ser que marque "Eliminar também as estatísticas guardadas" na janela.
- **Manter estatísticas durante**: 7 a 365 dias. Predefinição: 30. Os dados por minuto são mantidos 24 horas, os dados por hora durante este número de dias.
- **Mostrar IPs dos visitantes**: guarda os IPs dos visitantes por hora para listar os IPs principais. Predefinição: desativado, por privacidade. Desativar elimina os IPs guardados.
- **Contar visitantes únicos**: guarda um hash com chave de cada IP de visitante por host e dia para contar visitantes únicos. Predefinição: desativado. Desativar elimina os hashes.
- **Limite de visitantes por host e dia**: 1000 a 1000000. Predefinição: 100000. Um host que o atinja deixa de contar novos visitantes nesse dia e mostra um sinal de mais.

Países e redes precisam das bases de dados GeoIP (Definições, GeoIP).

Mais na wiki: Monitoring.
