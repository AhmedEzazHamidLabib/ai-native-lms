-- 0047 added p_is_diagnostic as a new trailing parameter to
-- create_assessment() via CREATE OR REPLACE, expecting it to behave
-- like appending a column to a table — it doesn't. Postgres only
-- replaces a function with the EXACT SAME parameter signature; a
-- different arity creates a SECOND overload instead. That left two
-- create_assessment() functions (10-arg and 11-arg-with-default), and
-- PostgREST's RPC call (named parameters, omitting p_is_diagnostic for
-- every existing call site) could no longer pick one: "Could not
-- choose the best candidate function." Every create_assessment call
-- in the app broke, caught immediately by the existing
-- assessment-builder.integration.test.ts suite.
--
-- Fix: drop the stale 10-arg overload. The 11-arg version (with
-- p_is_diagnostic default false) from 0047 is the only one that
-- should exist, and its default keeps every existing call site
-- working unchanged.

drop function if exists create_assessment(
  uuid, uuid, text, text, assessment_kind, integer, text, text, text, jsonb
);
