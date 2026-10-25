-- Responsive WebP variants (480/960/1440 wide, quality 75) stored at site-fortynine/v/<w>/<storage path>.webp
-- variants: [{ "w": 480, "h": 253, "path": "v/480/uploads/2023/03/ki.webp", "url": "...", "bytes": 12345 }, ...]
alter table site_fortynine.media add column if not exists variants jsonb not null default '[]'::jsonb;
