-- 017_drop_legacy_stage_tables: team_rosters / team_roster_members (migration
-- 016) supersede the thin stage2_teams / stage2_team_members /
-- stage3_assignments tables. The roster snapshot carries everything those
-- tables held (team codes, roles, station allotment) PLUS the frozen officer
-- print details, so training orders never re-join live HR. One store, one
-- source of truth.

DROP TABLE IF EXISTS stage2_team_members CASCADE;
DROP TABLE IF EXISTS stage2_teams CASCADE;
DROP TABLE IF EXISTS stage3_assignments CASCADE;
