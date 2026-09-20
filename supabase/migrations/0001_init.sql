-- Tabelas mínimas do MVP base. RLS habilitado; políticas de exemplo abaixo
-- restringem cada linha ao dono autenticado via owner_user_id / company_id.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users (id) on delete cascade,
  tax_id varchar(14) not null unique,
  legal_name text not null,
  uf char(2) not null,
  created_at timestamptz not null default now()
);

create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  subject_name text,
  tax_id text,
  issuer text,
  serial_number text,
  fingerprint_sha256 text not null,
  valid_from timestamptz,
  valid_to timestamptz,
  is_active boolean not null default false,
  validation_result jsonb,
  revocation_status text,
  validated_at timestamptz,
  storage_path text not null,
  password_ciphertext bytea not null,
  password_iv bytea not null,
  password_tag bytea not null,
  key_version int not null,
  created_at timestamptz not null default now()
);

-- Só um certificado ativo por empresa.
create unique index if not exists certificates_one_active_per_company
  on certificates (company_id)
  where is_active;

create table if not exists nfe_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  environment text not null check (environment in ('homologacao', 'producao')),
  access_key varchar(44) not null,
  model text,
  number text,
  series text,
  issued_at timestamptz,
  schema_version text,
  parser_version text,

  issuer_tax_id text,
  recipient_tax_id text,
  issuer_name text,
  recipient_name text,
  issuer_uf char(2),
  recipient_uf char(2),
  tp_nf text,
  id_dest text,
  movement text check (movement in ('ENTRY', 'EXIT', 'REVIEW')),

  total_amount numeric(18, 2),
  total_source text,
  icms_amount numeric(18, 2),
  difal_dest_amount numeric(18, 2),
  fcp_dest_amount numeric(18, 2),
  cfops text[],

  document_kind text check (document_kind in ('SUMMARY', 'FULL')),
  content_origin text check (content_origin in ('MANUAL', 'SEFAZ')),
  xml_path text,
  summary_path text,
  xml_sha256 text,
  document_details jsonb,
  tax_reading jsonb,

  fiscal_status text,
  status_source text,
  status_observed_at timestamptz,
  authorization_protocol text,
  extraction_status text,
  warnings jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (company_id, environment, access_key)
);

create index if not exists nfe_documents_company_env_date
  on nfe_documents (company_id, environment, issued_at desc);
create index if not exists nfe_documents_company_env_movement_date
  on nfe_documents (company_id, environment, movement, issued_at desc);
create index if not exists nfe_documents_company_env_number
  on nfe_documents (company_id, environment, number);

create table if not exists nfe_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  environment text not null,
  access_key varchar(44) not null,
  nfe_document_id uuid references nfe_documents (id) on delete set null,
  event_type text not null,
  event_sequence int not null,
  author_tax_id text,
  event_at timestamptz,
  protocol text,
  cstat text,
  status_source text,
  xml_path text,
  summary_path text,
  unique (company_id, environment, access_key, event_type, event_sequence, author_tax_id)
);

create table if not exists sync_state (
  company_id uuid not null references companies (id) on delete cascade,
  environment text not null,
  last_nsu text,
  max_nsu text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_cstat text,
  last_error_code text,
  next_allowed_at timestamptz,
  lock_until timestamptz,
  lock_token uuid,
  attempt_id uuid,
  pending_response_path text,
  pending_ult_nsu text,
  recovery_required boolean not null default false,
  primary key (company_id, environment)
);

-- RLS: cada tabela só é lida/escrita pelo dono, via join até owner_user_id.
alter table profiles enable row level security;
alter table companies enable row level security;
alter table certificates enable row level security;
alter table nfe_documents enable row level security;
alter table nfe_events enable row level security;
alter table sync_state enable row level security;

create policy profiles_self on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy companies_owner on companies
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy certificates_owner on certificates
  for all using (
    company_id in (select id from companies where owner_user_id = auth.uid())
  );

create policy nfe_documents_owner on nfe_documents
  for all using (
    company_id in (select id from companies where owner_user_id = auth.uid())
  );

create policy nfe_events_owner on nfe_events
  for all using (
    company_id in (select id from companies where owner_user_id = auth.uid())
  );

create policy sync_state_owner on sync_state
  for all using (
    company_id in (select id from companies where owner_user_id = auth.uid())
  );
