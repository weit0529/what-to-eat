-- 普通用户账号（阶段 4-3，REQUIREMENTS.md R-022）：邀请码、注册时的邮箱验证码、发码次数限制。
-- 账号本身存在 Better Auth 的 user / account 表里（0003），role = 'user'。

-- 邀请码：管理员在管理页生成，7 天有效，用一次就作废（用户 2026-11-10 选 3A）。
-- 只存邀请码的 SHA-256，不存原文；hint 是最后 4 位，管理页列表里给管理员认是哪一个
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER,
  revoked_at INTEGER
);

-- 注册时发到邮箱的验证码（用户 2026-11-10 选 2A）：一个邮箱同时只有一个有效的码；只存哈希
CREATE TABLE IF NOT EXISTS signup_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

-- 发验证码的次数限制（防止有人拿网站给别人的邮箱狂发信）：按“对象”（IP 或邮箱）在时间窗口里计数
CREATE TABLE IF NOT EXISTS send_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
