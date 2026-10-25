-- site_fortynine: phase 3 private-data import (schema side only; data is loaded by
-- scripts/migrate/import-private.py straight from the WordPress backup, never committed).
--
-- What the backup actually contains for this site (not a shop):
--   * 19 nav_menu terms + 23 nav_menu_item posts      -> menus / menu_items (real WP menus replace the HTML-inferred one)
--   * 1 wp_block + 15 more elementor_library templates  -> posts (wp_block) / templates
--   * 3 private attachments (metadata only)             -> media (status 'private', no file uploaded)
--   * 2 Elementor Pro forms, 976 submissions + action log, 1 WPForms form -> forms / form_submissions
--   * front-end related wp_options (WooCommerce, Yoast, Blocksy, Elementor, Chaty, core) -> options
--   * no orders, customers (all 4 WP users are administrators), coupons, discount rules, comments or post passwords.

-- submissions keep Elementor's extra data (referer title, element id, action log) out of the public columns
alter table site_fortynine.form_submissions add column if not exists meta jsonb not null default '{}'::jsonb;
drop index if exists site_fortynine.form_submissions_wp_id_key;
create unique index if not exists form_submissions_wp_id_uniq on site_fortynine.form_submissions (wp_id); -- nulls stay distinct

-- menus are keyed by the WordPress nav_menu term_id; keep the identity sequence ahead of imported ids
-- (run after the data import as well; harmless when re-run)
select setval(pg_get_serial_sequence('site_fortynine.menus', 'id'), greatest((select coalesce(max(id), 0) from site_fortynine.menus), 1));
select setval(pg_get_serial_sequence('site_fortynine.forms', 'id'), greatest((select coalesce(max(id), 0) from site_fortynine.forms), 1));

-- private tables stay service_role only (re-assert; no policies exist for client roles)
alter table site_fortynine.customers   enable row level security;
alter table site_fortynine.orders      enable row level security;
alter table site_fortynine.order_items enable row level security;
alter table site_fortynine.order_notes enable row level security;
alter table site_fortynine.coupons     enable row level security;
alter table site_fortynine.form_submissions enable row level security;
alter table site_fortynine.options     enable row level security;
revoke all on site_fortynine.customers, site_fortynine.orders, site_fortynine.order_items, site_fortynine.order_notes,
  site_fortynine.coupons, site_fortynine.form_submissions, site_fortynine.options
  from anon, authenticated;
