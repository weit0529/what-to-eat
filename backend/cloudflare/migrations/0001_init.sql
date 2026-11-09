-- 备用后台（Cloudflare D1）连通测试用的表。正式功能（管理页、账号、我的菜单）以后再加新的迁移文件。

-- 用户：密码只存盐和 PBKDF2 结果，不存原文
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 登录凭证：只存凭证的 SHA-256；过期时间是毫秒时间戳
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- 连通测试写入、读回的数据
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, id);
