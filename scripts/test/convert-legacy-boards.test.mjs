import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyBoardSql,
  createPsql,
  dollarQuote,
  libpqEnvironment,
  parseArgs,
  run,
  selectBoardsSql,
} from "../convert-legacy-boards.mjs";

/**
 * The one-off legacy board conversion script. The pure parts always run; the
 * end-to-end tests run against a throwaway local Postgres cluster when the
 * Postgres server binaries are installed (initdb, pg_ctl, psql), and skip
 * otherwise. Nothing here touches any other database.
 */

const FIXTURE = JSON.parse(
  readFileSync(new URL("../../apps/web/e2e/fixtures/legacy-annotations.board.json", import.meta.url), "utf8"),
);

test("the connection string reaches psql only through libpq variables", () => {
  const env = libpqEnvironment("postgresql://svc.user:p%40ss%20word@db.example.com:6543/postgres?sslmode=require");
  assert.deepEqual(env, {
    PGHOST: "db.example.com",
    PGPORT: "6543",
    PGUSER: "svc.user",
    PGPASSWORD: "p@ss word",
    PGDATABASE: "postgres",
    PGSSLMODE: "require",
    PGAPPNAME: "airboard-convert-legacy-boards",
    PGCLIENTENCODING: "UTF8",
  });
  assert.throws(() => libpqEnvironment(""), /DATABASE_URL is not set/);
  assert.throws(() => libpqEnvironment("mysql://u:secret@h/db"), (error) => !error.message.includes("secret"));
  assert.throws(() => libpqEnvironment("postgres://u:secret@h/db?weird=1"), (error) => !error.message.includes("secret"));
  assert.throws(() => libpqEnvironment("not a url secret"), (error) => !error.message.includes("secret"));
});

test("options: dry run by default, --out required, board ids checked", () => {
  assert.deepEqual(parseArgs(["--out", "x"]), { mode: "dry-run", out: "x", boards: [], includeLive: false });
  assert.equal(parseArgs(["--apply", "--out=x"]).mode, "apply");
  assert.throws(() => parseArgs([]), /--out DIR is required/);
  assert.throws(() => parseArgs(["--out", "x", "--board", "1; drop table boards"]), /uuid/);
  assert.throws(() => parseArgs(["--out", "x", "--force"]), /Unknown option/);
});

test("the state goes into the SQL as one dollar-quoted literal it cannot break out of", () => {
  const hostile = { label: "$$; drop table boards; --", other: "'); delete from boards; --" };
  const quoted = dollarQuote(JSON.stringify(hostile));
  const tag = quoted.match(/^\$airboard_[0-9a-f]{16}\$/)[0];
  assert.ok(quoted.endsWith(tag));
  assert.equal(quoted.split(tag).length, 3, "the tag appears only around the text");
  const sql = applyBoardSql({ id: "00000000-0000-4000-8000-000000000001", expectedVersion: 7, state: hostile });
  assert.match(sql, /and latest_version = 7/);
  assert.match(sql, /status = 'ended', ended_at = now\(\), updated_at = now\(\)/);
  assert.throws(() => applyBoardSql({ id: "x' or '1'='1", expectedVersion: 1, state: {} }));
  assert.throws(() => selectBoardsSql(["x' or '1'='1"]));
});

test("--apply refuses without an existing --out folder, before reading anything", async () => {
  let called = false;
  await assert.rejects(
    run({ argv: ["--apply", "--out", join(tmpdir(), `missing-${process.pid}-${Date.now()}`)], psql: () => { called = true; }, log: () => {} }),
    /needs an existing --out folder/,
  );
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// End to end against a throwaway local Postgres.

function findBinary(name) {
  const candidates = [
    ...(process.env.PATH ?? "").split(":").map((dir) => join(dir, name)),
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    ...["17", "16", "15"].map((version) => `/usr/lib/postgresql/${version}/bin/${name}`),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

const INITDB = findBinary("initdb");
const PG_CTL = findBinary("pg_ctl");
const PSQL = findBinary("psql");
const postgresAvailable = Boolean(INITDB && PG_CTL && PSQL);

const BOARD = {
  converted: "00000000-0000-4000-8000-00000000000a",
  plain: "00000000-0000-4000-8000-00000000000b",
  deleted: "00000000-0000-4000-8000-00000000000c",
  live: "00000000-0000-4000-8000-00000000000d",
  racing: "00000000-0000-4000-8000-00000000000e",
};

const SCHEMA = `
create table public.boards (
  id uuid primary key,
  title text not null,
  latest_state jsonb not null default '{}'::jsonb,
  latest_version integer not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.board_sessions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid references public.boards(id) on delete cascade,
  status text not null check (status in ('active', 'owner_disconnected', 'locked', 'ended')),
  owner_last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

test("end to end on a local Postgres: dry run reads only, apply backs up, converts, guards and ends sessions", { skip: !postgresAvailable && "Postgres server binaries (initdb, pg_ctl, psql) not found" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "abpg-"));
  const data = join(root, "data");
  const port = String(55_000 + (process.pid % 5_000));
  const sh = (command, args, options = {}) => {
    // The server refuses to start without a valid locale in its environment.
    const result = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, ...options });
    assert.equal(result.status, 0, `${command} ${args.join(" ")}: ${result.stderr}`);
    return result.stdout;
  };
  sh(INITDB, ["-D", data, "-U", "airboard", "--auth=trust", "--no-locale", "-E", "UTF8"]);
  sh(PG_CTL, ["-D", data, "-l", join(root, "log"), "-w", "-o", `-k ${root} -p ${port} -c listen_addresses=''`, "start"]);
  t.after(() => {
    spawnSync(PG_CTL, ["-D", data, "-m", "immediate", "-w", "stop"]);
    rmSync(root, { recursive: true, force: true });
  });

  const env = { DATABASE_URL: `postgresql://airboard@localhost:${port}/postgres?host=${encodeURIComponent(root)}` };
  const realPsql = createPsql({ env: libpqEnvironment(env.DATABASE_URL), psql: PSQL });
  const sql = (text) => realPsql(`\\set ON_ERROR_STOP 1\n${text}`);
  sql(SCHEMA);
  const v2Only = { ...structuredClone(FIXTURE), strokes: {}, elements: {} };
  const insert = (id, title, state, version, extra = "") =>
    sql(`insert into public.boards (id, title, latest_state, latest_version${extra ? ", deleted_at" : ""})
         values ('${id}', '${title}', ${dollarQuote(JSON.stringify(state))}::jsonb, ${version}${extra ? `, ${extra}` : ""});`);
  insert(BOARD.converted, "Legacy annotations", FIXTURE, 3);
  insert(BOARD.plain, "New board", v2Only, 5);
  insert(BOARD.deleted, "Deleted legacy", FIXTURE, 2, "now()");
  insert(BOARD.live, "In a meeting", FIXTURE, 4);
  insert(BOARD.racing, "Saved meanwhile", FIXTURE, 6);
  sql(`insert into public.board_sessions (board_id, status, owner_last_seen_at) values
    ('${BOARD.converted}', 'active', now() - interval '2 hours'),
    ('${BOARD.converted}', 'owner_disconnected', now() - interval '3 hours'),
    ('${BOARD.converted}', 'ended', now() - interval '1 day'),
    ('${BOARD.live}', 'active', now() - interval '1 minute');`);
  const snapshot = () => sql(`select json_build_object(
    'boards', (select json_agg(row_to_json(b) order by id) from public.boards b),
    'sessions', (select json_agg(row_to_json(s) order by id) from public.board_sessions s));`);

  // Dry run: the summary and states are written, the database is not.
  const untouched = snapshot();
  const dryOut = join(root, "dry");
  const logs = [];
  const dry = await run({ argv: ["--out", dryOut], env, log: (line) => logs.push(line), psql: realPsql });
  assert.deepEqual(snapshot(), untouched);
  assert.deepEqual(dry.plans.map((plan) => plan.id).sort(), [BOARD.converted, BOARD.live, BOARD.racing]);
  assert.ok(dry.plans.every((plan) => plan.ok && plan.annotationStrokes === 21 && plan.elementsAdded === 21));
  assert.deepEqual(readdirSync(join(dryOut, "states")).sort(), [BOARD.converted, BOARD.live, BOARD.racing]
    .flatMap((id) => [`${id}.after.json`, `${id}.before.json`]).sort());
  assert.deepEqual(JSON.parse(readFileSync(join(dryOut, "states", `${BOARD.converted}.before.json`), "utf8")).strokes, FIXTURE.strokes);
  assert.ok(logs.some((line) => line.includes("1 (in use)")), "the summary flags a session in use");
  assert.ok(!logs.join("\n").includes(env.DATABASE_URL) && !logs.join("\n").includes(`:${port}`), "the connection string is not printed");

  // Apply: a save lands on one board between the read and the write.
  const applyOut = join(root, "apply");
  await assert.rejects(run({ argv: ["--apply", "--out", applyOut], env, log: () => {}, psql: realPsql }), /existing --out folder/);
  sh("mkdir", [applyOut]);
  const racingPsql = (text) => {
    if (text.includes(`where id = '${BOARD.racing}'`) && text.includes("update public.boards")) {
      sql(`update public.boards set latest_version = latest_version + 1 where id = '${BOARD.racing}';`);
    }
    return realPsql(text);
  };
  const applied = await run({ argv: ["--apply", "--out", applyOut], env, log: () => {}, psql: racingPsql });
  const outcome = Object.fromEntries(applied.results.map((result) => [result.id, result.outcome]));
  assert.equal(outcome[BOARD.converted], "converted");
  assert.match(outcome[BOARD.live], /^skipped: live session in use/);
  assert.match(outcome[BOARD.racing], /^skipped: the board was saved/);

  // Backups hold the rows as they were read.
  for (const id of [BOARD.converted, BOARD.live, BOARD.racing]) {
    const backup = JSON.parse(readFileSync(join(applyOut, "backups", `${id}.json`), "utf8"));
    assert.equal(backup.id, id);
    assert.deepEqual(backup.latest_state.strokes, FIXTURE.strokes);
  }

  const after = snapshot();
  const row = (id) => after.boards.find((board) => board.id === id);
  const plan = applied.plans.find((candidate) => candidate.id === BOARD.converted);
  assert.equal(row(BOARD.converted).latest_version, 4);
  assert.deepEqual(row(BOARD.converted).latest_state, plan.after);
  assert.deepEqual(row(BOARD.converted).latest_state.strokes, {});
  assert.equal(row(BOARD.converted).updated_at, untouched.boards.find((board) => board.id === BOARD.converted).updated_at);
  const sessions = after.sessions.filter((session) => session.board_id === BOARD.converted);
  assert.deepEqual(sessions.map((session) => session.status), ["ended", "ended", "ended"]);
  assert.equal(sessions.filter((session) => session.ended_at).length, 2, "only the open sessions are ended now");
  for (const id of [BOARD.plain, BOARD.deleted, BOARD.live]) {
    assert.deepEqual(row(id), untouched.boards.find((board) => board.id === id), `${id} is untouched`);
  }
  assert.equal(row(BOARD.racing).latest_version, 7, "the save in between is kept");
  assert.deepEqual(row(BOARD.racing).latest_state.strokes, FIXTURE.strokes);
  assert.equal(after.sessions.find((session) => session.board_id === BOARD.live).status, "active");
  assert.deepEqual(applied.verification, [{ id: BOARD.converted, latest_version: 4, has_legacy_annotations: false, open_sessions: 0, state_matches: true }]);

  // Running again converts nothing new on the converted board.
  const again = await run({ argv: ["--apply", "--out", applyOut, "--board", BOARD.converted], env, log: () => {}, psql: realPsql });
  assert.deepEqual(again.plans, []);
  assert.equal(snapshot().boards.find((board) => board.id === BOARD.converted).latest_version, 4);
});
