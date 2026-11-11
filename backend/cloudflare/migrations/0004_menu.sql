-- 总菜单（阶段 4-2：管理员在线维护，以后菜单以这里为准，Excel 只做批量导入导出）。

-- 额外餐次（早午晚之外的，如下午茶、夜宵）。id 就是名字，和 Excel“餐次”页一样
CREATE TABLE IF NOT EXISTS meal_types (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL
);

-- 菜。
-- id：从 Excel 第一次导入的菜沿用原来的编号（["品类","店铺"]），这样大家手机上“吃过”“小名单”的记录还认得；
--     以后在管理页新加的菜，由后台生成随机编号（d_ 开头），改名也不变（REQUIREMENTS.md R-027）
-- shop：没有店铺时存空字符串，这样“品类 + 店铺”唯一的约束才对没有店铺的菜也有效
-- meals、tags：JSON 数组
-- enabled：0 = 停用（后台留着，网站上不显示）
CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  shop TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  meals TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  price REAL,
  description TEXT,
  image TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  UNIQUE (name, shop)
);

CREATE INDEX IF NOT EXISTS idx_dishes_sort ON dishes(sort, created_at);
