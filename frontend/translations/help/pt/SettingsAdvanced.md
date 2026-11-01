## Avançado

Definições que alteram em pequenos aspetos o comportamento do NPMpro.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo com cadeado, como "Definido por TZ"). Use a interface para tudo o que não esteja definido no contentor.

- **Fuso horário**: o fuso horário do contentor. Define as horas nos registos, no relatório do GoAccess e nas tarefas agendadas, como os backups agendados. Use um nome como `Europe/Berlin`. Predefinição: `UTC`. Variável: `TZ`. Aplica-se após reiniciar o contentor: ao guardar fica memorizado e a secção lista-o em "Reinicie o contentor para aplicar".
- **Formatar configurações nginx**: formata as configurações que o NPMpro escreve, com o nginxbeautifier. Desative se falhar em configurações personalizadas ou avançadas fora do padrão. Predefinição: ativado. Variável: `DISABLE_NGINX_BEAUTIFIER` (invertida: `true` desativa a formatação). Aplica-se logo.
- **Imagens de perfil Gravatar**: mostra a imagem Gravatar dos utilizadores que não carregaram um avatar. Para obter uma imagem, o NPMpro envia ao Gravatar um hash do endereço de email do utilizador, por isso desative se isso lhe importar. Predefinição: ativado. Variável: `DISABLE_GRAVATAR` (invertida: `true` desativa). Aplica-se logo; a imagem de um utilizador muda na próxima vez que guardar o perfil, e as imagens já obtidas ficam até lá.
