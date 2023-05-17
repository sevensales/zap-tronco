# Automação
- Respostas automáticas com randomização de mensagens (ver `messages.txt`)
- Guarda a data/horario da resposta no BD
- Reenvia mensagem apenas se houver contato após certo tempo
- Exclui grupos das respostas 



# API Endpoints
## GET
### `/chats` 
Retorna um JSON com todos os chats ativos

## POST
### `/message`
Envia uma mensagem e/ou arquivo para o numero especificado
#### Parametros
  - `number`: Numero do destinatario
  - `message` _(opcional)_: Texto da mensagem
  - `file` _(opcional)_: Arquivo a ser enviado
