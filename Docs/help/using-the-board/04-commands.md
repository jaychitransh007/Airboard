---
title: Commands
description: Learn the command forms Airboard can apply and how to recover when a command is unclear.
category: using-the-board
categoryLabel: Using the board
order: 4
status: shipped
audiences: ["everyone"]
lastVerified: 2026-07-30
sources: ["packages/core/src/semanticCapabilities.ts", "apps/web/src/features/board/intentCanvasParser.ts", "apps/web/src/features/board/intentPipeline.ts"]
---

Type a command in the Airo composer or speak it during an explicitly activated
voice turn. Commands that Airboard understands are applied immediately.

## Create objects

Use:

```text
add [one to twenty] <object type> [named <label>] [placement]
```

Examples:

- `add a database named Orders`
- `create three services below Payments`
- `add a decision named Approved on the right`

Supported object types include process, service, database, queue, user, API,
decision, note, start/end, input/output, document, circle, and box.

## Connect and change objects

Examples:

- `connect Customer to API as request`
- `reverse the connector from API to Queue`
- `delete the connector from Customer to API`
- `rename selected to Payments`
- `duplicate selected`
- `delete selected`
- `move selected right`

You can also ask Airboard to align, distribute, lay out, group, or select
objects. Name visible labels precisely when several objects could match.

## Use context safely

`this`, `that`, and `selected` refer to the current pointer or selection when
the command begins. Airboard snapshots that context. If the board changes
before semantic interpretation finishes, the plan is rejected instead of being
applied to a different object.

## Undo or cancel

Use `undo` to revert the most recent board transaction. Use `cancel` or press
`Escape` to dismiss a pending clarification or interaction.

## When Airboard does not understand

Airboard first uses its deterministic command grammar. An explicitly activated
but unclear command may use bounded semantic recovery when that provider is
available. The model proposes a typed plan; it cannot mutate the board directly.

If the request is ambiguous, Airboard asks a focused question. If it is unsafe,
unsupported, stale, or still unclear, Airboard rejects it. Rephrase with a
visible object label and one clear action.
