-- Real, tenant-scoped outcome ingestion from CSV/XLSX uploads.
-- Preserves provenance, supports re-import/correction without silent
-- duplication (unique on location_id + observation_date + source_file
-- so re-uploading the same real file updates rather than duplicates).
-- Does not assume every spreadsheet has every field - all columns
-- except location_id/observation_date are nullable by design.

create table if not exists outcome_import_batches (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  organization_id uuid not null,
  uploaded_by uuid not null,
  source_filename text not null,
  column_mapping jsonb not null, -- real, honest record of which real spreadsheet column mapped to which real field, for audit
  row_count integer not null default 0,
  status text not null default 'processing' check (status in ('processing','completed','failed','partial')),
  error_summary text,
  uploaded_at timestamptz default now()
);
alter table outcome_import_batches enable row level security;
create policy outcome_import_batches_access on outcome_import_batches for select using (private.has_location_access(location_id));

create table if not exists outcome_observations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  import_batch_id uuid references outcome_import_batches(id) on delete cascade,
  observation_date date not null,
  walk_ins integer,
  transactions integer,
  revenue numeric,
  primary_category text,
  quantity integer,
  average_ticket numeric,
  inventory_count integer,
  source text not null default 'csv_upload',
  raw_row jsonb, -- real, original row preserved for audit/re-processing, never discarded
  created_at timestamptz default now(),
  unique(location_id, observation_date, source)
);
alter table outcome_observations enable row level security;
create policy outcome_observations_access on outcome_observations for select using (private.has_location_access(location_id));
create index if not exists idx_outcome_obs_lookup on outcome_observations (location_id, observation_date);
