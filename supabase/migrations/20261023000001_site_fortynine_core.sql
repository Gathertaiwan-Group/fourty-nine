-- site_fortynine: core content schema for 四拾九天數位整合行銷 (WordPress -> Next.js)
-- Only touches schema site_fortynine. Every table has RLS enabled.
-- WordPress IDs are kept as primary keys (posts/pages/media/terms/users/menu items/comments)
-- so private data imported later (orders, customers, options) can be matched 1:1.
-- Public read: anon may read published/public rows only. All writes go through service_role.

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function site_fortynine.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- site settings (wp_options public subset: blogname, blogdescription, site_icon, ...)
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  is_public  boolean not null default true,
  updated_at timestamptz not null default now()
);

-- wp_options private subset (plugin settings, Yoast/Elementor/Wordfence options...) -- filled in phase 3
create table if not exists site_fortynine.options (
  option_name  text primary key,
  option_value jsonb,
  autoload     boolean not null default false,
  source       text,                -- e.g. 'wp_options', 'elementor', 'yoast'
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- authors (wp_users public profile)
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.authors (
  id           bigint primary key,           -- wp_users.ID
  slug         text not null unique,         -- user_nicename (author archive /author/<slug>/)
  display_name text not null,
  description  text,
  avatar_url   text,
  website      text,
  seo          jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- terms (wp_terms + wp_term_taxonomy), hierarchical via parent_id
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.terms (
  id          bigint primary key,            -- wp term_id
  taxonomy    text not null,                 -- category | post_tag | nav_menu | wp_pattern_category | custom
  slug        text not null,                 -- decoded slug (e.g. 內容行銷)
  wp_slug     text not null,                 -- slug exactly as WordPress stores it (percent-encoded)
  name        text not null,
  description text not null default '',
  parent_id   bigint references site_fortynine.terms(id) on delete set null,
  count       integer not null default 0,    -- published object count as reported by WP
  path        text not null,                 -- decoded archive path, e.g. /category/內容行銷/
  old_url     text,
  seo         jsonb,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (taxonomy, slug)
);
create index if not exists terms_parent_idx on site_fortynine.terms (parent_id);

-- ---------------------------------------------------------------------------
-- media (attachments). Files live in storage bucket site-fortynine.
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.media (
  id                bigint primary key,       -- wp attachment ID
  slug              text not null,
  wp_slug           text not null,
  title             text not null default '',
  caption_html      text not null default '',
  description_html  text not null default '',
  alt_text          text not null default '',
  media_type        text not null,            -- image | file
  mime_type         text not null,            -- mime of the stored file (webp after conversion)
  original_mime     text not null,            -- mime on the old site
  old_url           text not null,            -- old source_url
  storage_path      text,                     -- object key inside bucket site-fortynine
  url               text,                     -- new public URL
  width             integer,
  height            integer,
  bytes             bigint,                   -- stored size
  original_bytes    bigint,
  sha1              text,                     -- sha1 of the original file (dedupe)
  attachment_path   text,                     -- old attachment page path (301 -> url)
  parent_post_id    bigint,                   -- post_parent (uploaded to)
  author_id         bigint,
  status            text not null default 'inherit',
  date              timestamptz,
  modified          timestamptz,
  meta              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists media_parent_idx on site_fortynine.media (parent_post_id);
create index if not exists media_storage_idx on site_fortynine.media (storage_path);

-- old URL (original, -scaled, -WxH variants, protocol-relative) -> new URL
create table if not exists site_fortynine.media_url_map (
  old_url    text primary key,
  media_id   bigint references site_fortynine.media(id) on delete cascade,
  new_url    text not null,
  kind       text not null check (kind in ('original','scaled','variant','duplicate')),
  created_at timestamptz not null default now()
);
create index if not exists media_url_map_media_idx on site_fortynine.media_url_map (media_id);

-- ---------------------------------------------------------------------------
-- posts: posts, pages, custom post types, reusable blocks, navigation, templates
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.posts (
  id                bigint primary key,       -- wp post ID
  post_type         text not null,            -- post | page | wp_block | wp_navigation | elementor_library | <cpt>
  slug              text not null,            -- decoded
  wp_slug           text not null,            -- as stored in WP (percent-encoded)
  path              text not null,            -- decoded public path, e.g. /about/ , / for front page
  old_url           text,
  title             text not null default '',
  content_html      text not null default '', -- rendered HTML with old-site URLs rewritten
  excerpt_html      text not null default '',
  status            text not null default 'draft'
                    check (status in ('publish','draft','pending','private','future','trash','inherit')),
  author_id         bigint references site_fortynine.authors(id) on delete set null,
  featured_media_id bigint references site_fortynine.media(id) on delete set null,
  parent_id         bigint references site_fortynine.posts(id) on delete set null,
  menu_order        integer not null default 0,
  comment_status    text not null default 'closed',
  ping_status       text not null default 'closed',
  sticky            boolean not null default false,
  format            text not null default 'standard',
  template          text not null default '',
  date              timestamptz,
  date_gmt          timestamptz,
  modified          timestamptz,
  modified_gmt      timestamptz,
  meta              jsonb not null default '{}'::jsonb,
  seo               jsonb,                    -- Yoast head json (URLs rewritten)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (post_type, slug)
);
create index if not exists posts_type_status_date_idx on site_fortynine.posts (post_type, status, date desc);
create index if not exists posts_path_idx on site_fortynine.posts (path);
create index if not exists posts_parent_idx on site_fortynine.posts (parent_id);
create index if not exists posts_author_idx on site_fortynine.posts (author_id);
create index if not exists posts_featured_idx on site_fortynine.posts (featured_media_id);

-- post_password lives in its own private table so anon can `select *` on posts safely
create table if not exists site_fortynine.post_passwords (
  post_id  bigint primary key references site_fortynine.posts(id) on delete cascade,
  password text not null
);

create table if not exists site_fortynine.post_terms (
  post_id    bigint not null references site_fortynine.posts(id) on delete cascade,
  term_id    bigint not null references site_fortynine.terms(id) on delete cascade,
  term_order integer not null default 0,
  primary key (post_id, term_id)
);
create index if not exists post_terms_term_idx on site_fortynine.post_terms (term_id);

-- theme templates / Elementor header-footer / template parts (wp_template, wp_template_part, elementor_library)
create table if not exists site_fortynine.templates (
  id           bigint primary key,
  template_type text not null,               -- wp_template | wp_template_part | elementor_library
  slug         text not null,
  title        text not null default '',
  location     text,                         -- header | footer | single | archive | popup ...
  content_html text not null default '',
  data         jsonb not null default '{}'::jsonb,  -- e.g. _elementor_data
  status       text not null default 'publish',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (template_type, slug)
);

-- ---------------------------------------------------------------------------
-- comments (wp_comments)
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.comments (
  id           bigint primary key,
  post_id      bigint not null references site_fortynine.posts(id) on delete cascade,
  parent_id    bigint references site_fortynine.comments(id) on delete cascade,
  author_id    bigint,
  author_name  text not null default '',
  author_url   text,
  content_html text not null default '',
  status       text not null default 'hold' check (status in ('approved','hold','spam','trash')),
  type         text not null default 'comment',
  date         timestamptz,
  date_gmt     timestamptz,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
-- private comment fields (email / ip / user agent) kept apart so anon can `select *` on comments
create table if not exists site_fortynine.comment_private (
  comment_id   bigint primary key references site_fortynine.comments(id) on delete cascade,
  author_email text,
  author_ip    text,
  user_agent   text
);
create index if not exists comments_post_idx on site_fortynine.comments (post_id, status);
create index if not exists comments_parent_idx on site_fortynine.comments (parent_id);

-- ---------------------------------------------------------------------------
-- menus (nav_menu term + nav_menu_item posts)
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.menus (
  id         bigint generated by default as identity primary key, -- wp nav_menu term_id when known
  slug       text not null unique,
  name       text not null,
  location   text,                           -- theme location: primary | footer | mobile ...
  source     text,                           -- where it was reconstructed from
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_fortynine.menu_items (
  id          bigint primary key,             -- wp nav_menu_item post ID
  menu_id     bigint not null references site_fortynine.menus(id) on delete cascade,
  parent_id   bigint references site_fortynine.menu_items(id) on delete cascade,
  position    integer not null default 0,
  title       text not null,
  url         text not null,                  -- relative path for internal links
  object_type text,                           -- page | post | category | custom
  object_id   bigint,
  target      text,
  attr_title  text,
  classes     text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists menu_items_menu_idx on site_fortynine.menu_items (menu_id, parent_id, position);

-- ---------------------------------------------------------------------------
-- forms & submissions (Elementor Pro forms). Old site has none; tables ready for the admin.
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.forms (
  id          bigint generated by default as identity primary key,
  slug        text not null unique,
  name        text not null,
  fields      jsonb not null default '[]'::jsonb,
  settings    jsonb not null default '{}'::jsonb,  -- recipients, success message, ...
  is_active   boolean not null default true,
  source      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists site_fortynine.form_submissions (
  id          uuid primary key default gen_random_uuid(),
  form_id     bigint references site_fortynine.forms(id) on delete set null,
  wp_id       bigint,                               -- e_submissions.id when imported
  data        jsonb not null default '{}'::jsonb,
  page_path   text,
  ip          text,
  user_agent  text,
  status      text not null default 'new',
  created_at  timestamptz not null default now()
);
create index if not exists form_submissions_form_idx on site_fortynine.form_submissions (form_id, created_at desc);

-- ---------------------------------------------------------------------------
-- redirects (old URL paths that must keep working: attachment pages -> file, etc.)
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.redirects (
  id          bigint generated by default as identity primary key,
  source_path text not null unique,           -- decoded path, e.g. /不同口味/
  target      text not null,                  -- absolute URL or path
  status_code integer not null default 301 check (status_code in (301,302,307,308,410)),
  kind        text not null default 'manual', -- attachment | manual | legacy
  media_id    bigint references site_fortynine.media(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists redirects_media_idx on site_fortynine.redirects (media_id);

-- ---------------------------------------------------------------------------
-- admins & audit log
-- ---------------------------------------------------------------------------
create table if not exists site_fortynine.admins (
  user_id    uuid primary key,                -- auth.users.id
  email      text not null unique,
  role       text not null default 'administrator' check (role in ('administrator','editor','author','shop_manager')),
  created_at timestamptz not null default now()
);

create table if not exists site_fortynine.audit_log (
  id          bigint generated by default as identity primary key,
  actor       text not null,                  -- admin email / 'mcp' / 'migration'
  actor_id    uuid,
  action      text not null,                  -- create | update | delete | import ...
  entity      text not null,                  -- table name
  entity_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on site_fortynine.audit_log (entity, entity_id);
create index if not exists audit_log_created_idx on site_fortynine.audit_log (created_at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['settings','options','authors','terms','media','posts','templates','menus','forms'] loop
    execute format('drop trigger if exists %I on site_fortynine.%I', t || '_touch', t);
    execute format('create trigger %I before update on site_fortynine.%I for each row execute function site_fortynine.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
