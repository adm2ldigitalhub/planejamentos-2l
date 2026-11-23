// Cria, altera e apaga os logins da plataforma. Só quem tem a permissão "acessos" consegue usar.
// Publique no Supabase com o nome "usuarios" (Edge Functions > Deploy a new function > Via Editor).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const PERMS = ["planejamentos", "clientes", "contratos", "esteira", "acessos"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // quem está pedindo
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await sb.auth.getUser(jwt);
    const me = (who?.user?.email || "").toLowerCase();
    if (!me) return json({ erro: "Entre de novo na plataforma." }, 401);
    const { data: mine } = await sb.from("team").select("perms").eq("email", me).maybeSingle();
    if (!mine?.perms?.includes("acessos")) return json({ erro: "Seu login não pode gerenciar acessos." }, 403);

    const b = await req.json().catch(() => ({}));
    const email = String(b.email || "").trim().toLowerCase();
    const nome = String(b.nome || "").trim().slice(0, 80);
    const perms = Array.isArray(b.perms) ? PERMS.filter((p) => b.perms.includes(p)) : [];
    const senha = String(b.senha || "");

    async function allUsers() {
      const out = [];
      for (let page = 1; ; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        out.push(...data.users);
        if (data.users.length < 1000) return out;
      }
    }
    const findUser = async (e: string) => (await allUsers()).find((u) => (u.email || "").toLowerCase() === e);
    const okEmail = /^\S+@\S+\.\S+$/.test(email);
    const okSenha = senha.length >= 8;

    switch (b.acao) {
      case "listar": {
        const [users, { data: team, error }] = await Promise.all([allUsers(), sb.from("team").select("email,nome,perms")]);
        if (error) throw error;
        const byEmail = new Map<string, Record<string, unknown>>();
        for (const t of team || []) byEmail.set(t.email.toLowerCase(), { email: t.email.toLowerCase(), nome: t.nome || "", perms: t.perms || [], login: false });
        for (const u of users) {
          const e = (u.email || "").toLowerCase();
          if (!e) continue;
          byEmail.set(e, { email: e, nome: "", perms: [], ...byEmail.get(e), login: true, ultimo: u.last_sign_in_at || null });
        }
        return json({ usuarios: [...byEmail.values()].sort((a, c) => String(a.email).localeCompare(String(c.email))), eu: me });
      }
      case "criar": {
        if (!okEmail) return json({ erro: "E-mail inválido." }, 400);
        if (!okSenha) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
        if (!(await findUser(email))) {
          const { error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
          if (error) throw error;
        } else {
          const u = await findUser(email);
          const { error } = await sb.auth.admin.updateUserById(u!.id, { password: senha });
          if (error) throw error;
        }
        const { error } = await sb.from("team").upsert({ email, nome, perms });
        if (error) throw error;
        return json({ ok: true });
      }
      case "salvar": {
        if (!okEmail) return json({ erro: "E-mail inválido." }, 400);
        if (email === me && !perms.includes("acessos")) return json({ erro: "Você não pode tirar o seu próprio acesso de administrador." }, 400);
        const { error } = await sb.from("team").upsert({ email, nome, perms });
        if (error) throw error;
        return json({ ok: true });
      }
      case "senha": {
        if (!okSenha) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
        const u = await findUser(email);
        if (!u) return json({ erro: "Esse e-mail ainda não tem login." }, 404);
        const { error } = await sb.auth.admin.updateUserById(u.id, { password: senha });
        if (error) throw error;
        return json({ ok: true });
      }
      case "excluir": {
        if (email === me) return json({ erro: "Você não pode excluir o seu próprio login." }, 400);
        const u = await findUser(email);
        if (u) {
          const { error } = await sb.auth.admin.deleteUser(u.id);
          if (error) throw error;
        }
        await sb.from("team").delete().eq("email", email);
        return json({ ok: true });
      }
      default:
        return json({ erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
