-- Supabase ダッシュボードの SQL Editor で実行してください
-- メンバー・試合履歴を1テーブルで保存（key で区別）

CREATE TABLE IF NOT EXISTS app_data (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- 初期データ（空の配列）
INSERT INTO app_data (key, value) VALUES
  ('members', '[]'::jsonb),
  ('matches', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 誰でも読み書きできるように（共有リンクで使う想定）
ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for app_data" ON app_data;
CREATE POLICY "Allow all for app_data" ON app_data
  FOR ALL
  USING (true)
  WITH CHECK (true);
