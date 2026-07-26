# Review — auth module

## Findings

- **A1 (major):** `refreshToken()` swallows the 401 and retries forever.
- Nit: naming drift between `authClient` and `auth_client`.

## Repro

```
POST /token
{"grant": "refresh"}
```

Inline check: call `validateSession()` before every privileged route.
