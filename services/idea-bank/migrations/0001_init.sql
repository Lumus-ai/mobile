CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected')),
  submitter_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  signal_count INTEGER NOT NULL DEFAULT 0,
  reviewed_at INTEGER,
  search_text TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ideas_public_order ON ideas(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ideas_category_language ON ideas(status, category, language);
CREATE INDEX IF NOT EXISTS ideas_submitter_time ON ideas(submitter_hash, created_at);
CREATE INDEX IF NOT EXISTS ideas_search_order ON ideas(status, signal_count DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS submission_rate_limits (
  submitter_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (submitter_hash, window_start)
);

-- Curated seeds make a new installation useful immediately.
INSERT OR IGNORE INTO ideas
  (id, title, summary, category, tags, language, status, submitter_hash, content_hash, created_at, updated_at, signal_count, reviewed_at, search_text)
VALUES
  ('seed-accessibility-audit', 'Accessibility audit for small interfaces', 'Find common keyboard, contrast, and labeling issues and create a practical repair checklist.', 'Accessibility', '["a11y","testing","ui"]', 'en', 'published', 'system', 'seed-accessibility-audit-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('accessibility audit for small interfaces find common keyboard, contrast, and labeling issues and create a practical repair checklist. accessibility ["a11y","testing","ui"]')),
  ('seed-open-source-revival', 'Open-source project revival radar', 'Find useful public projects that are neglected, have unresolved user problems, or need maintainers.', 'Open source', '["github","maintenance","research"]', 'en', 'published', 'system', 'seed-open-source-revival-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('open-source project revival radar find useful public projects that are neglected, have unresolved user problems, or need maintainers. open source ["github","maintenance","research"]')),
  ('seed-game-localization', 'Toolkit for translating older games', 'Help locate text resources, preserve formatting, check translation context, and package language patches.', 'Games and creativity', '["games","translation","localization"]', 'en', 'published', 'system', 'seed-game-localization-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('toolkit for translating older games help locate text resources, preserve formatting, check translation context, and package language patches. games and creativity ["games","translation","localization"]')),
  ('seed-docs-navigator', 'Offline documentation navigator', 'Search local documentation, connect related pages, and show exact source passages instead of unsupported answers.', 'Education', '["offline","documentation","search"]', 'en', 'published', 'system', 'seed-docs-navigator-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('offline documentation navigator search local documentation, connect related pages, and show exact source passages instead of unsupported answers. education ["offline","documentation","search"]')),
  ('seed-science-reproducibility', 'Reproducibility checklist for research', 'Help researchers record data versions, dependencies, parameters, and steps needed to repeat an experiment.', 'Science', '["research","reproducibility","checklist"]', 'en', 'published', 'system', 'seed-science-reproducibility-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('reproducibility checklist for research help researchers record data versions, dependencies, parameters, and steps needed to repeat an experiment. science ["research","reproducibility","checklist"]')),
  ('seed-local-energy', 'Private home-energy explainer', 'Turn personal electricity readings into understandable trends without uploading the readings to a cloud service.', 'Environment', '["privacy","energy","dashboard"]', 'en', 'published', 'system', 'seed-local-energy-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('private home-energy explainer turn personal electricity readings into understandable trends without uploading the readings to a cloud service. environment ["privacy","energy","dashboard"]')),
  ('seed-note-garden', 'Local knowledge garden', 'Find duplicate notes, stale instructions, and disconnected pieces of personal knowledge while keeping them on-device.', 'Productivity', '["notes","knowledge","search"]', 'en', 'published', 'system', 'seed-note-garden-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('local knowledge garden find duplicate notes, stale instructions, and disconnected pieces of personal knowledge while keeping them on-device. productivity ["notes","knowledge","search"]')),
  ('seed-agent-audit', 'AI-agent permissions auditor', 'Explain what an agent can do, identify broad permissions, and show a readable history of risky operations.', 'Developer tools', '["agents","security","permissions"]', 'en', 'published', 'system', 'seed-agent-audit-v1', unixepoch() * 1000, unixepoch() * 1000, 1, unixepoch() * 1000, lower('ai-agent permissions auditor explain what an agent can do, identify broad permissions, and show a readable history of risky operations. developer tools ["agents","security","permissions"]'));
