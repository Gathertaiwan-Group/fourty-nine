-- site_fortynine: private data tables (left empty in phase 2; filled from the DB backup in phase 3).
-- Columns follow WooCommerce / WordPress meanings so the backup can be mapped 1:1 by original IDs.
-- The site is not a shop today, but the tables exist so orders/customers/coupons from the backup
-- (if any) have a home. No anon access at all.

create table if not exists site_fortynine.customers (
  id              bigint primary key,           -- wp_users.ID / wc_customer_lookup.customer_id
  user_id         uuid,                         -- auth.users.id if the customer gets a login later
  email           text,
  username        text,
  first_name      text,
  last_name       text,
  display_name    text,
  role            text default 'customer',
  billing         jsonb not null default '{}'::jsonb,
  shipping        jsonb not null default '{}'::jsonb,
  is_paying       boolean not null default false,
  date_created    timestamptz,
  date_modified   timestamptz,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists customers_email_idx on site_fortynine.customers (lower(email));

create table if not exists site_fortynine.orders (
  id                   bigint primary key,      -- WC order ID
  order_number         text,
  status               text not null default 'pending',  -- pending | processing | on-hold | completed | cancelled | refunded | failed
  currency             text not null default 'TWD',
  customer_id          bigint references site_fortynine.customers(id) on delete set null,
  billing              jsonb not null default '{}'::jsonb,
  shipping             jsonb not null default '{}'::jsonb,
  payment_method       text,
  payment_method_title text,
  transaction_id       text,
  customer_note        text,
  subtotal             numeric(12,2) not null default 0,
  discount_total       numeric(12,2) not null default 0,
  shipping_total       numeric(12,2) not null default 0,
  tax_total            numeric(12,2) not null default 0,
  total                numeric(12,2) not null default 0,
  date_created         timestamptz,
  date_modified        timestamptz,
  date_paid            timestamptz,
  date_completed       timestamptz,
  meta                 jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);
create index if not exists orders_customer_idx on site_fortynine.orders (customer_id);
create index if not exists orders_status_date_idx on site_fortynine.orders (status, date_created desc);

create table if not exists site_fortynine.order_items (
  id            bigint primary key,             -- woocommerce_order_items.order_item_id
  order_id      bigint not null references site_fortynine.orders(id) on delete cascade,
  item_type     text not null default 'line_item', -- line_item | shipping | fee | coupon | tax
  name          text not null default '',
  product_id    bigint,
  variation_id  bigint,
  quantity      integer not null default 1,
  subtotal      numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  tax_total     numeric(12,2) not null default 0,
  meta          jsonb not null default '{}'::jsonb
);
create index if not exists order_items_order_idx on site_fortynine.order_items (order_id);

create table if not exists site_fortynine.order_notes (
  id            bigint primary key,             -- wp_comments.comment_ID (type order_note)
  order_id      bigint not null references site_fortynine.orders(id) on delete cascade,
  note          text not null,
  is_customer_note boolean not null default false,
  added_by      text,
  created_at    timestamptz
);
create index if not exists order_notes_order_idx on site_fortynine.order_notes (order_id);

create table if not exists site_fortynine.coupons (
  id                    bigint primary key,     -- shop_coupon post ID
  code                  text not null unique,
  discount_type         text not null default 'fixed_cart', -- percent | fixed_cart | fixed_product
  amount                numeric(12,2) not null default 0,
  description           text,
  date_expires          timestamptz,
  usage_count           integer not null default 0,
  usage_limit           integer,
  usage_limit_per_user  integer,
  individual_use        boolean not null default false,
  free_shipping         boolean not null default false,
  minimum_amount        numeric(12,2),
  maximum_amount        numeric(12,2),
  product_ids           bigint[] not null default '{}',
  excluded_product_ids  bigint[] not null default '{}',
  email_restrictions    text[] not null default '{}',
  status                text not null default 'publish',
  meta                  jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

-- private attachments (files that were not public on the old site) are stored in media with
-- status 'private'; no separate table needed.
