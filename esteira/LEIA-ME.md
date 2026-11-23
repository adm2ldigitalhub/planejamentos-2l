# Esteira de posts: como ligar

A esteira é uma área do 2L Core (aba **Esteira**, ou `/esteira/`). Ela usa o mesmo login e o mesmo
Supabase. Só aparece para quem tem **Esteira de posts** marcado em **Ajustes > Gerenciar acessos**. Configurar
lojas e templates é só para quem tem **Administrador**. A montagem das artes acontece no navegador, sem custo.
Só a leitura das mensagens e as legendas usam a IA, que é paga à parte e não sai do plano do Claude.

## 1. Banco (uma vez)
No Supabase, abra **SQL Editor > New query**, cole o conteúdo de `esteira/esteira.sql` e clique em **Run**.
Rode depois do `supabase.sql`, porque ele usa as permissões de lá. O script cria as tabelas da esteira e o
bucket privado `esteira`. Ele não mexe nas tabelas do planejamento.

## 2. Templates (uma vez, e de novo quando mudar alguma camada)
1. O pacote dos templates já foi gerado em 19/11 (pasta `esteira-2l/build`). Só precisa gerar de novo
   quando mudar alguma camada ou fonte. Para isso, rode dentro da pasta `esteira-2l` (precisa do Python instalado):

   ```
   python build/montar_templates.py
   python build/montar_fontes.py
   ```
2. Abra a esteira, vá em **Lojas e templates > Importar templates** e escolha a pasta **esteira-2l**.
3. Clique em **Vincular clientes pelo nome** e confira as lojas que ficaram sem cliente.
4. Abra cada loja e preencha os campos abaixo:
   - **ID da pasta do Drive**: o código no fim do link da pasta da loja.
   - **Subpastas**: por exemplo `04.CARROS/{MES_NUM}.{MES_NOME}/CARROS/{CARRO}`.
   - **Modelo de legenda**: cole uma legenda real da loja.
   - **Endereço, WhatsApp e site**.

Os ajustes de posição feitos na tela **Ajustar** ficam salvos: reimportar não apaga.

## 3. IA (Anthropic)
1. Entre em https://console.anthropic.com, coloque créditos (US$ 10 duram bastante) e crie uma **API key**.
2. Publique a função `esteira-ia`. Há dois jeitos:
   - **Pelo site do Supabase:** abra **Edge Functions > Deploy a new function > Via Editor**, use o nome
     `esteira-ia` e cole o conteúdo de `supabase/functions/esteira-ia/index.ts`.
   - **Pelo terminal:** `supabase functions deploy esteira-ia`.
3. Em **Edge Functions > Secrets**, crie o segredo `ANTHROPIC_API_KEY` com a chave.
4. Opcional: crie o segredo `ESTEIRA_MODELO` para trocar o modelo.
   - O padrão é `claude-opus-5-5`, que é o melhor e custa uns US$ 0,02 por carro.
   - `claude-haiku-5-5` sai bem mais barato, mas o texto fica mais simples.

## 4. Google Drive
Use o mesmo projeto do Google Cloud da Agenda.
1. **APIs e serviços > Biblioteca**: ative a **Google Drive API**.
2. **Credenciais > Criar credenciais > ID do cliente OAuth** do tipo **Aplicativo da Web**.
   - Em URIs de redirecionamento autorizados, coloque `https://developers.google.com/oauthplayground`.
   - Anote o ID do cliente e a chave secreta.
3. **Tela de consentimento**:
   - Adicione o escopo `https://www.googleapis.com/auth/drive`.
   - Mude o status de publicação para **Em produção**. Em modo de teste, a autorização vence em 7 dias.
     O Google vai mostrar o aviso de "app não verificado", e isso não tem problema, porque o app é só de vocês.
4. Em https://developers.google.com/oauthplayground:
   1. Na engrenagem, marque **Use your own OAuth credentials** e cole o ID e a chave.
   2. Em "Input your own scopes", escreva `https://www.googleapis.com/auth/drive` e clique em **Authorize APIs**.
      Entre com a conta Google que é **dona das pastas dos clientes no Drive**. Os arquivos vão ser salvos em nome dela.
   3. Clique em **Exchange authorization code for tokens** e copie o **Refresh token**.
5. Publique a função `esteira-drive` do mesmo jeito da IA, com o arquivo
   `supabase/functions/esteira-drive/index.ts`.
6. Crie os segredos `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REFRESH_TOKEN`.

## Como usar
- **Novo lote**: arraste os ZIPs do WhatsApp.
  - Para cada carro, confira a loja e o tipo. A mensagem já vem do `_chat.txt` quando o ZIP tem o arquivo.
  - Depois clique em **Criar lote**. As fotos sobem comprimidas e a IA lê as mensagens.
- **Fila**: clique no carro para revisar.
  - Arraste e dê zoom na foto, troque a foto da capa e confira os textos e a legenda.
  - Tudo é salvo sozinho.
  - Só uma pessoa edita cada carro por vez. Os outros veem quem está editando.
- **Saídas**: Baixar só a capa, Baixar carrossel (.zip) ou Salvar no Drive. O botão do Drive cria a pasta do mês e a do carro.
- **Comunicados**: escreva o assunto, marque as lojas e revise na fila.
- **Ajustar** (Lojas > abrir loja > Ajustar):
  - Coloque por cima a arte do Canva baixada em PNG.
  - Mova cada texto com as setas até coincidir e salve.
