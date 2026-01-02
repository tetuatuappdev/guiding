-- Minimal schema for the current API.
-- Run in Supabase SQL Editor.

create table if not exists tours (
  id bigserial primary key,
  name text not null,
  tour_date date not null,
  tour_time time not null,
  guide_id uuid not null,
  status text not null default 'scheduled',
  participant_count_reported int not null default 0
);

create index if not exists idx_tours_guide_id on tours(guide_id);

create table if not exists tickets (
  id bigserial primary key,
  code text unique not null,
  tourist_name text,
  is_scanned boolean not null default false,
  tour_id bigint references tours(id) on delete set null
);

create index if not exists idx_tickets_tour_id on tickets(tour_id);

create table if not exists availability (
  guide_id uuid not null,
  date date not null,
  is_available boolean not null default true,
  primary key (guide_id, date)
);
