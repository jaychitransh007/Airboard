# Airboard help content

This directory is the canonical source for the public Airboard Help Center.
The web application compiles these Markdown files into a typed content manifest;
it does not read repository files at runtime.

## Reading paths

- **New presenter:** What Airboard is → System requirements → Your first board
  → Commands → Google Meet.
- **Content creator or tutor:** Your first board → Gestures → Screen and camera
  composition → Boards, versions, and export.
- **Keyboard-only user:** Your first board → Keyboard, pointer, and touchpad.
- **Workspace administrator:** Account, trial, and billing → Admin console →
  Privacy and your data → Limits and support matrix.
- **Something went wrong:** Troubleshooting → Error codes → Contact support.

## Authoring rules

Every article starts with validated frontmatter. `sources` are repository-relative
paths used by reviewers and are not shown to customers. Use second person,
describe preview or gated capabilities honestly, and put the non-camera or
non-microphone path beside any media-based instruction.

Run `pnpm docs:build` after editing and `pnpm docs:check` before committing.
