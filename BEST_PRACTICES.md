# Best Practices for auth-svc

This document outlines recommended security, reliability, and maintainability practices for this service. It’s tailored to the current codebase (Express, in-memory store, simulated auth) and provides a clear path to harden and scale.

## 1) Security Baseline
- HTTP hardening
  - Use Helmet to set secure headers (HSTS at edge, frameguard, xssFilter, noSniff, hide X-Powered-By).
  - CORS: Explicitly allow known origins; default to deny.
  - Rate limiting: Apply stricter limits to write endpoints (POST/PUT).
  - Body size limits: Set `express.json({ limit: '1mb' })` (tune per use-case).
- Input validation & sanitization
  - Validate request bodies, params, and query (zod/joi/express-validator).
  - Normalize and sanitize strings; reject unknown fields.
  - Validate ACL fields: `viewers`/`editors` must be valid user IDs; only `viewers` may include `public`.
- Dependency hygiene
  - Pin via lockfile; run `npm audit` (and consider Snyk/GH Dependabot).
  - Regularly update minor/patch versions.
- Secrets management
  - Never commit secrets. Use environment variables or a secret manager.
  - Rotate credentials regularly; prefer short-lived credentials.
- Transport security
  - Terminate TLS at a trusted proxy/load balancer.
  - If behind a proxy, set `app.set('trust proxy', true)` carefully and only for known proxies.
- PII/Log safety
  - Do not log sensitive data (identifiers, tokens). Mask if unavoidable.

## 2) Authentication
- Replace header-based fake auth with real identity when moving beyond demo:
  - JWT/OIDC: Validate `iss`, `aud`, `exp`, `nbf`; use JWKs with caching/rotation.
  - Short-lived access tokens; rotate refresh tokens.
  - Extract claims into `req.user` via dedicated middleware.
- Environment gating
  - Keep `x-user` header auth only for local/dev; disable in staging/prod.

## 3) Authorization (RBAC/ABAC)
- Principle of least privilege; default deny.
- Centralize authorization logic with small helpers/middleware (e.g., `requireRole`, resource-scoped checks).
- Avoid privilege escalation on updates
  - Only Admin/Manager may change `managerId`, `viewers`, `editors`.
  - Validate that ACL changes do not lock the resource irrecoverably (e.g., at least one admin/editor remains).
- Audit decisions
  - Log decision context (user id, role, action, resource id, outcome) without PII.

## 4) API Design and Contracts
- Versioning
  - Introduce `/v1` routes or explicit Accept header versioning.
- OpenAPI/Swagger
  - Document endpoints, request/response schemas, errors, and auth flows.
- Consistent errors
  - Use structured error format `{ error: string, code?: string, details?: any, requestId?: string }`.
- Pagination & filtering
  - For list endpoints, add `limit`, `offset`/`cursor`, and filter params.
- Idempotency
  - Consider idempotency keys for POST/PUT where appropriate.

## 5) Error Handling
- Centralized error middleware (already present)
  - Map known validation/authz errors to 4xx; hide stack traces in production.
- Correlation ID
  - Generate/propagate `X-Request-Id`; include in logs and error responses.

## 6) Observability
- Structured logging
  - Use pino or winston; log JSON with level, timestamp, requestId, route, status, latency.
- Metrics
  - Expose Prometheus metrics (request count, latency, error rate) and business KPIs.
- Tracing
  - Adopt OpenTelemetry for distributed tracing; add spans for key operations.
- Health & readiness
  - Keep `/health` (liveness). Add `/ready` (readiness) when external deps exist.

## 7) Operational Hardening
- Graceful shutdown
  - Handle SIGTERM/SIGINT; stop accepting new connections; close server with a timeout.
- Timeouts
  - Set server timeouts (headers, request, idle); consider `express-timeout-handler` where needed.
- 12-factor config
  - All configuration via env; validate on boot (e.g., with zod/joi).
- Containerization
  - Use non-root images; minimize attack surface; set resource limits; read-only FS where possible.

## 8) Data & Persistence (future)
- When adding a database
  - Use migrations (Prisma/Knex/Flyway) and a dedicated low-privilege DB user.
  - Enforce constraints (unique emails, foreign keys for managerId reference if applicable).
  - Consider soft-deletes and audit tables where appropriate.

## 9) Testing Strategy
- Unit tests
  - Validate utilities and auth/guard helpers.
- Integration tests
  - Use Supertest against Express app; cover RBAC and ACL rules.
- Security tests
  - Attempt privilege escalation, path traversal, injection, and mass assignment.
- Coverage targets
  - Aim for 80%+ statements/branches; prioritize critical paths over raw %.

## 10) CI/CD
- Static checks
  - ESLint and Prettier; optionally TypeScript for type-safety.
- Pipelines
  - Run tests, lint, audit on every PR; block merge on failures.
- Versioning & changelog
  - Conventional commits; auto-generate CHANGELOG; semantic-release if desired.

## 11) Project Structure (suggested)
```
src/
  server.js           # app bootstrap
  routes/             # route definitions
  controllers/        # http layer (parse/validate, call services)
  services/           # business logic
  middleware/         # auth, error, logging
  utils/              # helpers
  schemas/            # validation schemas
  config/             # config loading/validation
  tests/              # unit/integration
```
- Keep controllers thin; put logic in services.
- Validation schemas shared between controllers/tests.

## 12) Performance
- Tune JSON body size; disable heavy work in hot paths.
- Use compression selectively; enable ETags where helpful.
- Avoid synchronous/blocking operations; prefer async I/O.

## 13) Privacy & Compliance
- Classify data; avoid collecting PII unnecessarily.
- Data minimization in logs and responses.
- Respect retention policies.

## 14) Security Checklist (quick)
- [ ] Helmet enabled and configured
- [ ] CORS restricted to allowed origins
- [ ] Rate limiting on write endpoints
- [ ] Input validation (schemas) for all routes
- [ ] Centralized error handling with safe messages in prod
- [ ] Structured logging with requestId
- [ ] Auth: JWT/OIDC verification in non-dev
- [ ] RBAC/ACL rules tested (unit/integration)
- [ ] Dependencies audited and updated
- [ ] Secrets not in repo; env validated on boot
- [ ] Graceful shutdown and timeouts

## 15) Migration Plan from Demo to Production
1. Introduce validation (schemas) for POST/PUT and query params.
2. Add Helmet, CORS, rate limiting, and structured logging.
3. Replace `x-user` with JWT/OIDC auth middleware; gate the header-based auth to dev only.
4. Persist employees to a database; add migrations and constraints.
5. Add tests (unit/integration) and CI checks; define coverage thresholds.
6. Define OpenAPI spec and publish via Swagger UI.
7. Add metrics and tracing; implement readiness probe.
