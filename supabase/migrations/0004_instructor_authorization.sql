-- Dynamic instructor allowlist + owner/admin capability.
--
-- Replaces the hardcoded TypeScript allowlist with a database table that
-- is the one authoritative source of truth for "who may ever become an
-- instructor" — consulted by the signup flow (server-side, via the
-- admin client, before an account is created) and by the trigger below
-- (which is what actually grants instructor access, and only ever does
-- so after real email verification).
--
-- The table itself has RLS enabled with NO policies for authenticated
-- or anon — every read and write goes through the SECURITY DEFINER
-- functions below, which check authorization from auth.uid() inside
-- Postgres itself. There is no path to this table that trusts client
-- input for who's allowed to call these functions.

create table instructor_allowlist (
  email text primary key,
  is_owner boolean not null default false,
  authorized_by uuid references auth.users (id),
  authorized_at timestamptz not null default now()
);

alter table instructor_allowlist enable row level security;
-- Deliberately no policies here — see comment above.

-- ---------------------------------------------------------------------
-- current_user_is_owner(): the one function that answers "can this
-- caller manage the instructor list." Used inside every mutating
-- function below AND by the app to decide whether to render the
-- "Manage Instructors" control — the latter is presentation only, the
-- former is the actual boundary.
-- ---------------------------------------------------------------------

create or replace function current_user_is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from instructor_allowlist ia
    join auth.users u on lower(u.email) = lower(ia.email)
    where u.id = auth.uid() and ia.is_owner
  );
$$;

grant execute on function current_user_is_owner() to authenticated;

-- ---------------------------------------------------------------------
-- add_instructor_email(): owner-only. Makes an email ELIGIBLE to
-- complete instructor signup — it does not create an account, does not
-- authenticate anyone, and proves nothing about email ownership. That
-- proof still happens through Supabase's own verification when the
-- person actually signs up (see the trigger below).
-- ---------------------------------------------------------------------

create or replace function add_instructor_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not current_user_is_owner() then
    raise exception 'Only the account owner can authorize instructors.';
  end if;

  insert into instructor_allowlist (email, authorized_by)
  values (lower(trim(p_email)), auth.uid())
  on conflict (email) do nothing;
end;
$$;

grant execute on function add_instructor_email(text) to authenticated;

-- ---------------------------------------------------------------------
-- remove_instructor_email(): owner-only. Protects the owner row from
-- self-removal. Actually revokes — deletes the allowlist entry AND any
-- instructor course_members rows for that email, rather than only
-- hiding the entry from the admin UI.
-- ---------------------------------------------------------------------

create or replace function remove_instructor_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_is_owner boolean;
begin
  if not current_user_is_owner() then
    raise exception 'Only the account owner can revoke instructors.';
  end if;

  select is_owner into v_is_owner from instructor_allowlist where email = v_email;

  if v_is_owner then
    raise exception 'The owner account cannot be removed.';
  end if;

  delete from course_members
  where role = 'instructor'
    and user_id in (select id from auth.users where lower(email) = v_email);

  delete from instructor_allowlist where email = v_email;
end;
$$;

grant execute on function remove_instructor_email(text) to authenticated;

-- ---------------------------------------------------------------------
-- list_instructor_status(): owner-only read model for the Manage
-- Instructors screen. SECURITY DEFINER because it needs to read
-- auth.users (never exposed to PostgREST directly) to show whether an
-- authorized email has actually registered and verified yet.
-- ---------------------------------------------------------------------

create or replace function list_instructor_status()
returns table (
  email text,
  is_owner boolean,
  authorized_at timestamptz,
  user_registered boolean,
  email_verified boolean,
  is_active_instructor boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not current_user_is_owner() then
    raise exception 'Only the account owner can view instructor status.';
  end if;

  return query
  select
    ia.email,
    ia.is_owner,
    ia.authorized_at,
    (u.id is not null) as user_registered,
    (u.email_confirmed_at is not null) as email_verified,
    exists (
      select 1 from course_members cm
      where cm.user_id = u.id and cm.role = 'instructor'
    ) as is_active_instructor
  from instructor_allowlist ia
  left join auth.users u on lower(u.email) = ia.email
  order by ia.authorized_at;
end;
$$;

grant execute on function list_instructor_status() to authenticated;

-- ---------------------------------------------------------------------
-- The actual grant: when an account's email becomes verified (Supabase
-- sets auth.users.email_confirmed_at, regardless of which flow caused
-- it), and that email is on the allowlist, enroll that user as
-- 'instructor' on every current course. This is the one place
-- instructor access is actually GRANTED — not the signup form, not the
-- allowlist check, not any application code path. A row here only ever
-- appears because Supabase itself verified the email.
--
-- Granting on every course (not just one) is a Milestone-1 simplification
-- for a single-course deployment — see docs/DECISIONS.md.
-- ---------------------------------------------------------------------

create or replace function handle_instructor_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from instructor_allowlist where email = lower(new.email)) then
    insert into course_members (course_id, user_id, role)
    select id, new.id, 'instructor' from courses
    on conflict (course_id, user_id) do update set role = 'instructor';
  end if;
  return new;
end;
$$;

create trigger on_instructor_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function handle_instructor_email_confirmed();

-- ---------------------------------------------------------------------
-- Bootstrap. ezaz.labib@gmail.com is the owner; labibahm@msu.edu is an
-- ordinary authorized instructor. Neither row grants instructor access
-- by itself — see the trigger above. authorized_by is null because no
-- admin action created these; they're the system's bootstrap state.
-- ---------------------------------------------------------------------

insert into instructor_allowlist (email, is_owner)
values
  ('ezaz.labib@gmail.com', true),
  ('labibahm@msu.edu', false)
on conflict (email) do nothing;
