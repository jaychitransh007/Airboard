#!/usr/bin/env node
// One-off conversion of saved boards from legacy annotation strokes to v2
// scene elements (shape-merge phase 2, Docs/Refactoring Plan.md). Approved by
// the owner as a one-off because production held only a handful of boards
// with legacy strokes.
//
//   DATABASE_URL=... node scripts/convert-legacy-boards.mjs --out DIR [--dry-run]
//   DATABASE_URL=... node scripts/convert-legacy-boards.mjs --out DIR --apply
//
// Options:
//   --out DIR          where states, backups and results go (required). For
//                      --apply the folder must already exist.
//   --dry-run          the default: a read-only transaction selects every
//                      board (not deleted) whose latest_state holds a committed
//                      annotation stroke, converts it in memory and writes
//                      DIR/states/<id>.before.json and <id>.after.json (the
//                      latest_state only, ready for the render check) and
//                      DIR/dry-run-summary.json, then prints a summary table.
//   --apply            the same selection and conversion; then backs up
//                      every selected row (id, title, latest_version,
//                      latest_state) to DIR/backups/<id>.json and reads each
//                      backup back before writing anything; then, per board,
//                      in one statement: writes the converted latest_state
//                      and latest_version + 1 only if latest_version is still
//                      the one read (a save in between aborts that board),
//                      and ends the board's open live sessions as the API's
//                      own end-session route does (status 'ended', ended_at,
//                      updated_at), so the next open starts from the
//                      converted state. Results go to DIR/apply-results.json.
//   --board ID         only this board (repeatable).
//   --include-live     also apply to a board whose live session the owner was
//                      in during the last 15 minutes (skipped otherwise; the
//                      session would be ended under them).
//
// A board is not written when its converted state fails validation or the
// diagram it shows would change (legacyConversionGraphDiff).
//
// The connection string is read from DATABASE_URL and handed to psql through
// libpq environment variables, never on the command line, and is never
// printed. It needs psql (Postgres client 14 or later) on PATH or in PSQL.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  convertLegacyBoardState,
  legacyConversionGraphDiff,
  validateConvertedBoardState,
} from "../packages/core/src/legacyStrokeMigration.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIVE_WINDOW_MINUTES = 15;

/** Boards whose latest_state holds a committed annotation stroke. */
export const LEGACY_FILTER_SQL = `jsonb_typeof(b.latest_state -> 'strokes') = 'object'
    and exists (
      select 1 from jsonb_each(b.latest_state -> 'strokes') as s(key, value)
      where jsonb_typeof(s.value) = 'object'
        and s.value ->> 'status' = 'committed'
        and jsonb_typeof(s.value -> 'annotation') = 'object'
    )`;

export function parseArgs(argv) {
  const options = { mode: "dry-run", out: null, boards: [], includeLive: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.mode = "dry-run";
    else if (arg === "--apply") options.mode = "apply";
    else if (arg === "--include-live") options.includeLive = true;
    else if (arg === "--out") options.out = argv[++index] ?? null;
    else if (arg.startsWith("--out=")) options.out = arg.slice("--out=".length);
    else if (arg === "--board") options.boards.push(argv[++index] ?? "");
    else if (arg.startsWith("--board=")) options.boards.push(arg.slice("--board=".length));
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.out) throw new Error("--out DIR is required");
  for (const id of options.boards) {
    if (!UUID.test(id)) throw new Error(`--board must be a board id (uuid): ${JSON.stringify(id)}`);
  }
  return options;
}

/**
 * libpq environment for a postgres:// connection string, so it never appears
 * in a process list. Throws without echoing the string.
 */
export function libpqEnvironment(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid postgres:// URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must start with postgres:// or postgresql://");
  }
  const env = {};
  if (url.hostname) env.PGHOST = decodeURIComponent(url.hostname.replace(/^\[|\]$/g, ""));
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database) env.PGDATABASE = database;
  const supported = {
    host: "PGHOST",
    port: "PGPORT",
    user: "PGUSER",
    password: "PGPASSWORD",
    dbname: "PGDATABASE",
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    connect_timeout: "PGCONNECT_TIMEOUT",
    application_name: "PGAPPNAME",
    options: "PGOPTIONS",
    target_session_attrs: "PGTARGETSESSIONATTRS",
  };
  for (const [key, value] of url.searchParams) {
    const name = supported[key];
    if (!name) throw new Error(`DATABASE_URL has an unsupported parameter: ${key}`);
    env[name] = value;
  }
  env.PGAPPNAME ??= "airboard-convert-legacy-boards";
  env.PGCLIENTENCODING = "UTF8";
  return env;
}

/** A dollar-quoted SQL literal whose tag cannot occur in the text. */
export function dollarQuote(text) {
  for (;;) {
    const tag = `$airboard_${randomBytes(8).toString("hex")}$`;
    if (!text.includes(tag)) return `${tag}${text}${tag}`;
  }
}

function boardFilterSql(boardIds) {
  if (boardIds.length === 0) return "";
  for (const id of boardIds) if (!UUID.test(id)) throw new Error(`Not a board id: ${id}`);
  return `and b.id in (${boardIds.map((id) => `'${id.toLowerCase()}'`).join(", ")})`;
}

/** Read-only selection of the boards to convert, with their open live sessions. */
export function selectBoardsSql(boardIds = []) {
  return `\\set ON_ERROR_STOP 1
begin transaction isolation level repeatable read read only;
select json_build_object(
  'boards', coalesce((
    select json_agg(row_to_json(selected) order by selected.created_at, selected.id)
    from (
      select b.id, b.title, b.latest_version, b.latest_state, b.created_at, b.archived_at,
        coalesce((
          select json_agg(json_build_object(
            'id', s.id, 'status', s.status,
            'owner_last_seen_at', s.owner_last_seen_at, 'updated_at', s.updated_at,
            'recently_active', s.owner_last_seen_at > now() - interval '${LIVE_WINDOW_MINUTES} minutes'
          ) order by s.created_at)
          from public.board_sessions s
          where s.board_id = b.id and s.status <> 'ended'
        ), '[]'::json) as open_sessions
      from public.boards b
      where b.deleted_at is null
        and ${LEGACY_FILTER_SQL}
        ${boardFilterSql(boardIds)}
    ) as selected
  ), '[]'::json),
  'other_boards_with_strokes', (
    select count(*) from public.boards b
    where b.deleted_at is null
      and not (${LEGACY_FILTER_SQL})
      and jsonb_typeof(b.latest_state -> 'strokes') = 'object'
      and b.latest_state -> 'strokes' <> '{}'::jsonb
  )
);
commit;
`;
}

/**
 * One board's write: the converted state and version + 1 only while the row
 * still has the version that was read, then its open live sessions ended,
 * all in one statement.
 */
export function applyBoardSql({ id, expectedVersion, state }) {
  if (!UUID.test(id)) throw new Error(`Not a board id: ${id}`);
  if (!Number.isSafeInteger(expectedVersion)) throw new Error(`Not a version: ${expectedVersion}`);
  return `\\set ON_ERROR_STOP 1
begin;
with updated as (
  update public.boards
  set latest_state = ${dollarQuote(JSON.stringify(state))}::jsonb,
      latest_version = latest_version + 1
  where id = '${id.toLowerCase()}'
    and latest_version = ${expectedVersion}
    and deleted_at is null
  returning id, latest_version
), ended as (
  update public.board_sessions
  set status = 'ended', ended_at = now(), updated_at = now()
  where board_id in (select id from updated) and status <> 'ended'
  returning id
)
select json_build_object(
  'updated', (select row_to_json(u) from updated u),
  'ended_session_ids', coalesce((select json_agg(id) from ended), '[]'::json)
);
commit;
`;
}

/** Read-only check after applying: each board's version and whether legacy strokes remain. */
export function verifySql(boardIds) {
  return `\\set ON_ERROR_STOP 1
begin transaction read only;
select coalesce(json_agg(json_build_object(
  'id', b.id,
  'latest_version', b.latest_version,
  'latest_state', b.latest_state,
  'has_legacy_annotations', ${LEGACY_FILTER_SQL},
  'open_sessions', (select count(*) from public.board_sessions s where s.board_id = b.id and s.status <> 'ended')
)), '[]'::json)
from public.boards b
where b.id in (${boardIds.map((id) => `'${id.toLowerCase()}'`).join(", ")});
commit;
`;
}

function withoutPgVariables(source) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !name.startsWith("PG")));
}

/** JSON with object keys sorted, so two equal states compare equal as text. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createPsql({ env, psql = process.env.PSQL || "psql" }) {
  return (sql) => {
    const result = spawnSync(psql, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
      input: sql,
      // Only this connection's PG* settings: none leak in from the shell.
      env: { ...withoutPgVariables(process.env), ...env },
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (result.error) throw new Error(`psql could not run: ${result.error.message}`);
    if (result.status !== 0) {
      // psql's own messages name the failing statement, not the password.
      throw new Error(`psql failed (${result.status}): ${String(result.stderr).trim().slice(0, 2000)}`);
    }
    const text = String(result.stdout).trim();
    return text ? JSON.parse(text) : null;
  };
}

/** Converts each selected board in memory and checks the result. */
export function planConversions(boards) {
  return boards.map((board) => {
    const before = board.latest_state ?? {};
    const conversion = convertLegacyBoardState(before);
    const problems = validateConvertedBoardState(conversion.state);
    const diagramChanges = legacyConversionGraphDiff(before, conversion.state);
    return {
      id: board.id,
      title: board.title,
      latestVersion: board.latest_version,
      openSessions: board.open_sessions ?? [],
      before,
      after: conversion.state,
      annotationStrokes: conversion.annotationStrokeIds.length,
      strokesBefore: Object.keys(before.strokes ?? {}).length,
      strokesAfter: Object.keys(conversion.state.strokes ?? {}).length,
      elementsAdded: conversion.addedElementIds.length,
      mirrorsReplaced: conversion.replacedMirrorIds.length,
      orphanMirrors: conversion.orphanMirrorIds.length,
      problems,
      diagramChanges,
      ok: conversion.changed && problems.length === 0 && diagramChanges.length === 0,
    };
  });
}

function summaryRow(plan) {
  return {
    board: plan.id,
    title: String(plan.title ?? "").slice(0, 32),
    version: plan.latestVersion,
    annotations: plan.annotationStrokes,
    strokes: `${plan.strokesBefore}->${plan.strokesAfter}`,
    added: plan.elementsAdded,
    mirrors: plan.mirrorsReplaced,
    live: plan.openSessions.length === 0
      ? "-"
      : `${plan.openSessions.length}${plan.openSessions.some((session) => session.recently_active) ? " (in use)" : ""}`,
    valid: plan.problems.length === 0 ? "ok" : `${plan.problems.length} problem(s)`,
    diagram: plan.diagramChanges.length === 0 ? "same" : `${plan.diagramChanges.length} change(s)`,
  };
}

function printTable(rows, log) {
  if (rows.length === 0) {
    log("(no boards)");
    return;
  }
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column]).length)));
  const line = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join("  ");
  log(line(columns));
  log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) log(line(columns.map((column) => row[column])));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flush: true });
}

function printProblems(plans, log) {
  for (const plan of plans) {
    for (const problem of plan.problems) log(`  ${plan.id}: invalid: ${problem}`);
    for (const change of plan.diagramChanges) log(`  ${plan.id}: diagram: ${change}`);
  }
}

export async function run({ argv, env = process.env, log = console.log, psql: injectedPsql } = {}) {
  const options = parseArgs(argv);
  const out = resolve(options.out);
  if (options.mode === "apply" && !(existsSync(out) && statSync(out).isDirectory())) {
    throw new Error(`--apply needs an existing --out folder for the backups: ${out}`);
  }
  const psql = injectedPsql ?? createPsql({ env: libpqEnvironment(env.DATABASE_URL) });

  const selection = psql(selectBoardsSql(options.boards));
  const plans = planConversions(selection.boards);
  log(`${options.mode}: ${plans.length} board(s) with committed legacy annotation strokes`);
  printTable(plans.map(summaryRow), log);
  printProblems(plans, log);
  if (Number(selection.other_boards_with_strokes) > 0) {
    log(`Note: ${selection.other_boards_with_strokes} other board(s) hold only plain ink or deleted strokes; not selected.`);
  }

  if (options.mode === "dry-run") {
    const states = join(out, "states");
    mkdirSync(states, { recursive: true });
    for (const plan of plans) {
      writeJson(join(states, `${plan.id}.before.json`), plan.before);
      writeJson(join(states, `${plan.id}.after.json`), plan.after);
    }
    writeJson(join(out, "dry-run-summary.json"), {
      at: new Date().toISOString(),
      boards: plans.map(({ before: _before, after: _after, ...plan }) => plan),
      otherBoardsWithStrokes: Number(selection.other_boards_with_strokes),
    });
    log(`Wrote ${plans.length * 2} state file(s) to ${states} and ${join(out, "dry-run-summary.json")}. Nothing was written to the database.`);
    return { mode: "dry-run", plans };
  }

  // --apply: back up every selected row and read the backups back first.
  const backups = join(out, "backups");
  mkdirSync(backups, { recursive: true });
  for (const plan of plans) {
    writeJson(join(backups, `${plan.id}.json`), {
      id: plan.id,
      title: plan.title,
      latest_version: plan.latestVersion,
      latest_state: plan.before,
      backed_up_at: new Date().toISOString(),
    });
    writeJson(join(backups, `${plan.id}.converted.json`), plan.after);
  }
  for (const plan of plans) {
    const backup = JSON.parse(readFileSync(join(backups, `${plan.id}.json`), "utf8"));
    if (
      backup.id !== plan.id ||
      backup.latest_version !== plan.latestVersion ||
      JSON.stringify(backup.latest_state) !== JSON.stringify(plan.before)
    ) {
      throw new Error(`The backup of ${plan.id} did not read back as written; nothing was applied.`);
    }
  }
  log(`Backed up ${plans.length} board(s) to ${backups}.`);

  const results = [];
  for (const plan of plans) {
    const result = { id: plan.id, title: plan.title, fromVersion: plan.latestVersion };
    if (!plan.ok) {
      results.push({ ...result, outcome: "skipped: conversion failed its checks" });
      continue;
    }
    if (!options.includeLive && plan.openSessions.some((session) => session.recently_active)) {
      results.push({ ...result, outcome: `skipped: live session in use in the last ${LIVE_WINDOW_MINUTES} minutes (--include-live to apply)` });
      continue;
    }
    try {
      const written = psql(applyBoardSql({ id: plan.id, expectedVersion: plan.latestVersion, state: plan.after }));
      if (!written?.updated) {
        results.push({ ...result, outcome: "skipped: the board was saved or deleted since it was read" });
        continue;
      }
      results.push({
        ...result,
        outcome: "converted",
        toVersion: written.updated.latest_version,
        endedSessionIds: written.ended_session_ids,
      });
    } catch (error) {
      results.push({ ...result, outcome: `failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const converted = results.filter((result) => result.outcome === "converted").map((result) => result.id);
  const verification = converted.length > 0 ? psql(verifySql(converted)) : [];
  const afterById = new Map(plans.map((plan) => [plan.id, canonicalJson(plan.after)]));
  for (const row of verification) {
    row.state_matches = canonicalJson(row.latest_state) === afterById.get(row.id);
    delete row.latest_state;
  }
  writeJson(join(out, "apply-results.json"), { at: new Date().toISOString(), results, verification });
  printTable(results.map((result) => ({
    board: result.id,
    outcome: result.outcome,
    version: result.toVersion ? `${result.fromVersion}->${result.toVersion}` : result.fromVersion,
    ended: result.endedSessionIds?.length ?? 0,
  })), log);
  const leftovers = verification.filter((row) => row.has_legacy_annotations || row.open_sessions > 0 || !row.state_matches);
  if (leftovers.length > 0) log(`Verification: ${leftovers.length} converted board(s) still show legacy strokes, open sessions or a stored state that differs from the conversion.`);
  else if (converted.length > 0) log(`Verification: ${converted.length} board(s) match the conversion exactly, with no legacy annotation strokes and no open live session.`);
  log(`Results in ${join(out, "apply-results.json")}.`);
  return { mode: "apply", plans, results, verification };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run({ argv: process.argv.slice(2) })
    .then((outcome) => {
      const failed = outcome.mode === "apply"
        ? outcome.results.some((result) => result.outcome !== "converted")
        : outcome.plans.some((plan) => !plan.ok);
      process.exitCode = failed ? 1 : 0;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}

export const SCRIPT_PATH = fileURLToPath(import.meta.url);
