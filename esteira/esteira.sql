-- Esteira de posts (gerador de artes). Rode no Supabase: SQL Editor > New query > Run.
-- Pode rodar de novo quando for atualizado: não apaga nada. Usa as funções has_perm() e is_admin() do supabase.sql (rode ele antes).

-- Perfil de cada loja na esteira (liga ao cadastro de clientes do sistema)
create table if not exists esteira_lojas (
  nome text primary key,                       -- nome usado nos templates (ex.: WR VEICULOS)
  client_id uuid references clients(id) on delete set null,
  drive_pasta_id text default '',              -- pasta base da loja no Drive
  drive_padrao text default '{MES_NUM}.{MES_NOME}/CARROS/{CARRO}',  -- subpastas dentro da base
  legenda_modelo text default '',              -- exemplo de legenda da loja (a IA segue o formato)
  dados jsonb default '{}'::jsonb,             -- endereço, WhatsApp, site etc. (usados na legenda)
  ativo boolean default true,
  updated_at timestamptz default now()
);

-- Um registro por arte (FEED, CTA, VENDIDO FEED...) e variação (padrao, black...)
create table if not exists esteira_templates (
  id uuid primary key default gen_random_uuid(),
  loja text not null references esteira_lojas(nome) on update cascade on delete cascade,
  arte text not null,
  variacao text not null default 'padrao',
  tipo text not null,                          -- anuncio, vendido, comunicado, cta, site, imovel, fundo
  largura int not null default 1080,
  altura int not null default 1350,
  camada_path text not null,                   -- caminho no bucket "esteira"
  foto jsonb,                                  -- área da foto
  render jsonb default '{}'::jsonb,            -- composição especial (foto por cima, fundo...)
  caixas jsonb default '[]'::jsonb,            -- textos variáveis (posição, fonte, modelo)
  liberado boolean default true,
  bloqueio text,
  ajustado boolean default false,              -- caixas ajustadas na plataforma (reimportar não sobrescreve)
  updated_at timestamptz default now(),
  unique (loja, arte, variacao)
);
alter table esteira_templates add column if not exists ajustado boolean default false;

-- Configuração geral (mapa de fontes etc.)
create table if not exists esteira_config (
  id int primary key default 1,
  data jsonb default '{}'::jsonb
);
insert into esteira_config (id) values (1) on conflict do nothing;

-- Lotes e posts (um post = um carro, um vendido ou um comunicado)
create table if not exists esteira_lotes (
  id uuid primary key default gen_random_uuid(),
  nome text default '',
  criado_por text default (auth.jwt() ->> 'email'),
  created_at timestamptz default now()
);

create table if not exists esteira_posts (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid references esteira_lotes(id) on delete cascade,
  loja text not null references esteira_lojas(nome) on update cascade,
  tipo text not null default 'anuncio',        -- anuncio, vendido, comunicado
  variacao text not null default 'padrao',
  status text not null default 'novo',         -- novo, pronto, revisado, salvo, erro
  mensagem text default '',                    -- o que o lojista mandou
  dados jsonb default '{}'::jsonb,             -- marca, modelo, versao, ano, km, valor...
  textos jsonb default '{}'::jsonb,            -- textos da capa editados à mão (por caixa)
  legenda text default '',
  fotos jsonb default '[]'::jsonb,             -- [{path, w, h, nome}]
  capa int default 0,                          -- índice da foto da capa
  foto_pos jsonb,                              -- enquadramento da foto na capa {x,y,s}
  fotos_pos jsonb default '{}'::jsonb,         -- enquadramento das fotos soltas {indice:{x,y,s}}
  ordem jsonb,                                 -- ordem das fotos no carrossel
  erro text,
  drive_url text,
  editando_por text,
  editando_em timestamptz,
  criado_por text default (auth.jwt() ->> 'email'),
  atualizado_por text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists esteira_posts_lote on esteira_posts(lote_id);
create index if not exists esteira_posts_status on esteira_posts(status, created_at desc);

-- updated_at automático
create or replace function esteira_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.atualizado_por := coalesce(auth.jwt() ->> 'email', new.atualizado_por); return new; end $$;
drop trigger if exists esteira_posts_touch on esteira_posts;
create trigger esteira_posts_touch before update on esteira_posts for each row execute function esteira_touch();

-- "Pegar" um post para editar: só uma pessoa por vez (libera sozinho depois de 3 min sem sinal)
create or replace function esteira_pegar(pid uuid, forcar boolean default false) returns json
language plpgsql security invoker set search_path = public as $$
declare eu text := auth.jwt() ->> 'email'; r esteira_posts;
begin
  update esteira_posts set editando_por = eu, editando_em = now()
   where id = pid and (forcar or editando_por is null or editando_por = eu or editando_em < now() - interval '3 minutes')
   returning * into r;
  if r.id is null then
    select * into r from esteira_posts where id = pid;
    return json_build_object('ok', false, 'por', r.editando_por);
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function esteira_soltar(pid uuid) returns void
language sql security invoker set search_path = public as $$
  update esteira_posts set editando_por = null, editando_em = null
   where id = pid and editando_por = (auth.jwt() ->> 'email')
$$;

-- Segurança: só quem tem a permissão "esteira" (2L Core > Ajustes > Acessos). Lojas e templates: só administrador altera.
alter table esteira_lojas     enable row level security;
alter table esteira_templates enable row level security;
alter table esteira_config    enable row level security;
alter table esteira_lotes     enable row level security;
alter table esteira_posts     enable row level security;

drop policy if exists "le" on esteira_lojas;      create policy "le" on esteira_lojas for select to authenticated using (has_perm('esteira'));
drop policy if exists "admin" on esteira_lojas;   create policy "admin" on esteira_lojas for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "le" on esteira_templates;  create policy "le" on esteira_templates for select to authenticated using (has_perm('esteira'));
drop policy if exists "admin" on esteira_templates; create policy "admin" on esteira_templates for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "le" on esteira_config;     create policy "le" on esteira_config for select to authenticated using (has_perm('esteira'));
drop policy if exists "admin" on esteira_config;  create policy "admin" on esteira_config for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "equipe" on esteira_lotes;  create policy "equipe" on esteira_lotes for all to authenticated using (has_perm('esteira')) with check (has_perm('esteira'));
drop policy if exists "equipe" on esteira_posts;  create policy "equipe" on esteira_posts for all to authenticated using (has_perm('esteira')) with check (has_perm('esteira'));

-- Avisos em tempo real (quem está editando, posts que mudaram)
do $$ begin
  alter publication supabase_realtime add table esteira_posts;
exception when others then null; end $$;

-- Arquivos: bucket privado "esteira" (camadas, fontes e fotos dos lotes)
insert into storage.buckets (id, name, public) values ('esteira', 'esteira', false)
on conflict (id) do nothing;
drop policy if exists "esteira le" on storage.objects;
drop policy if exists "esteira envia" on storage.objects;
drop policy if exists "esteira atualiza" on storage.objects;
drop policy if exists "esteira apaga" on storage.objects;
create policy "esteira le"       on storage.objects for select to authenticated using (bucket_id = 'esteira' and has_perm('esteira'));
create policy "esteira envia"    on storage.objects for insert to authenticated
  with check (bucket_id = 'esteira' and ((storage.foldername(name))[1] = 'fotos' and has_perm('esteira') or is_admin()));
create policy "esteira atualiza" on storage.objects for update to authenticated
  using (bucket_id = 'esteira' and ((storage.foldername(name))[1] = 'fotos' and has_perm('esteira') or is_admin()));
create policy "esteira apaga"    on storage.objects for delete to authenticated
  using (bucket_id = 'esteira' and ((storage.foldername(name))[1] = 'fotos' and has_perm('esteira') or is_admin()));
