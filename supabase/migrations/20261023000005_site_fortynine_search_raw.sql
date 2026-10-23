-- WordPress-native search needs the *raw* post_content / post_excerpt (what WP's LIKE runs against),
-- not the rendered Elementor HTML (which contains posts-widget listings, srcset, etc.).
-- content_raw / excerpt_raw mirror wp_posts.post_content / post_excerpt. Imported rows are filled by
-- scripts/migrate/fill-search-raw.mjs; for rows written later by /admin or MCP the trigger keeps them in
-- sync with what the editor saved (the editor's HTML *is* the raw content for those rows).
alter table site_fortynine.posts add column if not exists content_raw text;
alter table site_fortynine.posts add column if not exists excerpt_raw text;

create or replace function site_fortynine.posts_sync_raw() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.content_raw is null then new.content_raw := new.content_html; end if;
    if new.excerpt_raw is null then new.excerpt_raw := new.excerpt_html; end if;
  else
    if new.content_html is distinct from old.content_html and new.content_raw is not distinct from old.content_raw then
      new.content_raw := new.content_html;
    end if;
    if new.excerpt_html is distinct from old.excerpt_html and new.excerpt_raw is not distinct from old.excerpt_raw then
      new.excerpt_raw := new.excerpt_html;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists posts_sync_raw on site_fortynine.posts;
create trigger posts_sync_raw before insert or update on site_fortynine.posts
  for each row execute function site_fortynine.posts_sync_raw();
