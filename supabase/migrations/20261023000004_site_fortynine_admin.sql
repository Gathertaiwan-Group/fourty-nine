-- site_fortynine: admin / MCP support.
-- * ID sequences so rows created in the new admin continue the WordPress ID space
--   (posts, attachments and nav_menu_items share one ID space in WordPress; terms have their own).
-- * replace_menu_items(): atomic menu save used by the admin menu editor and MCP.
-- * recount_terms(): keeps terms.count (published objects) in sync after edits.
-- * publish_due(): flips scheduled posts (status 'future') whose date has passed to 'publish'.
-- All functions are callable by service_role only.

create sequence if not exists site_fortynine.object_id_seq;
create sequence if not exists site_fortynine.term_id_seq;

select setval('site_fortynine.object_id_seq', greatest(
  (select coalesce(max(id), 0) from site_fortynine.posts),
  (select coalesce(max(id), 0) from site_fortynine.media),
  (select coalesce(max(id), 0) from site_fortynine.menu_items),
  (select coalesce(max(id), 0) from site_fortynine.templates),
  1) + 1, false)
where (select last_value from site_fortynine.object_id_seq) <= greatest(
  (select coalesce(max(id), 0) from site_fortynine.posts),
  (select coalesce(max(id), 0) from site_fortynine.media),
  (select coalesce(max(id), 0) from site_fortynine.menu_items),
  (select coalesce(max(id), 0) from site_fortynine.templates));

select setval('site_fortynine.term_id_seq', greatest((select coalesce(max(id), 0) from site_fortynine.terms), 1) + 1, false)
where (select last_value from site_fortynine.term_id_seq) <= (select coalesce(max(id), 0) from site_fortynine.terms);

alter table site_fortynine.posts      alter column id set default nextval('site_fortynine.object_id_seq');
alter table site_fortynine.media      alter column id set default nextval('site_fortynine.object_id_seq');
alter table site_fortynine.menu_items alter column id set default nextval('site_fortynine.object_id_seq');
alter table site_fortynine.terms      alter column id set default nextval('site_fortynine.term_id_seq');

revoke all on sequence site_fortynine.object_id_seq, site_fortynine.term_id_seq from anon, authenticated;
grant usage, select on sequence site_fortynine.object_id_seq, site_fortynine.term_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- atomic menu save. p_items: [{key, id?, parent_key?, title, url, object_type?, object_id?, target?, attr_title?, classes?}]
-- in tree order (parents before children). Items without id get a new object ID.
-- ---------------------------------------------------------------------------
create or replace function site_fortynine.replace_menu_items(p_menu_id bigint, p_items jsonb)
returns setof site_fortynine.menu_items
language plpgsql
set search_path = ''
as $$
declare
  it jsonb;
  ids jsonb := '{}'::jsonb;
  new_id bigint;
  pos integer := 0;
  keep bigint[] := '{}';
begin
  if not exists (select 1 from site_fortynine.menus where id = p_menu_id) then
    raise exception 'menu % not found', p_menu_id;
  end if;
  -- pass 1: assign ids
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if (it->>'id') is not null and exists (select 1 from site_fortynine.menu_items where id = (it->>'id')::bigint and menu_id = p_menu_id) then
      new_id := (it->>'id')::bigint;
    else
      new_id := nextval('site_fortynine.object_id_seq');
    end if;
    ids := ids || jsonb_build_object(it->>'key', new_id);
    keep := keep || new_id;
  end loop;
  -- detach parents first so deletes do not cascade into kept items
  update site_fortynine.menu_items set parent_id = null where menu_id = p_menu_id;
  delete from site_fortynine.menu_items where menu_id = p_menu_id and not (id = any(keep));
  -- pass 2: upsert in tree order
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pos := pos + 1;
    insert into site_fortynine.menu_items (id, menu_id, parent_id, position, title, url, object_type, object_id, target, attr_title, classes)
    values (
      (ids->>(it->>'key'))::bigint,
      p_menu_id,
      case when coalesce(it->>'parent_key', '') = '' then null else (ids->>(it->>'parent_key'))::bigint end,
      pos,
      coalesce(it->>'title', ''),
      coalesce(it->>'url', '#'),
      nullif(it->>'object_type', ''),
      nullif(it->>'object_id', '')::bigint,
      nullif(it->>'target', ''),
      nullif(it->>'attr_title', ''),
      coalesce(array(select jsonb_array_elements_text(coalesce(it->'classes', '[]'::jsonb))), '{}')
    )
    on conflict (id) do update set
      parent_id = excluded.parent_id, position = excluded.position, title = excluded.title, url = excluded.url,
      object_type = excluded.object_type, object_id = excluded.object_id, target = excluded.target,
      attr_title = excluded.attr_title, classes = excluded.classes;
  end loop;
  update site_fortynine.menus set updated_at = now() where id = p_menu_id;
  return query select * from site_fortynine.menu_items where menu_id = p_menu_id order by position;
end $$;

-- ---------------------------------------------------------------------------
create or replace function site_fortynine.recount_terms()
returns void
language sql
set search_path = ''
as $$
  update site_fortynine.terms t set count = sub.c
  from (
    select t2.id, count(p.id)::int as c
    from site_fortynine.terms t2
    left join site_fortynine.post_terms pt on pt.term_id = t2.id
    left join site_fortynine.posts p on p.id = pt.post_id and p.status = 'publish'
    where t2.taxonomy in ('category', 'post_tag')
    group by t2.id
  ) sub
  where sub.id = t.id and t.count is distinct from sub.c;
$$;

-- ---------------------------------------------------------------------------
create or replace function site_fortynine.publish_due()
returns table (id bigint, title text, path text)
language plpgsql
set search_path = ''
as $$
begin
  return query
  update site_fortynine.posts p set status = 'publish', modified = now(), modified_gmt = now()
  where p.status = 'future' and p.date is not null and p.date <= now()
  returning p.id, p.title, p.path;
end $$;

do $$
declare f text;
begin
  foreach f in array array['replace_menu_items(bigint, jsonb)', 'recount_terms()', 'publish_due()'] loop
    execute format('revoke all on function site_fortynine.%s from public, anon, authenticated', f);
    execute format('grant execute on function site_fortynine.%s to service_role', f);
  end loop;
end $$;

-- contact info used by the admin "網站設定" page (footer LINE link etc.)
insert into site_fortynine.settings (key, value, is_public)
values ('contact', '{"line": "https://lin.ee/IGRmr2r", "phone": "", "email": "", "address": ""}'::jsonb, true)
on conflict (key) do nothing;
