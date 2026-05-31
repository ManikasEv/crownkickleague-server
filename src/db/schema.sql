CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teams
DROP CONSTRAINT IF EXISTS teams_owner_user_id_key;

CREATE TABLE IF NOT EXISTS team_members (
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_invites (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  inviter_user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  invitee_user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS knockout_matches (
  id BIGSERIAL PRIMARY KEY,
  stage TEXT NOT NULL,
  match_number INTEGER NOT NULL,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_score INTEGER,
  away_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stage, match_number)
);

CREATE TABLE IF NOT EXISTS match_predictions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  match_id BIGINT NOT NULL REFERENCES knockout_matches(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL DEFAULT 'score',
  predicted_outcome TEXT,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, match_id)
);

ALTER TABLE match_predictions
ADD COLUMN IF NOT EXISTS prediction_type TEXT NOT NULL DEFAULT 'score';

ALTER TABLE match_predictions
ADD COLUMN IF NOT EXISTS predicted_outcome TEXT;

ALTER TABLE match_predictions
ALTER COLUMN predicted_home_score DROP NOT NULL;

ALTER TABLE match_predictions
ALTER COLUMN predicted_away_score DROP NOT NULL;

CREATE TABLE IF NOT EXISTS tournament_fixtures (
  id BIGSERIAL PRIMARY KEY,
  external_fixture_id BIGINT UNIQUE,
  source TEXT,
  matchday INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'group',
  match_order INTEGER NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  kickoff_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_score INTEGER,
  away_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (matchday, match_order)
);

ALTER TABLE tournament_fixtures
ADD COLUMN IF NOT EXISTS external_fixture_id BIGINT UNIQUE;

ALTER TABLE tournament_fixtures
ADD COLUMN IF NOT EXISTS source TEXT;

CREATE TABLE IF NOT EXISTS fixture_predictions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  fixture_id BIGINT NOT NULL REFERENCES tournament_fixtures(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL DEFAULT 'outcome',
  predicted_outcome TEXT,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, fixture_id)
);

CREATE TABLE IF NOT EXISTS winner_bonus_predictions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  predicted_team TEXT NOT NULL,
  potential_points INTEGER NOT NULL DEFAULT 3,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
