-- site_fortynine: Row Level Security.
-- anon/authenticated: read-only, published/public rows only. No write policies at all:
-- every write goes through server code using service_role (which bypasses RLS) after
-- verifying the caller is listed in site_fortynine.admins.

do $$
declare t text;
begin
  foreach t in array array[
    'settings','options','authors','post_passwords','comment_private','terms','media','media_url_map','posts','post_terms','templates',
    'comments','menus','menu_items','forms','form_submissions','redirects','admins','audit_log',
    'customers','orders','order_items','order_notes','coupons'
  ] loop
    execute format('alter table site_fortynine.%I enable row level security', t);
  end loop;
end $$;

-- private tables: also remove table privileges from client roles (defence in depth)
revoke all on site_fortynine.options, site_fortynine.post_passwords, site_fortynine.comment_private, site_fortynine.form_submissions, site_fortynine.admins,
  site_fortynine.audit_log, site_fortynine.customers, site_fortynine.orders,
  site_fortynine.order_items, site_fortynine.order_notes, site_fortynine.coupons
  from anon, authenticated;

-- read policies ------------------------------------------------------------
drop policy if exists settings_public_read on site_fortynine.settings;
create policy settings_public_read on site_fortynine.settings
  for select to anon, authenticated using (is_public);

drop policy if exists authors_public_read on site_fortynine.authors;
create policy authors_public_read on site_fortynine.authors
  for select to anon, authenticated using (true);

drop policy if exists terms_public_read on site_fortynine.terms;
create policy terms_public_read on site_fortynine.terms
  for select to anon, authenticated using (true);

drop policy if exists media_public_read on site_fortynine.media;
create policy media_public_read on site_fortynine.media
  for select to anon, authenticated using (status in ('inherit','publish'));

drop policy if exists media_url_map_public_read on site_fortynine.media_url_map;
create policy media_url_map_public_read on site_fortynine.media_url_map
  for select to anon, authenticated using (true);

drop policy if exists posts_public_read on site_fortynine.posts;
create policy posts_public_read on site_fortynine.posts
  for select to anon, authenticated
  using (status = 'publish' and post_type in ('post','page','wp_block','wp_navigation'));

drop policy if exists post_terms_public_read on site_fortynine.post_terms;
create policy post_terms_public_read on site_fortynine.post_terms
  for select to anon, authenticated
  using (exists (select 1 from site_fortynine.posts p
                 where p.id = post_id and p.status = 'publish'));

drop policy if exists templates_public_read on site_fortynine.templates;
create policy templates_public_read on site_fortynine.templates
  for select to anon, authenticated using (status = 'publish');

drop policy if exists comments_public_read on site_fortynine.comments;
create policy comments_public_read on site_fortynine.comments
  for select to anon, authenticated
  using (status = 'approved' and exists (select 1 from site_fortynine.posts p
                                         where p.id = post_id and p.status = 'publish'));

drop policy if exists menus_public_read on site_fortynine.menus;
create policy menus_public_read on site_fortynine.menus
  for select to anon, authenticated using (true);

drop policy if exists menu_items_public_read on site_fortynine.menu_items;
create policy menu_items_public_read on site_fortynine.menu_items
  for select to anon, authenticated using (true);

drop policy if exists forms_public_read on site_fortynine.forms;
create policy forms_public_read on site_fortynine.forms
  for select to anon, authenticated using (is_active);

drop policy if exists redirects_public_read on site_fortynine.redirects;
create policy redirects_public_read on site_fortynine.redirects
  for select to anon, authenticated using (true);

-- options, post_passwords, comment_private, form_submissions, admins, audit_log, customers, orders, order_items, order_notes,
-- coupons: no policies => service_role only.
