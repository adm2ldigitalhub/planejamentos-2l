-- Rode este script inteiro no Supabase: SQL Editor > New query > Run
-- Pode rodar de novo sempre que ele for atualizado: nada que já existe é apagado.

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  calendar_name text default '',
  plan text default 'Personalizado',
  videos int default 0,
  arts int default 0,
  traffic boolean default false,
  social boolean default true,
  created_at timestamptz default now()
);
-- o que a equipe toda vê na ficha do cliente
alter table clients add column if not exists status text default 'ativo';  -- onboarding, ativo, pausado, encerrado
alter table clients add column if not exists due_day int;                  -- dia do vencimento (10, 20, 30…)
alter table clients add column if not exists start_date date;
alter table clients add column if not exists pkg_notes text default '';

-- regra: nome do cliente sempre em caixa alta (acentos também)
create or replace function nome_maiusculo(t text) returns text language sql immutable as $$
  select upper(translate(btrim(regexp_replace(t, '\s+', ' ', 'g')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ'))
$$;
create or replace function clients_nome_maiusculo() returns trigger language plpgsql as $$
begin new.name := nome_maiusculo(new.name); return new; end $$;
drop trigger if exists nome_maiusculo on clients;
create trigger nome_maiusculo before insert or update of name on clients
for each row execute function clients_nome_maiusculo();
update clients set name = nome_maiusculo(name) where name <> nome_maiusculo(name);

create table if not exists plans (
  client_id uuid not null references clients(id) on delete cascade,
  month text not null,                 -- formato 2026-11
  arts jsonb default '[]'::jsonb,
  recordings jsonb default '[]'::jsonb,
  notes text default '',
  sent boolean default false,
  updated_at timestamptz default now(),
  primary key (client_id, month)
);

create table if not exists settings (
  id int primary key default 1,
  data jsonb default '{}'::jsonb
);

-- O que cada login pode usar. Quem não está aqui não vê nada.
--   planejamentos  planejamento do mês (cadastra cliente e pacote)
--   clientes       aba Clientes, sem valores
--   contratos      valores, dados do contrato e formulário do cliente
--   esteira        esteira de posts
--   acessos        cria logins e define o que cada um pode usar (administrador)
-- Depois do primeiro acesso, tudo isso se muda no site, em Ajustes > Acessos.
create table if not exists team (
  email text primary key,
  role text not null default 'equipe'
);
alter table team drop constraint if exists team_role_check;
alter table team add column if not exists nome text default '';
alter table team add column if not exists perms text[];
update team set perms = case role
    when 'admin' then array['planejamentos','clientes','contratos','esteira','acessos']
    when 'planejamento' then array['planejamentos']
    else array['planejamentos','clientes'] end
  where perms is null;
-- o administrador principal sempre tem tudo
insert into team (email, role, nome, perms)
values ('adm@2ldigitalhub.com', 'admin', 'Administrador', array['planejamentos','clientes','contratos','esteira','acessos'])
on conflict (email) do update set perms = excluded.perms, role = 'admin';

-- Dados do contrato e cadastrais (valores, CPF, endereço…): só administrador
create table if not exists client_private (
  client_id uuid primary key references clients(id) on delete cascade,
  data jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Links do formulário que o cliente preenche
create table if not exists client_forms (
  token uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  created_at timestamptz default now(),
  submitted_at timestamptz
);

create or replace function my_perms() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select perms from team where lower(email) = lower(auth.jwt() ->> 'email')), '{}')
$$;
create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select p = any (my_perms())
$$;
-- administrador = quem gerencia os acessos (usado também pela esteira)
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select has_perm('acessos')
$$;
-- versão antiga do site
create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select case when has_perm('contratos') then 'admin' when has_perm('clientes') then 'equipe' else 'planejamento' end
$$;

-- grava só os campos alterados, sem apagar o que o cliente mandou pelo formulário
create or replace function merge_private(cid uuid, patch jsonb) returns jsonb
language sql security invoker set search_path = public as $$
  insert into client_private (client_id, data) values (cid, patch)
  on conflict (client_id) do update set data = client_private.data || excluded.data, updated_at = now()
  returning data
$$;

-- Formulário público: só funciona com o link (token) e só uma vez
create or replace function onboarding_info(t uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', c.name, 'submitted', f.submitted_at is not null)
  from client_forms f join clients c on c.id = f.client_id where f.token = t
$$;

create or replace function submit_onboarding(t uuid, payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare cid uuid; clean jsonb;
begin
  select client_id into cid from client_forms where token = t and submitted_at is null for update;
  if cid is null then return false; end if;
  select coalesce(jsonb_object_agg(key, to_jsonb(left(value #>> '{}', 300))), '{}'::jsonb) into clean
  from jsonb_each(payload)
  where jsonb_typeof(value) = 'string' and key = any (array[
    'razão social','CNPJ contratante','nome fantasia','endereço','cidade','estado','CEP',
    'nome do representante legal','CPF do representante legal','e-mail do representante','data de nascimento',
    'nome do financeiro','contato do financeiro']);
  insert into client_private (client_id, data) values (cid, clean)
  on conflict (client_id) do update set data = client_private.data || excluded.data, updated_at = now();
  update client_forms set submitted_at = now() where token = t;
  return true;
end $$;

revoke all on function onboarding_info(uuid) from public;
revoke all on function submit_onboarding(uuid, jsonb) from public;
grant execute on function onboarding_info(uuid) to anon, authenticated;
grant execute on function submit_onboarding(uuid, jsonb) to anon, authenticated;

-- Cada parte só abre para quem tem a permissão dela.
alter table clients        enable row level security;
alter table plans          enable row level security;
alter table settings       enable row level security;
alter table team           enable row level security;
alter table client_private enable row level security;
alter table client_forms   enable row level security;

drop policy if exists "equipe" on clients;
drop policy if exists "equipe le" on clients;
drop policy if exists "equipe cria" on clients;
drop policy if exists "equipe edita" on clients;
drop policy if exists "admin apaga" on clients;
drop policy if exists "equipe" on plans;
drop policy if exists "equipe" on settings;
drop policy if exists "proprio ou admin" on team;
drop policy if exists "admin" on team;
drop policy if exists "admin" on client_private;
drop policy if exists "admin" on client_forms;
drop policy if exists "le" on settings;
drop policy if exists "grava" on settings;
create policy "equipe le"    on clients for select to authenticated using (cardinality(my_perms()) > 0);
create policy "equipe cria"  on clients for insert to authenticated with check (has_perm('planejamentos') or has_perm('clientes'));
create policy "equipe edita" on clients for update to authenticated using (has_perm('planejamentos') or has_perm('clientes')) with check (has_perm('planejamentos') or has_perm('clientes'));
create policy "admin apaga"  on clients for delete to authenticated using (has_perm('clientes'));
create policy "equipe" on plans    for all to authenticated using (has_perm('planejamentos')) with check (has_perm('planejamentos'));
create policy "le"     on settings for select to authenticated using (true);
create policy "grava"  on settings for all to authenticated using (has_perm('planejamentos')) with check (has_perm('planejamentos'));
create policy "proprio ou admin" on team for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email') or has_perm('acessos'));
create policy "admin" on team           for all to authenticated using (has_perm('acessos')) with check (has_perm('acessos'));
create policy "admin" on client_private for all to authenticated using (has_perm('contratos')) with check (has_perm('contratos'));
create policy "admin" on client_forms   for all to authenticated using (has_perm('contratos')) with check (has_perm('contratos'));

-- Pasta das artes (as imagens abrem por link, para o arquivo do cliente funcionar)
insert into storage.buckets (id, name, public)
values ('artes', 'artes', true)
on conflict (id) do nothing;

drop policy if exists "equipe le artes" on storage.objects;
drop policy if exists "equipe envia artes" on storage.objects;
drop policy if exists "equipe apaga artes" on storage.objects;
create policy "equipe le artes"    on storage.objects for select to authenticated using (bucket_id = 'artes');
create policy "equipe envia artes" on storage.objects for insert to authenticated with check (bucket_id = 'artes');
create policy "equipe apaga artes" on storage.objects for delete to authenticated using (bucket_id = 'artes');
