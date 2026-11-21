CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  pending_question_id TEXT,
  approved_content_revision_id TEXT,
  selected_artifact_id TEXT,
  artwork_choice TEXT NOT NULL DEFAULT 'pending',
  pdf_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  consent_at TEXT NOT NULL,
  template_id TEXT NOT NULL DEFAULT 'letter_a4_v1',
  style_id TEXT NOT NULL DEFAULT 'soft_watercolor',
  last_error_code TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_no INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, turn_no)
);

CREATE TABLE IF NOT EXISTS content_revisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  contents TEXT NOT NULL,
  image_brief TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE(session_id, revision_number)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  content_revision_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  image_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pdfs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  content_revision_id TEXT NOT NULL,
  artifact_id TEXT,
  template_version TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('image', 'pdf')),
  target_revision_id TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, idempotency_key)
);
