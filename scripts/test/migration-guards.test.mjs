import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

/** Top-level statements, with function and DO bodies ($$ … $$) blanked out. */
function topLevelStatements(text) {
  return text
    .replace(/(\$\w*\$)[\s\S]*?\1/g, "$$$$")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function unguardedStatements(sql) {
  const text = sql.replace(/--.*$/gm, "");
  const problems = [];
  const has = (pattern) => pattern.test(text);
  for (const match of text.matchAll(/\bcreate\s+(table|index|unique\s+index|schema|extension)\s+(?!if\s+not\s+exists)/gi)) {
    problems.push(`create ${match[1].toLowerCase()} without "if not exists"`);
  }
  for (const match of text.matchAll(/\bcreate\s+(function|view)\s/gi)) {
    problems.push(`create ${match[1].toLowerCase()} without "or replace"`);
  }
  for (const match of text.matchAll(/\bdrop\s+(table|index|function|trigger|policy|view|type|constraint)\s+(?!if\s+exists)/gi)) {
    problems.push(`drop ${match[1].toLowerCase()} without "if exists"`);
  }
  for (const match of text.matchAll(/\badd\s+column\s+(?!if\s+not\s+exists)/gi)) {
    problems.push(`add column without "if not exists" (${match[0].trim()})`);
  }
  for (const match of text.matchAll(/\bcreate\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w.]+)/gi)) {
    const [, name, table] = match;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!has(new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${escaped}\\s+on\\s+${table.replace(".", "\\.")}`, "i"))) {
      problems.push(`create policy ${name} without a preceding "drop policy if exists"`);
    }
  }
  for (const match of text.matchAll(/\bcreate\s+trigger\s+(\w+)\s[\s\S]*?\bon\s+([\w.]+)/gi)) {
    const [, name, table] = match;
    if (!has(new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+${name}\\s+on\\s+${table.replace(".", "\\.")}`, "i"))) {
      problems.push(`create trigger ${name} without a preceding "drop trigger if exists"`);
    }
  }
  for (const match of text.matchAll(/\badd\s+constraint\s+(\w+)/gi)) {
    if (!has(new RegExp(`drop\\s+constraint\\s+if\\s+exists\\s+${match[1]}\\b`, "i"))) {
      problems.push(`add constraint ${match[1]} without a preceding "drop constraint if exists"`);
    }
  }
  // An unnamed constraint gets a new generated name each run, so a second run
  // adds a duplicate (or fails, for a primary key).
  for (const match of text.matchAll(/\badd\s+(check|foreign\s+key|unique|primary\s+key)\b/gi)) {
    problems.push(`add ${match[1].toLowerCase().replace(/\s+/g, " ")} without a constraint name`);
  }
  for (const match of text.matchAll(/\bcreate\s+(sequence|materialized\s+view)\s+(?!if\s+not\s+exists)/gi)) {
    problems.push(`create ${match[1].toLowerCase().replace(/\s+/g, " ")} without "if not exists"`);
  }
  // Postgres has no "create type if not exists": drop it first, or create it
  // inside a DO block that checks pg_type for the name.
  for (const match of text.matchAll(/\bcreate\s+type\s+(?:\w+\.)?(\w+)/gi)) {
    const name = match[1];
    if (!has(new RegExp(`drop\\s+type\\s+if\\s+exists\\s+(?:\\w+\\.)?${name}\\b`, "i")) && !has(new RegExp(`typname\\s*=\\s*'${name}'`, "i"))) {
      problems.push(`create type ${name} without "drop type if exists" or a pg_type check`);
    }
  }
  for (const match of text.matchAll(/\badd\s+value\s+(?!if\s+not\s+exists)/gi)) {
    problems.push(`alter type … ${match[0].trim()} without "if not exists"`);
  }
  for (const match of text.matchAll(/\bdrop\s+column\s+(?!if\s+exists)/gi)) {
    problems.push(`${match[0].trim()} without "if exists"`);
  }
  // Adding a table that is already in the publication fails; check
  // pg_publication_tables in a DO block first.
  for (const match of text.matchAll(/\balter\s+publication\s+\w+\s+add\s+table\s+([\w.]+)/gi)) {
    if (!has(/pg_publication_tables/i)) {
      problems.push(`alter publication add table ${match[1]} without a pg_publication_tables check`);
    }
  }
  // Function and DO bodies are skipped: their inserts run when called, not when
  // the migration runs.
  for (const statement of topLevelStatements(text)) {
    if (/^insert\s+into\s/i.test(statement) && !/\bon\s+conflict\b/i.test(statement)) {
      problems.push(`insert without "on conflict" (${statement.split(/\s+/).slice(0, 3).join(" ")})`);
    }
  }
  return problems;
}

test("the guard check catches statements that fail on a second run", () => {
  assert.deepEqual(unguardedStatements(`
    create table public.t (id int);
    create policy "read t" on public.t for select using (true);
    alter table public.t add constraint t_check check (id > 0);
    drop function public.f();
  `).length, 4);
  assert.deepEqual(unguardedStatements(`
    create table if not exists public.t (id int);
    -- create table public.commented_out (id int);
    drop policy if exists "read t" on public.t;
    create policy "read t" on public.t for select using (true);
    alter table public.t drop constraint if exists t_check;
    alter table public.t add constraint t_check check (id > 0);
    alter table public.t add column if not exists name text;
    create or replace function public.f() returns int language sql as $$ select 1 $$;
    drop function if exists public.g();
  `), []);
});

test("the guard check catches unnamed constraints, types, sequences, columns, publications and inserts", () => {
  const unguarded = (sql) => unguardedStatements(sql).map((problem) => problem.split(" without")[0].replace(/ \(.*$/, ""));
  assert.deepEqual(unguarded(`
    alter table public.t add check (id > 0);
    alter table public.t add foreign key (owner) references public.o(id);
    alter table public.t add unique (slug);
    alter table public.t add primary key (id);
    create sequence public.s;
    create materialized view public.mv as select 1;
    create type public.mood as enum ('calm');
    alter type public.mood add value 'busy';
    alter table public.t drop column legacy;
    alter publication supabase_realtime add table public.t;
    insert into public.plans (id) values ('free');
  `), [
    "add check",
    "add foreign key",
    "add unique",
    "add primary key",
    "create sequence",
    "create materialized view",
    "create type mood",
    "alter type … add value",
    "drop column",
    "alter publication add table public.t",
    "insert",
  ]);
  assert.deepEqual(unguardedStatements(`
    alter table public.t drop constraint if exists t_slug_key;
    alter table public.t add constraint t_slug_key unique (slug);
    alter table public.t add column if not exists code text unique;
    create sequence if not exists public.s;
    create materialized view if not exists public.mv as select 1;
    drop type if exists public.mood;
    create type public.mood as enum ('calm');
    do $$ begin
      if not exists (select 1 from pg_type where typname = 'tone') then
        create type public.tone as enum ('warm');
      end if;
    end $$;
    alter type public.mood add value if not exists 'busy';
    alter table public.t drop column if exists legacy;
    do $$ begin
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 't') then
        alter publication supabase_realtime add table public.t;
      end if;
    end $$;
    insert into public.plans (id) values ('free') on conflict do nothing;
    create or replace function public.seed() returns void language sql as $body$
      insert into public.plans (id) values ('team');
    $body$;
  `), []);
});

test("every migration is safe to run twice", () => {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql"));
  assert.ok(files.length > 0);
  const failures = files
    .map((file) => ({ file, problems: unguardedStatements(readFileSync(join(MIGRATIONS, file), "utf8")) }))
    .filter(({ problems }) => problems.length);
  assert.deepEqual(failures, []);
});
