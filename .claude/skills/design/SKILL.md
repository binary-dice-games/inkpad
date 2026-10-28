---
name: design
description: Create and update a project's DESIGN.md in spec/<NN>_<name>/. Enters an interactive design session where the conversation refines the document until the user is done.
---

You are now in **design mode** for this codebase. Your job is to help the user design a project by maintaining its `DESIGN.md` in `spec/<NN>_<name>/` (see "spec/" in CLAUDE.md), a document a future AI agent can use to implement it correctly.

## Activation

If the user provided an argument (e.g. `/design 02_opengl_rasterizer`, or a description such as `/design an OpenGL rasterizer`), use it to pick the project. Otherwise ask: "Which project are you designing? (an existing spec folder, or a short description of new work)"

Once the project is known:

1. **Read `spec/INDEX.md`** — It lists every project with its topics. An existing folder named or matching the request is the target; otherwise this is a new project.
2. **New project** — Create `spec/<NN>_<name>/` with the next two-digit number and a short snake_case name (confirm the name with the user), and add its row to `spec/INDEX.md` (status "Design in progress", one-sentence summary, topics).
3. **Load reference context** — Read the `DESIGN.md` of the earlier projects whose topics the new work touches (not every folder). They give you the architecture this project builds on and the writing style and level of detail to match. Link to them for anything this project does not change, rather than copying it.
4. **Load the current document** — If the target folder already has a `DESIGN.md`, read it. The session will refine it; otherwise you will create it from scratch.
5. **Confirm the scope** — Briefly state which project you are designing and what you already know about it (from the code and existing specs), then ask the user to describe what they want to design or change.

## Design Session Behavior

- Stay in this mode for the entire conversation. Each exchange with the user is a design discussion — ask clarifying questions, propose structures, reason about trade-offs.
- After every exchange that produces a substantive design decision (a new abstraction, a changed interface, a resolved trade-off, a finalized constraint), immediately write the updated `DESIGN.md` to the project's spec folder using the Write or Edit tool. Do not wait until the end. Keep the project's row in `spec/INDEX.md` (summary, topics) in step with it.
- Tell the user what you wrote after each update: one sentence summary of what changed.
- If the user says "done", "looks good", "ship it", or similar, write a final clean version of the document and confirm the session is complete.

## What DESIGN.md Must Contain

Write only what a future AI agent needs to implement this project correctly. Be concise. Every sentence must earn its place.

Required sections (adapt titles to fit the content):

1. **Purpose / Scope** — What this project does and what it explicitly does NOT do. List the source directories and files it owns or changes.
2. **Design Goals** — The 3–6 non-negotiable requirements that drive the design choices. Number them.
3. **Key Abstractions** — The central types, interfaces, or modules. For each: name, role, and the invariants it must uphold.
4. **Data Flow / Architecture** — How the pieces connect at runtime. A brief narrative or numbered sequence. Diagrams in ASCII if they help.
5. **Public API Contract** — The surface an external caller sees: function signatures or type names, their preconditions, return values, and failure behavior. Skip internal details.
6. **Design Decisions** — The choices that are not obvious from the code. For each: what was chosen, what was rejected, and the reason. An implementer who doesn't know the history needs this to avoid undoing it.
7. **Constraints and Invariants** — Hard rules the implementation must never break (thread safety, ordering, ownership, error handling style, platform concerns).
8. **Integration Boundaries** — What this project depends on (including earlier projects' designs, by path) and what depends on it. Note any shared state or coupling.

Omit any section that genuinely does not apply. Do not add padding. Do not restate what well-named code already says.

## Writing Style

Match the style of the existing `DESIGN.md` files in this project:
- Plain prose, no marketing language.
- Short numbered or bulleted lists for enumerable items.
- Tables for mappings (e.g. error codes, tag values, field layouts).
- No inline code blocks for things that are obvious from context.
- First line of the document is a `# Title` heading.
- Section headings are `## N. Title` (numbered).

## Tools to Use

- `Read` — read `spec/INDEX.md`, the relevant earlier `DESIGN.md` files and the source files for context.
- `Glob` — find source files the project touches.
- `Write` — create a new `DESIGN.md`.
- `Edit` — update an existing `DESIGN.md`.

Do not modify any source code during a design session. This skill is for design only.
