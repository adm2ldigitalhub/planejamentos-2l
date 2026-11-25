// Função do Supabase: lê a mensagem do lojista e escreve a legenda / textos de comunicado.
// Segredo necessário: ANTHROPIC_API_KEY. Opcional: ESTEIRA_MODELO (padrão claude-opus-5-5).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const client = new Anthropic(); // lê ANTHROPIC_API_KEY
const MODELO = Deno.env.get("ESTEIRA_MODELO") || "claude-opus-5-5";

const REGRAS = `Você trabalha na 2L Digital Hub, agência de marketing de lojas de carro de Londrina/PR.
Regras que nunca podem ser quebradas:
- Use só as informações que estão na mensagem do lojista e nos dados da loja. Nunca invente opcionais, número de donos, estado de conservação, garantia, revisões ou qualquer outro fato.
- Se um dado não foi informado, deixe o campo vazio ("").
- Português do Brasil.`;

const S = (d = "") => ({ type: "string", description: d });
const CARRO = {
  type: "object", additionalProperties: false,
  properties: {
    marca: S("em maiúsculas, nome completo: VOLKSWAGEN, CHEVROLET, FIAT, HONDA..."), modelo: S("só o modelo, maiúsculas: SAVEIRO, ONIX, CIVIC"),
    versao: S("versão/acabamento e motor se fizer parte do nome, maiúsculas: ROBUST 1.6, LTZ 1.4 TURBO"),
    ano: S("ex.: 2022/2023 ou 2020"), km: S("só números, ex.: 42000"), valor: S("só números, ex.: 66900"),
    cambio: S("Manual, Automático, CVT..."), motor: S("ex.: 1.6, 2.0 Turbo"), combustivel: S("Flex, Diesel, Gasolina, Elétrico, Híbrido"),
    detalhes: S("um destaque bem curto para a capa (até 3 palavras), só se a mensagem trouxer, ex.: Completo, Único dono"),
    destaques: { type: "array", items: { type: "string" }, description: "itens que o lojista citou (para a legenda), sem inventar" },
  },
  required: ["marca", "modelo", "versao", "ano", "km", "valor", "cambio", "motor", "combustivel", "detalhes", "destaques"],
};
const IMOVEL = {
  type: "object", additionalProperties: false,
  properties: {
    tipo_imovel: S("CASA, APARTAMENTO, TERRENO, SOBRADO..."), negocio: S("Venda ou Locação"), valor: S("só números"),
    bairro: S(), cidade: S("ex.: Londrina/PR"), condominio: S(), area: S("só números (m²)"), quartos: S(), suites: S(), banheiros: S(), vagas: S(),
    destaque: S("frase curta para a etiqueta, só se a mensagem trouxer"), destaques: { type: "array", items: { type: "string" } },
  },
  required: ["tipo_imovel", "negocio", "valor", "bairro", "cidade", "condominio", "area", "quartos", "suites", "banheiros", "vagas", "destaque", "destaques"],
};

async function perguntar(system: string, user: string, schema: Record<string, unknown>) {
  const r = await client.beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  } as any);
  if (r.stop_reason === "refusal") throw new Error("A IA recusou este pedido. Preencha à mão.");
  const txt = (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(txt);
}

// cadastro da loja (Templates > abrir a loja) que entra na legenda
function infoLoja(loja: any) {
  const d = loja?.dados || {};
  return [`Nome da loja: ${loja?.nome || ""}`, d.endereco && `Endereço: ${d.endereco}`, d.whatsapp && `WhatsApp: ${d.whatsapp}`,
    d.site && `Site/Instagram: ${d.site}`, d.slogan && `Slogan: ${d.slogan}`, d.emojis && `Emojis preferidos: ${d.emojis}`,
    d.cta && `CTA próprio da loja: ${d.cta}`, d.observacoes && `Observações e condições da loja: ${d.observacoes}`]
    .filter(Boolean).join("\n");
}
// instruções gerais da agência (Templates > Instruções da IA), lidas do banco a cada pedido
async function instrucoesAgencia() {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data } = await sb.from("esteira_config").select("data").eq("id", 1).maybeSingle();
  return String(data?.data?.instrucoes_legenda || "").trim();
}

// só quem tem a permissão "esteira" no 2L Core (Ajustes > Acessos) usa esta função
async function podeUsar(req: Request) {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data } = await sb.auth.getUser(jwt);
  const email = (data?.user?.email || "").toLowerCase();
  if (!email) return false;
  const { data: t } = await sb.from("team").select("perms").eq("email", email).maybeSingle();
  return !!t?.perms?.includes("esteira");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await podeUsar(req))) return json({ erro: "Seu login não tem acesso à esteira." }, 403);
  try {
    const body = await req.json();
    const acao = body.acao;

    if (acao === "anuncio" || acao === "vendido" || acao === "imovel") {
      const imovel = acao === "imovel", vendido = acao === "vendido";
      const modelo = (body.loja?.legenda_modelo || "").trim(), agencia = await instrucoesAgencia();
      const system = `${REGRAS}
${agencia ? `<instrucoes_da_agencia>\n${agencia}\n</instrucoes_da_agencia>
Como usar as instruções acima nesta plataforma:
- A loja já está cadastrada (dados abaixo): não peça cadastro nem faça perguntas.
- Devolva a legenda pronta no campo "legenda", só o texto que vai ser postado: sem bloco de código, sem comentários e sem o aviso de informações ausentes.
- As informações comerciais ausentes vão no campo "faltando" (o aviso interno), uma por item. Lista vazia se não faltar nada.
${vendido ? "- Este post é de VENDIDO (entrega do veículo ao cliente), não é anúncio: não use preço, pagamento, restrições comerciais nem opcionais. Escreva uma legenda curta de parabéns e agradecimento, com loja, WhatsApp e CTA, no tom da loja.\n" : ""}` : ""}
Tarefa: a partir da mensagem do lojista, extraia os dados do ${imovel ? "imóvel" : "veículo"} e escreva a legenda do post de ${vendido ? "VENDIDO (entrega do veículo ao cliente)" : "anúncio"} para Instagram/Facebook.
${modelo ? `Modelo e exemplos reais de legenda desta loja. Siga a estrutura, o tom, os emojis e as linhas fixas da loja (troque só o que é do ${imovel ? "imóvel" : "veículo"}; se um dado não existir, tire a linha). Varie o texto comercial e o CTA em relação aos exemplos:\n<modelo_de_legenda>\n${modelo}\n</modelo_de_legenda>` :
        agencia ? "Esta loja não tem modelo de legenda: use o modelo padrão das instruções da agência." : "Não há modelo de legenda cadastrado: escreva uma legenda curta e direta, com título em maiúsculas, valor, destaques informados e chamada para o WhatsApp."}
<dados_da_loja>
${infoLoja(body.loja)}
</dados_da_loja>`;
      const schema = { type: "object", additionalProperties: false, properties: { dados: imovel ? IMOVEL : CARRO, legenda: S("legenda pronta para postar"),
        faltando: { type: "array", items: { type: "string" }, description: "informações comerciais que faltaram na mensagem (aviso interno, não vai na legenda)" } }, required: ["dados", "legenda", "faltando"] };
      const out = await perguntar(system, `<mensagem_do_lojista>\n${body.mensagem || "(sem mensagem)"}\n</mensagem_do_lojista>`, schema);
      return json(out);
    }

    if (acao === "comunicado") {
      const lojas = (body.lojas || []) as any[];
      const system = `${REGRAS}
Tarefa: escrever o texto de um comunicado curto (2 a 4 frases, cabe num card de Instagram) para cada loja da lista, sobre o mesmo assunto.
Cada loja precisa de um texto diferente (outras palavras e outra ordem), mas com as mesmas informações. Não use emojis nem hashtags. Não invente horários ou informações que não estão no assunto.`;
      const user = `<assunto>\n${body.assunto}\n</assunto>\n<lojas>\n${lojas.map((l) => `id=${l.id} | nome=${l.nome}`).join("\n")}\n</lojas>`;
      const schema = { type: "object", additionalProperties: false, properties: { textos: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: S(), texto: S() }, required: ["id", "texto"] } } }, required: ["textos"] };
      const out = await perguntar(system, user, schema);
      return json({ textos: Object.fromEntries((out.textos || []).map((t: any) => [t.id, t.texto])) });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Anthropic.APIError ? `IA (${e.status}): ${e.message}` : String((e as Error)?.message || e) }, 500);
  }
});
