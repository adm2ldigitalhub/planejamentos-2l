// Função do Supabase: cria as pastas e sobe os arquivos no Google Drive da agência.
// Segredos: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (conta Google dona das pastas dos clientes).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

let token: { v: string; exp: number } | null = null;
async function accessToken() {
  if (token && token.exp > Date.now() + 60000) return token.v;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google recusou o acesso: " + (j.error_description || j.error));
  token = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.v;
}
async function g(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await accessToken()}` } });
  const j = await r.json();
  if (!r.ok) throw new Error("Drive: " + (j.error?.message || r.status));
  return j;
}
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const FOLDER = "application/vnd.google-apps.folder";

async function pasta(pai: string, nome: string) {
  const busca = `name = '${q(nome)}' and '${q(pai)}' in parents and mimeType = '${FOLDER}' and trashed = false`;
  const r = await g(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(busca)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (r.files?.length) return r.files[0].id as string;
  const c = await g("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nome, mimeType: FOLDER, parents: [pai] }),
  });
  return c.id as string;
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
    const b = await req.json();
    if (b.acao === "pasta") {
      // caminho relativo à pasta base da loja, ex.: "11.NOVEMBRO/CARROS/VOLKSWAGEN SAVEIRO 2023"
      let id = String(b.base || "");
      if (!id) throw new Error("Loja sem pasta base no Drive.");
      for (const parte of String(b.caminho || "").split("/").map((s: string) => s.trim()).filter(Boolean)) id = await pasta(id, parte);
      return json({ id, url: `https://drive.google.com/drive/folders/${id}` });
    }
    if (b.acao === "arquivo") {
      const bytes = Uint8Array.from(atob(b.base64), (c) => c.charCodeAt(0));
      // substitui se já existir arquivo com o mesmo nome na pasta
      const busca = `name = '${q(b.nome)}' and '${q(b.pasta)}' in parents and trashed = false`;
      const ex = await g(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(busca)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
      const fd = new FormData();
      const meta: Record<string, unknown> = { name: b.nome };
      if (!ex.files?.length) meta.parents = [b.pasta];
      fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
      fd.append("file", new Blob([bytes], { type: b.mime || "application/octet-stream" }));
      const url = ex.files?.length
        ? `https://www.googleapis.com/upload/drive/v3/files/${ex.files[0].id}?uploadType=multipart&supportsAllDrives=true`
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
      const r = await g(url, { method: ex.files?.length ? "PATCH" : "POST", body: fd });
      return json({ id: r.id });
    }
    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
