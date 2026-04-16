-- MTD IT (Making Tax Digital for Income Tax) flag — individuals only
alter table clients
  add column if not exists mtd_it boolean not null default false;
