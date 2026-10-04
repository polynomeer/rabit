# Contributing to Rabit

## Commit Convention

Rabit follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
All commit messages are written in **English**.

### Format

```text
<type>(<optional scope>): <subject>

<optional body>

<optional footer(s)>
```

### Types

| Type       | Use for                                                        |
|------------|----------------------------------------------------------------|
| `feat`     | A new user-facing feature or capability                        |
| `fix`      | A bug fix                                                      |
| `docs`     | Documentation only (incl. ADRs, PRD, specs, `CLAUDE.md`)       |
| `refactor` | Code change that neither fixes a bug nor adds a feature        |
| `perf`     | Performance improvement                                        |
| `test`     | Adding or correcting tests                                     |
| `build`    | Build system or external dependencies                          |
| `ci`       | CI configuration and scripts                                   |
| `chore`    | Maintenance that does not touch src or tests (e.g. tooling)    |
| `revert`   | Reverts a previous commit                                      |

### Scopes (optional)

Use a bounded context or area when it clarifies the change, e.g.
`audio`, `library`, `playlist`, `studio`, `audio-log`, `dig`, `search`,
`integrity`, `atlas`, `rights`, `auth`, `api`, `db`, `infra`, `adr`, `prd`.

### Rules

1. **Subject**: imperative mood ("add", not "added"/"adds"), lowercase first letter,
   no trailing period, at most 72 characters.
2. **Body**: explain *what* and *why*, not *how*. Wrap at 72 characters.
   Separate from the subject with a blank line.
3. **One logical change per commit.** Do not mix refactoring with behavior changes,
   or documentation reorganization with content changes.
4. **Breaking changes**: append `!` after the type/scope and add a
   `BREAKING CHANGE:` footer describing the migration path.
5. **References**: link requirement IDs, ADRs or issues in the footer,
   e.g. `Refs: AUD-001, ADR-0003`.
6. Every commit should leave the repository in a buildable, test-passing state
   once build/test tooling exists.

### Examples

```text
docs(prd): normalize requirements with stable IDs

Extract functional requirements from the source planning set and
assign stable IDs per capability (AUD, LIB, DIG, ...).

Refs: Phase 1
```

```text
feat(audio)!: require upload intent before finalize

BREAKING CHANGE: POST /uploads/{id}/finalize now returns 409 when no
upload intent exists. Clients must call POST /uploads first.

Refs: AUD-004, ADR-0007
```

## Branching

- `main` is the default branch.
- Use short-lived branches named `<type>/<short-description>`,
  e.g. `feat/private-upload`, `docs/adr-modular-monolith`.
