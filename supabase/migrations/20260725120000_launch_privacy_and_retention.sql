-- Launch privacy correction and enforceable deleted-content retention.
--
-- Voice traces are operational reliability telemetry. Historical rows may
-- contain finalized speech or board labels from earlier pilot builds; scrub
-- that customer content recursively before a wider customer release.

create or replace function public.airboard_redact_trace_content(input jsonb)
returns jsonb
language sql
immutable
strict
set search_path = public
as $$
  select case jsonb_typeof(input)
    when 'object' then (
      select coalesce(
        jsonb_object_agg(
          key,
          case
            when key ~* '^(transcript|previousTranscript|utterance|command|instruction|normalizedText|label|term|meetingTitle|boardText)$'
              then to_jsonb('[CONTENT_REDACTED]'::text)
            when key ~* '(authorization|api[_-]?key|(access|refresh|auth|bearer)[_-]?token|^token$|secret|password)'
              then to_jsonb('[REDACTED]'::text)
            else public.airboard_redact_trace_content(value)
          end
        ),
        '{}'::jsonb
      )
      from jsonb_each(input)
    )
    when 'array' then (
      select coalesce(
        jsonb_agg(public.airboard_redact_trace_content(value)),
        '[]'::jsonb
      )
      from jsonb_array_elements(input)
    )
    else input
  end
$$;

update public.voice_trace_events
set data = public.airboard_redact_trace_content(data)
where data is not null;

drop function public.airboard_redact_trace_content(jsonb);

comment on table public.voice_trace_events is
  'Content-free operational voice stages. Speech transcripts, commands, board labels, credentials, and raw media must not be stored.';

comment on column public.organization_policies.content_retention_days is
  'Number of days a soft-deleted board remains recoverable in trash before lifecycle hard deletion.';
