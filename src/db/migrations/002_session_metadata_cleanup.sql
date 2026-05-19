begin;

alter table therapy_sessions add column if not exists therapist_name text;
alter table therapy_sessions add column if not exists case_alias text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'therapy_sessions'
      and column_name = 'therapist_id'
  ) then
    update therapy_sessions ts
    set therapist_name = u.display_name
    from users u
    where ts.therapist_id = u.id
      and ts.therapist_name is null;
  end if;
end $$;

drop index if exists therapy_sessions_org_therapist_date_idx;
alter table therapy_sessions drop constraint if exists therapy_sessions_therapist_id_fkey;
alter table therapy_sessions drop column if exists therapist_id;

alter table therapy_sessions drop column if exists modality;

create index if not exists therapy_sessions_org_therapist_name_date_idx
  on therapy_sessions (organization_id, therapist_name, session_date desc, id desc)
  where therapist_name is not null;

alter table therapy_sessions
  alter column session_number type text using session_number::text;

alter table therapy_sessions
  drop constraint if exists therapy_sessions_session_number_digits_chk;
alter table therapy_sessions
  add constraint therapy_sessions_session_number_digits_chk
  check (session_number is null or session_number ~ '^[0-9]+$');

commit;
