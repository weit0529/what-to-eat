-- 我的菜单（阶段 4-4，REQUIREMENTS.md R-024、R-029）。
--
-- 菜单分三层：
--   通用菜单（所有人可见，含没登录的）  dishes.scope = 'general'
--   共享菜（审核通过，登录用户可见）      dishes.scope = 'shared'
--   我的菜（只有自己可见）                user_dishes
-- 审核通过时，菜从 user_dishes 搬进 dishes（scope = 'shared'），编号不变，
-- 大家手机上的“吃过”“小名单”记录还认得；管理员“移到通用菜单”只改 scope。

ALTER TABLE dishes ADD COLUMN scope TEXT NOT NULL DEFAULT 'general';
-- 共享菜是谁提交的（通用菜单里管理员加的菜为空）
ALTER TABLE dishes ADD COLUMN author_id TEXT;

-- 我的菜。status：private = 自己的（没提交）；pending = 审核中（锁住，不能改删）；rejected = 被退回（review_note 是理由）
CREATE TABLE IF NOT EXISTS user_dishes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  shop TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  meals TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  price REAL,
  description TEXT,
  image TEXT,
  status TEXT NOT NULL DEFAULT 'private' CHECK (status IN ('private', 'pending', 'rejected')),
  -- 版本号：每次改、每次提交都加 1。审核时要带上管理员看到的版本，对不上就不处理（Codex 第 37 轮：
  -- 退回后用户改了又重新提交，旧页面上的“通过”不能把管理员没看过的新内容发出去）
  revision INTEGER NOT NULL DEFAULT 0,
  review_note TEXT,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, name, shop)
);

CREATE INDEX IF NOT EXISTS idx_user_dishes_owner ON user_dishes(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_dishes_status ON user_dishes(status, submitted_at);

-- 网站设置（键值）。user_dishes_open：'1' = 允许用户加 / 改菜（默认），'0' = 不允许
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER,
  updated_by TEXT
);

-- 加菜的黑白名单：总开关打开时黑名单里的人不能加改，关上时只有白名单里的人能加改。一个人只在一张名单里
CREATE TABLE IF NOT EXISTS dish_access (
  user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  list TEXT NOT NULL CHECK (list IN ('black', 'white')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
