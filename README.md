# auth-svc (Employee Service)

A minimal Express-based REST API demonstrating role-based access control (RBAC) with a simulated authentication model using request headers. Employees are stored in-memory and include fine-grained viewers/editors ACLs to illustrate access patterns.

- Tech: Node.js, Express
- Auth model: Simulated via `x-user` header (no real tokens)
- Data: In-memory (non-persistent)

## Quick start

Requirements
- Node.js (LTS recommended)
- npm

Install and run
- Install dependencies: `npm install`
- Start server: `npm start`
- Dev mode (auto-reload): `npm run dev`

Configuration
- `PORT` (default 3000)

## Seeded principals (x-user)
Use one of the following values in the `x-user` header to simulate an authenticated user:
- `admin` → Admin (id: `u1`)
- `managerA` → Manager (id: `u2`)
- `managerB` → Manager (id: `u3`)
- `alice` → Employee (id: `u4`)
- `bob` → Employee (id: `u5`)

Notes
- Unknown `x-user` → 401 Unauthorized
- Some endpoints are public; others require `x-user`

## Seeded data
On startup, the service seeds three employees:
- Alice (Engineer) under managerA
  - viewers: `public`, `u1` (admin), `u2` (managerA)
  - editors: `u1` (admin), `u2` (managerA)
- Bob (Engineer) under managerA
  - viewers: `u1`, `u2`
  - editors: `u1`, `u2`
- Charlie (Designer) under managerB
  - viewers: `u1`, `u3`, `u4` (alice)
  - editors: `u1`, `u3`

## Authentication and authorization model
- Authentication is simulated via the `x-user` header; if present and valid, `req.user` is set.
- Public endpoints:
  - `GET /`, `GET /health`
  - `GET /employees`, `GET /employees/:id` are public reads but will honor `x-user` if provided.
- Protected endpoints: all others require `x-user`.

RBAC rules
- GET /employees
  - No `x-user`: returns only employees with `viewers` containing `public`.
  - Admin: all employees.
  - Manager: employees where `managerId === req.user.id`.
  - Employee: only own record (by seeded email match) plus any employee where the user id is in `viewers`.
- GET /employees/:id
  - No `x-user`: allowed only if the employee has `public` in `viewers`.
  - Admin: allowed.
  - Manager: allowed only if they manage that employee.
  - Employee: allowed for self (email match) or if the user id is in `viewers`.
- POST /employees
  - Allowed for Admin and Manager.
  - Managers can only create employees under themselves (managerId enforced to manager's user id).
  - Body supports optional `viewers` and `editors` arrays.
- PUT /employees/:id
  - Allowed if the caller is Admin OR the employee's Manager OR present in the employee's `editors`.
  - Changing `managerId`, `viewers`, or `editors` is restricted to Admin/Manager.

## API

Base URL
- `http://localhost:3000` (or `PORT` env)

Routes
- `GET /` → service info (public)
- `GET /health` → health check (public)
- `GET /me` → whoami; returns `{ user }` (requires `x-user`)
- `GET /employees` → list employees
  - Public: only those with `public` in `viewers`
  - With `x-user`: role-based as described above
- `GET /employees/:id` → get single employee (public read honoring ACL)
- `POST /employees` → create employee (Admin/Manager)
  - Body: `{ name, title, email, managerId?, viewers?, editors? }`
- `PUT /employees/:id` → update employee (Admin/Manager-of-employee/listed editor)
  - Body: `{ name?, title?, email?, managerId?, viewers?, editors? }`

Employee fields
- `id` (number)
- `name` (string)
- `title` (string)
- `email` (string)
- `managerId` (string | null) — must match a manager's `id` (e.g., `u2`, `u3`)
- `viewers` (string[]) — user ids allowed to view, may include `'public'`
- `editors` (string[]) — user ids allowed to edit

## Usage examples (curl)

Public list (only employees with public viewer)
- `curl http://localhost:3000/employees`

List all as Admin
- `curl -H "x-user: admin" http://localhost:3000/employees`

List reports as ManagerA
- `curl -H "x-user: managerA" http://localhost:3000/employees`

Get one employee by id (public)
- `curl http://localhost:3000/employees/1`

Who am I
- `curl -H "x-user: alice" http://localhost:3000/me`

Create employee as ManagerA
- `curl -X POST -H "Content-Type: application/json" -H "x-user: managerA" -d '{"name":"Dana","title":"Engineer","email":"dana@example.com"}' http://localhost:3000/employees`

Update employee as Admin
- `curl -X PUT -H "Content-Type: application/json" -H "x-user: admin" -d '{"title":"Senior Engineer"}' http://localhost:3000/employees/1`

## Development notes
- Code entrypoint: `src/server.js`
- Scripts (package.json):
  - `npm start` → `node src/server.js`
  - `npm run dev` → `nodemon src/server.js`

## Limitations and next steps
- In-memory data; not persisted.
- Header-based simulated auth; no real identity or token verification.
- No input validation beyond basic field presence; consider validating emails and ACL user ids.

Recommended enhancements
- Add Helmet, CORS, and rate-limiting middleware.
- Add input validation (e.g., `joi`/`zod`) and stricter ACL checks.
- Add tests (e.g., Supertest) for RBAC and ACL rules.
- Consider real auth (JWT/OIDC) and external persistence.
