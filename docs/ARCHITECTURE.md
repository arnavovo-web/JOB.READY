# JOB.READY — Architecture

## Target production architecture

```text
Browser / JOB.READY frontend
        |
        +--> Supabase Auth
        |       |
        |       +--> authenticated user ID
        |
        +--> Supabase Database
        |       |
        |       +--> profiles
        |       +--> applications
        |       +--> interviews / questions / answers / evaluations
        |       +--> reports
        |       +--> Candidate DNA / competency history
        |       +--> Interview Memory
        |       +--> Classroom / quiz state
        |       +--> Assessment Centre history
        |       +--> AI usage
        |
        +--> private Supabase Storage
        |       |
        |       +--> CVs / job descriptions / documents
        |
        +--> authenticated Supabase Edge Function
                    |
                    +--> Anthropic API
```

## Security boundaries

### Browser

May contain public Supabase configuration required for the browser client. Must never contain Anthropic private credentials or a Supabase service-role key.

### Supabase Auth

The canonical identity layer. Application data is associated with `auth.uid()`.

### Database

Row Level Security is the enforcement boundary for user-owned data. Frontend filtering is not considered sufficient security.

### Storage

User documents are private and user/application scoped. Public document buckets are not appropriate for CVs or job descriptions.

### Edge Functions

AI calls should pass through an authenticated server-side function. The function validates the caller and request before calling Anthropic.

## Data principle

Persistent business data should be database-backed. Client storage may be used for temporary UI state but must not remain the source of truth for accounts, applications, interviews, reports, Candidate DNA, Interview Memory, Classroom or Assessment Centre history.

## AI principle

The existing frontend validation layer should remain compatible with current JOB.READY response schemas. Secure transport and persistence changes should not require unnecessary changes to the product's AI response contracts.
