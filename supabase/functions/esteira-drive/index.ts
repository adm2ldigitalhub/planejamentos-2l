// Função do Supabase: cria as pastas e sobe as artes no Google Drive da agência.
// Quem mexe no Drive é o script do Google "Drive 2L" (drive/organizar-drive-2l.gs, função doPost),
// que roda como dono das pastas. O link do App da Web fica em esteira_config (data.drive_script_url).
// O script confere sozinho, com o login de quem pediu, se a pessoa tem acesso à Esteira.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function script(body: Record<string, unknown>, jwt: string) {
  const { data } = await admin().from("esteira_config").select("data").eq("id", 1).maybeSingle();
  const url = String(data?.data?.drive_script_url || "");
  if (!url) throw new Error("O Drive ainda não foi configurado (falta o link do script do Google).");
  const r = await fetch(url, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...body, jwt }) });
  const t = await r.text();
  let j: any;
  try { j = JSON.parse(t); } catch { throw new Error("O script do Drive não respondeu direito. Confira se a implantação é App da Web com acesso para qualquer pessoa."); }
  if (j.error) throw new Error("Drive: " + j.error);
  return j;
}

// só quem tem a permissão "esteira" no 2L Core (Ajustes > Acessos) usa esta função
const jwtDe = (req: Request) => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
async function podeUsar(req: Request) {
  const sb = admin();
  const { data } = await sb.auth.getUser(jwtDe(req));
  const email = (data?.user?.email || "").toLowerCase();
  if (!email) return false;
  const { data: t } = await sb.from("team").select("perms").eq("email", email).maybeSingle();
  return !!t?.perms?.includes("esteira");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await podeUsar(req))) return json({ erro: "Seu login não tem acesso à esteira." }, 403);
  try {
    const b = await req.json();
    if (b.acao === "pasta") {
      // caminho relativo à pasta do cliente, ex.: "06.CARROS/2026/11.NOVEMBRO/CARROS/VOLKSWAGEN SAVEIRO 2023"
      if (!b.base) throw new Error("Loja sem pasta base no Drive.");
      return json(await script({ acao: "pasta", base: String(b.base), caminho: String(b.caminho || "") }, jwtDe(req)));
    }
    if (b.acao === "arquivo") {
      return json(await script({ acao: "arquivo", pasta: String(b.pasta), nome: String(b.nome), mime: b.mime, base64: b.base64 }, jwtDe(req)));
    }
    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
