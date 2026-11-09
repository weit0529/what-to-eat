-- 连通测试用的表（腾讯云开发 PG 模式，PostgreSQL）。
-- 在云开发控制台的 PostgreSQL 数据库里打开 SQL 编辑器，整段粘贴运行一次即可；重复运行也不会出错。
--
-- PG 模式的角色（官方文档 docs.cloudbase.net/authentication-v2/auth/auth-pg）：
--   - 匿名登录后，角色仍是 anon，但 auth.uid() 是这个匿名用户自己的编号
--   - 只拿公开密钥（Publishable Key）、没登录时，角色也是 anon，auth.uid() 固定是字符串 'anon'
--   - 用户名密码等正式登录后，角色是 authenticated
-- 连通测试用的是匿名登录，所以要给 anon 权限；再用 auth.uid() <> 'anon' 把“没登录”的请求挡在外面（Codex 第 26 轮）。
--
-- 权限：每个人只能写自己的、读自己的；不给改、不给删。
-- owner 列默认填当前登录用户的编号（auth.uid()，类型是 text），不靠网页传，网页也改不了。

CREATE TABLE IF NOT EXISTS public.conn_test (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner text NOT NULL DEFAULT auth.uid(),
  text text NOT NULL CHECK (char_length(text) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 打开行级安全：没有匹配的规则就一律不让读写
ALTER TABLE public.conn_test ENABLE ROW LEVEL SECURITY;

-- 只给读和写；不给改、不给删
REVOKE ALL ON public.conn_test FROM anon, authenticated;
GRANT SELECT, INSERT ON public.conn_test TO anon, authenticated;

DROP POLICY IF EXISTS conn_test_insert_own ON public.conn_test;
CREATE POLICY conn_test_insert_own ON public.conn_test
  FOR INSERT TO anon, authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() <> 'anon' AND owner = auth.uid());

DROP POLICY IF EXISTS conn_test_select_own ON public.conn_test;
CREATE POLICY conn_test_select_own ON public.conn_test
  FOR SELECT TO anon, authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() <> 'anon' AND owner = auth.uid());
