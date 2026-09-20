-- Instructor revocation/re-authorization lifecycle fix, plus
-- instructor-initiated course creation and instructor-name display on
-- the course catalog.
--
-- ---------------------------------------------------------------------
-- THE BUG, PRECISELY
-- ---------------------------------------------------------------------
-- Instructor access is granted in exactly one place:
-- handle_instructor_email_confirmed(), a trigger that fires "after
-- update of email_confirmed_at on auth.users ... when (old.email_confirmed_at
-- is null and new.email_confirmed_at is not null)" — i.e. only on the
-- ONE-TIME transition from unverified to verified. It inserts
-- course_members(role='instructor') rows for every course.
--
-- remove_instructor_email() (revoke) deletes those course_members rows
-- AND the instructor_allowlist row — correct, and it does NOT touch
-- auth.users at all, so the Auth identity survives intact (this was
-- already correct; see "WHAT THIS MIGRATION DELIBERATELY DOES NOT
-- CHANGE" below).
--
-- add_instructor_email() (re-authorize) only re-inserted the
-- instructor_allowlist row. For an email whose Auth account was
-- created and verified LONG ago (the normal case for someone being
-- re-authorized — they already have a real, used account), email_confirmed_at
-- never changes again, so the trigger never re-fires, and the
-- course_members rows the revoke deleted were never restored. The
-- result: sign-in correctly finds no instructor course_members row and
-- denies access ("This account doesn't have instructor access"); signup
-- correctly finds an existing, verified Auth account and refuses to
-- create a second one ("This account already exists and is verified").
-- Both responses are individually correct; together they're a dead
-- end, because nothing in the system re-grants course_members for an
-- ALREADY-EXISTING, ALREADY-VERIFIED account on re-authorization.
--
-- THE FIX: add_instructor_email() now also reconciles course_members
-- immediately for any auth.users row that already matches the email
-- and is already verified — covering exactly the case the one-time
-- trigger structurally cannot cover a second time. A brand-new email
-- with no Auth account yet is unaffected by this and continues through
-- the existing signup + trigger path exactly as before.
--
-- ---------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT CHANGE
-- ---------------------------------------------------------------------
-- - remove_instructor_email() already never touches auth.users — the
--   Auth identity is never deleted on revocation. Authentication
--   identity and instructor authorization were already modeled as
--   separate concepts on the revoke side; only the re-authorize side
--   had the gap.
-- - courses/units/lectures/materials/assessments have no FK to a
--   specific instructor's user_id at all — only course_members
--   (a join table) does, and only course_members.user_id has
--   `on delete cascade` to auth.users, which is irrelevant here since
--   auth.users is never deleted. Revoking an instructor deletes their
--   course_members row(s) only; every other table is untouched. There
--   is therefore no destructive cascade to guard against — this was
--   already safe, and this migration does not change it.
-- - Every authorized+verified instructor currently has access to
--   EVERY course (a documented Milestone-1 simplification — see the
--   original trigger's comment in 0004_instructor_authorization.sql
--   and docs/DECISIONS.md). This migration's new create_course()
--   function preserves that exact invariant for newly created courses
--   rather than introducing a partial, inconsistent per-course ACL —
--   see its comment below for why.

create or replace function add_instructor_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not current_user_is_owner() then
    raise exception 'Only the account owner can authorize instructors.';
  end if;

  insert into instructor_allowlist (email, authorized_by)
  values (v_email, auth.uid())
  on conflict (email) do nothing;

  -- Reconcile an existing, already-verified Auth account immediately.
  -- Harmless no-op for a brand-new email with no Auth account yet, or
  -- one that hasn't verified — those continue through the normal
  -- signup + one-time trigger path.
  insert into course_members (course_id, user_id, role)
  select c.id, u.id, 'instructor'
  from courses c
  cross join auth.users u
  where lower(u.email) = v_email
    and u.email_confirmed_at is not null
  on conflict (course_id, user_id) do update set role = 'instructor';
end;
$$;

-- ---------------------------------------------------------------------
-- create_course(): the first client-reachable path that can create a
-- `courses` row (previously service-role/seed-only — see 0001's
-- comment history and docs/DECISIONS.md). Owner-or-instructor-gated,
-- identity taken only from auth.uid() — a client cannot supply "who
-- created this" or escalate a student into a creator.
--
-- Grants course_members(role='instructor') to the creator AND to every
-- other currently-verified authorized instructor, matching the
-- existing "every instructor has access to every course" invariant
-- instead of quietly introducing a second, inconsistent per-course
-- ACL model where only some courses are globally visible to
-- instructors and others aren't. courses.created_by still records who
-- actually created it, for display (see get_course_instructors below)
-- and future history — that's an attribution fact, not an access-
-- control mechanism.
-- ---------------------------------------------------------------------

alter table courses add column if not exists created_by uuid references auth.users (id) on delete set null;

create or replace function create_course(
  p_code text,
  p_title text,
  p_term text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_code text := btrim(p_code);
  v_title text := btrim(p_title);
  v_term text := btrim(p_term);
begin
  if not exists (
    select 1 from course_members where user_id = auth.uid() and role = 'instructor'
  ) then
    raise exception 'Not authorized.';
  end if;

  if v_code = '' or v_title = '' or v_term = '' then
    raise exception 'Course code, title, and term are all required.';
  end if;

  insert into courses (code, title, term, created_by)
  values (v_code, v_title, v_term, auth.uid())
  returning id into v_course_id;

  insert into course_members (course_id, user_id, role)
  select v_course_id, u.id, 'instructor'
  from instructor_allowlist ia
  join auth.users u on lower(u.email) = ia.email
  where u.email_confirmed_at is not null
  on conflict (course_id, user_id) do nothing;

  return v_course_id;
end;
$$;

grant execute on function create_course(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- get_course_instructors(): safe, name-only instructor attribution for
-- the course catalog ("Available Courses") — reachable by any
-- authenticated user browsing courses they aren't a member of yet,
-- which existing `profiles` RLS deliberately does not allow a direct
-- select for (a non-member has no path to another user's profile row).
-- Names only, never emails. Falls back, per course, in this order:
-- the recorded creator (courses.created_by) -> the allowlist owner, if
-- they're a member of this course -> whichever instructor has been a
-- member of this course longest. All three tie-break conditions are
-- written to always evaluate to true/false, never NULL, precisely to
-- avoid the NULL-comparison authorization-check mistake fixed in
-- 0046_fix_instructor_check_regression.sql — this isn't itself an
-- authorization check, but the same three-valued-logic trap applies to
-- any boolean-driven ORDER BY just as much as to an `if`.
-- ---------------------------------------------------------------------

create or replace function get_course_instructors()
returns table (course_id uuid, instructor_name text)
language sql
security definer
stable
set search_path = public
as $$
  select distinct on (cm.course_id)
    cm.course_id,
    p.full_name as instructor_name
  from course_members cm
  join courses c on c.id = cm.course_id
  join auth.users u on u.id = cm.user_id
  left join profiles p on p.user_id = cm.user_id
  where cm.role = 'instructor'
  order by
    cm.course_id,
    (c.created_by is not null and cm.user_id = c.created_by) desc,
    (exists (
      select 1 from instructor_allowlist ia
      where ia.email = lower(u.email) and ia.is_owner
    )) desc,
    cm.created_at asc;
$$;

grant execute on function get_course_instructors() to authenticated;
