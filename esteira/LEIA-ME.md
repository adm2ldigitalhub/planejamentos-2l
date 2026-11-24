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
2. Abra a esteira, vá em **Lojas > Importar pacote de templates do computador** e escolha a pasta **esteira-2l**.
3. Clique em **Ligar pelo nome** e abra as lojas que ficaram "sem cliente" para escolher à mão.
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
- **Posts > + Novo lote**: arraste os ZIPs do WhatsApp, um por carro.
  - Confira a loja e o tipo de cada carro. A mensagem já vem do `_chat.txt` quando o ZIP tem o arquivo.
  - Escolha as fotos: a esteira já marca a capa e mais 8 fotos. Clique para marcar ou desmarcar e use "capa" para trocar a foto da arte. Só as marcadas são enviadas. A CTA entra sozinha no fim do carrossel.
  - Clique em **Criar lote**. As fotos sobem comprimidas e a IA lê as mensagens.
- **Posts**: clique no carro para revisar. Os status são Novo, Revisado, Salvo no Drive e Concluído. Os concluídos ficam escondidos (escolha "Todos, com concluídos" para ver). Clique no nome da coluna para ordenar.
  - Arraste e dê zoom na foto, troque a capa, confira os textos e a legenda. Tudo é salvo sozinho.
  - Em "Dados" aparecem só os campos que a arte da loja usa. Os outros ficam em "Outros dados" e só ajudam a legenda.
  - Só uma pessoa edita cada carro por vez. Os outros veem quem está editando.
  - Na barra de baixo: **Revisado ✓ e próximo** marca e já abre o próximo da lista; **← Anterior** e **Próximo →** só navegam.
  - A foto da capa já abre enquadrada: o veículo inteiro, com folga dos lados.
  - Marque vários posts (ou todos) para **mudar o status**, **Baixar (.zip)** ou **Salvar no Drive** de uma vez.
- **Comunicados**: escreva o assunto, busque e marque as lojas e revise em Posts.
- **Lojas**: busque a loja e clique para abrir a janela com o Drive, os contatos, o modelo de legenda e as artes.
- **Cliente novo (+ Template)**: escolha o cliente e a arte e suba três coisas: o PNG do Canva sem os textos e sem a foto (fundo transparente), o print da arte pronta e as fontes. Depois abre o **Ajustar textos**:
  - O print aparece por cima. Arraste cada texto até coincidir.
  - Use **+ Texto** para incluir marca e modelo, ano, KM, valor etc. e escolha fonte, peso, cor e alinhamento.
  - Em "Área da foto do carro", diga onde a foto entra.
  - Clique em **Salvar ajustes**.
