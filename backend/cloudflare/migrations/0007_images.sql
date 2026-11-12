-- 在线上传的菜图片（阶段 4-4d，REQUIREMENTS.md R-030）。图片本身存在 Cloudflare R2（绑定名 IMAGES），这里记谁传的。
-- name：up_ 加 32 位随机十六进制 + 扩展名，也是 R2 里的键和菜的 image 字段的值。
-- 用户只能给自己的菜用自己传的图；审核通过前别人拿不到文件名，所以看不到（图片地址不带登录凭证，靠随机名字）。
CREATE TABLE IF NOT EXISTS images (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_owner ON images(owner_id, created_at);
