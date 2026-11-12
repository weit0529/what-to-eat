-- 吃过记录跟账号走（阶段 4-5，REQUIREMENTS.md R-025）。只存登录用户的；不登录时记录还在本机浏览器里。
-- uid：网页生成的随机编号（撤销“就吃这个”时按它删，多台手机同时用也不会删错）。同一个用户里不重复，
--      不同用户可以撞（主键是 user_id + uid，别人写不进你的记录，也挡不住你的）。
-- dish_id、label：和本机记录一样（菜的编号、显示用的名字）；at：记录时间（网页给的 ISO 字符串），at_ms 方便比较和清理。
CREATE TABLE IF NOT EXISTS eaten_records (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  uid TEXT NOT NULL,
  dish_id TEXT NOT NULL,
  label TEXT,
  at TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_eaten_user_at ON eaten_records(user_id, at_ms);

-- 删掉过的记录（撤销“就吃这个”）：留个记号，别的手机晚到的“记一条”（同一个 uid）不会让它复活（Codex 第 47 轮）。
-- 31 天后清掉（那时晚到的记录本身也太旧、不会再收）
CREATE TABLE IF NOT EXISTS eaten_deleted (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  uid TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, uid)
);

-- 每个人的同步状态：
--   cleared_before：最近一次“清空”清到哪个时间，之后晚到的、时间更早的“记一条”不再收（Codex 第 47 轮）；没清过是 -1
--   version：记录的版本号，每次同步加 1，网页按它判断哪份记录更新（Codex 第 49 轮）
CREATE TABLE IF NOT EXISTS eaten_state (
  user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  cleared_before INTEGER NOT NULL DEFAULT -1,
  version INTEGER NOT NULL DEFAULT 0
);
