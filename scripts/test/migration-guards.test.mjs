import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
// Migrations already applied in production never run again, so they are left
// as written; every migration from this version on must be safe to re-run.
const GUARDED_FROM = "20261105150000";

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

test("new migrations are safe to run twice", () => {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql") && file >= GUARDED_FROM);
  assert.ok(files.length > 0);
  const failures = files
    .map((file) => ({ file, problems: unguardedStatements(readFileSync(join(MIGRATIONS, file), "utf8")) }))
    .filter(({ problems }) => problems.length);
  assert.deepEqual(failures, []);
});
