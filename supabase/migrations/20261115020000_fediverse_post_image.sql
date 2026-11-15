-- The fediverse feature: an item post's image (Adam, 2026-11-15: posts show
-- the item's description and its picture, not only its title). The image is
-- the one the item's page shares (its link preview), sent to followers'
-- servers by address; the hub never uploads it anywhere.
--
-- Additive: two nullable columns.

ALTER TABLE fediverse_posts ADD COLUMN IF NOT EXISTS image_url text NULL CHECK (image_url IS NULL OR image_url ~ '^https?://');
ALTER TABLE fediverse_posts ADD COLUMN IF NOT EXISTS image_alt text NULL CHECK (image_alt IS NULL OR length(image_alt) <= 1500);
COMMENT ON COLUMN fediverse_posts.image_url IS 'The item''s image, as its page shares it; attached to the Note.';
COMMENT ON COLUMN fediverse_posts.image_alt IS 'The image''s description for people who cannot see it.';
