-- 登录失败次数：同一个用户名 15 分钟内输错 10 次就暂时不让再试（Codex 第 23 轮：公网登录没有限速）
-- 用户名不存在也照样记，免得别人靠“记不记次数”判断哪个用户名存在
CREATE TABLE IF NOT EXISTS login_failures (
  username TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
