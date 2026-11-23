ALTER TABLE sessions ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN state_json TEXT;

CREATE TABLE IF NOT EXISTS emotion_inputs (
  session_id TEXT NOT NULL,
  emotion TEXT NOT NULL CHECK (emotion IN ('joy', 'anger', 'sadness', 'fun')),
  note TEXT NOT NULL,
  scene TEXT NOT NULL DEFAULT '',
  wish TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, emotion, revision)
);

CREATE TABLE IF NOT EXISTS card_set_revisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_entries (
  revision_id TEXT NOT NULL,
  emotion TEXT NOT NULL CHECK (emotion IN ('joy', 'anger', 'sadness', 'fun')),
  title TEXT NOT NULL,
  contents TEXT NOT NULL,
  image_brief TEXT NOT NULL,
  PRIMARY KEY (revision_id, emotion)
);

ALTER TABLE artifacts ADD COLUMN emotion TEXT;
ALTER TABLE artifacts ADD COLUMN approved_card_set_revision_id TEXT;
ALTER TABLE artifacts ADD COLUMN card_content_hash TEXT;
ALTER TABLE artifacts ADD COLUMN image_brief_hash TEXT;
