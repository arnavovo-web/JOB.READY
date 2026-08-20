# JOB.READY — Development Workflow

## Branches

- `main`: stable/release branch. Do not use for experimental work.
- `development`: integration branch for active development.
- `feature/<name>`: isolated work for a focused feature or fix.

## Claude workflow

Claude should work from the repository rather than relying on pasted source files. For significant work:

1. Start from the latest `development`.
2. Inspect the current code before editing.
3. Make the smallest coherent change.
4. Run relevant tests/build checks.
5. Report exactly what was changed and what could not be tested.
6. Commit changes with a descriptive message.
7. Prefer a pull request into `development` for substantial changes.

## ChatGPT workflow

ChatGPT is used for architecture, product decisions, code review, debugging strategy, and development specifications. It can inspect the repository and review commits/PRs. Do not assume that a Claude report is correct without checking the actual code when the distinction matters.

## Database workflow

Supabase is the development backend. Database changes must be represented as migrations. Never casually drop or rebuild existing tables. Review destructive changes before applying them.

## Secrets

Never commit:

- `.env` files
- Anthropic API keys
- Supabase service-role keys
- passwords
- private credentials

Use `.env.example` for public variable names/placeholders only. Server-side secrets belong in the appropriate Supabase Edge Function secret configuration.

## Testing standard

A successful compile is not enough. For user-facing changes, test the actual flow where possible. Clearly distinguish:

- tested in real browser
- tested with unit/integration harness
- statically inspected
- unable to test in current environment

Never report a test as passed if it was not actually run.

## Commit guidance

Use concise messages such as:

- `feat: add supabase authentication`
- `fix: repair pdf upload flow`
- `refactor: move ai calls behind edge function`
- `test: add interview persistence coverage`
- `docs: update project state`
