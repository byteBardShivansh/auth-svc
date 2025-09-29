const express = require('express');

// Simple in-memory database
// Employees structure: { id, name, title, managerId, email }
const db = {
  employees: [],
  nextId: 1,
};

// Seed some users to act as authenticated principals
// In a real app you'd have JWT/authn. Here we simulate auth via headers.
const users = {
  // username: { id, role, managerOf? }
  admin: { id: 'u1', role: 'Admin' },
  managerA: { id: 'u2', role: 'Manager' },
  managerB: { id: 'u3', role: 'Manager' },
  alice: { id: 'u4', role: 'Employee' },
  bob: { id: 'u5', role: 'Employee' },
};

// Map employees to their manager user id for authorization demo
// We'll create employees with managerId corresponding to a manager user's id.

const app = express();
app.use(express.json());

// Auth middleware: expects headers x-user and optional x-role for testing
// Public endpoints: '/', '/health', '/favicon.ico', and OPTIONS are allowed without auth
// If x-user corresponds to a predefined user, attach req.user
app.use((req, res, next) => {
  // Always attempt to resolve user from header if provided
  const username = req.header('x-user');
  if (username) {
    const user = users[username];
    if (!user) return res.status(401).json({ error: 'Unknown user' });
    req.user = user;
  }

  // Public endpoints
  const isPublic = (
    req.method === 'OPTIONS' ||
    req.path === '/' ||
    req.path === '/health' ||
    req.path === '/favicon.ico' ||
    (req.method === 'GET' && (
      req.path === '/employees' ||
      (req.path.startsWith('/employees/') && req.path.split('/').length === 3)
    ))
  );

  // Enforce auth only on protected endpoints
  if (!isPublic && !req.user) {
    return res.status(401).json({ error: 'Missing x-user header' });
  }

  next();
});

// Role guard middleware factory
function requireRole(...roles) {
  return (req, res, next) => {
    const hasRole = roles.includes(req.user.role);
    if (!hasRole) return res.status(403).json({ error: 'Forbidden: insufficient role' });
    next();
  };
}

// Utility: find employee index by id
function findEmployeeIndex(id) {
  return db.employees.findIndex((e) => e.id === id);
}

// Create employee (Admin, Manager)
// Body: { name, title, email, managerId }
app.post('/employees', requireRole('Admin', 'Manager'), (req, res) => {
  const { name, title, email, managerId, viewers = [], editors = [] } = req.body || {};
  if (!name || !title || !email) {
    return res.status(400).json({ error: 'name, title, and email are required' });
  }

  // Managers can only create employees assigned to themselves as manager
  if (req.user.role === 'Manager') {
    const enforcedManagerId = req.user.id;
    if (managerId && managerId !== enforcedManagerId) {
      return res.status(403).json({ error: 'Managers can only create employees under themselves' });
    }
  }

  const employee = {
    id: db.nextId++,
    name,
    title,
    email,
    managerId: req.user.role === 'Manager' ? req.user.id : managerId || null,
    viewers, // array of user ids allowed to view
    editors, // array of user ids allowed to edit
  };
  db.employees.push(employee);
  res.status(201).json(employee);
});

// Update employee (Admin, Manager only if manages the employee)
// Body: { name?, title?, email?, managerId? }
app.put('/employees/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = findEmployeeIndex(id);
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  const existing = db.employees[idx];

  // Authorization: Admin OR Manager of this employee OR listed editor
  const isAdmin = req.user.role === 'Admin';
  const isManager = req.user.role === 'Manager';
  const managesEmployee = isManager && existing.managerId === req.user.id;
  const isListedEditor = Array.isArray(existing.editors) && existing.editors.includes(req.user.id);

  if (!(isAdmin || managesEmployee || isListedEditor)) {
    return res.status(403).json({ error: 'Forbidden: not allowed to edit this employee' });
  }

  const { name, title, email, managerId, viewers, editors } = req.body || {};

  // Only Admin or Manager can change managerId.
  let newManagerId = existing.managerId;
  if (typeof managerId !== 'undefined') {
    if (isAdmin) {
      newManagerId = managerId;
    } else if (isManager) {
      if (managerId !== req.user.id) {
        return res.status(403).json({ error: 'Managers cannot reassign employees to a different manager' });
      }
      newManagerId = managerId;
    } else {
      return res.status(403).json({ error: 'Only Admin/Manager can change managerId' });
    }
  }

  const allowAclChange = isAdmin || isManager;

  const updated = {
    ...existing,
    ...(name ? { name } : {}),
    ...(title ? { title } : {}),
    ...(email ? { email } : {}),
    managerId: newManagerId,
    ...(allowAclChange && Array.isArray(viewers) ? { viewers } : {}),
    ...(allowAclChange && Array.isArray(editors) ? { editors } : {}),
  };

  db.employees[idx] = updated;
  res.json(updated);
});

// Get all employees
// - Admin: all
// - Manager: only their direct reports
// - Employee: only self (by email match to simulated user). For demo, we match x-user to email localpart.
app.get('/employees', (req, res) => {
  if (!req.user) {
    // Public: only return employees with viewers: 'public'
    return res.json(db.employees.filter(e => e.viewers && e.viewers.includes('public')));
  }
  const role = req.user.role;
  if (role === 'Admin') return res.json(db.employees);
  if (role === 'Manager') return res.json(db.employees.filter(e => e.managerId === req.user.id));
  // Employee: only view their own record if email matches username@example.com
  const email = `${Object.keys(users).find(k => users[k].id === req.user.id)}@example.com`;
  const self = db.employees.filter(e => e.email === email);
  // Also allow if user is in viewers list
  const allowed = db.employees.filter(e => e.viewers && e.viewers.includes(req.user.id));
  res.json([...new Set([...self, ...allowed])]);
});

// Get employee by id
// - Admin: any
// - Manager: only their direct reports
// - Employee: only self
app.get('/employees/:id', (req, res) => {
  const id = Number(req.params.id);
  const emp = db.employees.find(e => e.id === id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  if (!req.user) {
    // Public: only allow if employee is public
    if (emp.viewers && emp.viewers.includes('public')) return res.json(emp);
    return res.status(403).json({ error: 'Forbidden' });
  }
  const role = req.user.role;
  if (role === 'Admin') return res.json(emp);
  if (role === 'Manager') {
    if (emp.managerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    return res.json(emp);
  }
  // Employee: only self by email, or if in viewers list
  const email = `${Object.keys(users).find(k => users[k].id === req.user.id)}@example.com`;
  if (emp.email === email) return res.json(emp);
  if (emp.viewers && emp.viewers.includes(req.user.id)) return res.json(emp);
  return res.status(403).json({ error: 'Forbidden' });
});

// Seed some demo data for quick testing
function seed() {
  // Create two employees under managerA and one under managerB
  db.employees.push(
    // Alice: public view, editable by admin and managerA
    { id: db.nextId++, name: 'Alice', title: 'Engineer', email: 'alice@example.com', managerId: users.managerA.id, viewers: ['public', users.admin.id, users.managerA.id], editors: [users.admin.id, users.managerA.id] },
    // Bob: only admin and managerA can view/edit
    { id: db.nextId++, name: 'Bob', title: 'Engineer', email: 'bob@example.com', managerId: users.managerA.id, viewers: [users.admin.id, users.managerA.id], editors: [users.admin.id, users.managerA.id] },
    // Charlie: only admin, managerB, and alice can view; only admin and managerB can edit
    { id: db.nextId++, name: 'Charlie', title: 'Designer', email: 'charlie@example.com', managerId: users.managerB.id, viewers: [users.admin.id, users.managerB.id, users.alice.id], editors: [users.admin.id, users.managerB.id] },
  );
}
seed();

// Root info route (public)
app.get('/', (req, res) => {
  res.json({
    service: 'employee-service',
    status: 'running',
    usage: 'Send requests with x-user header: admin | managerA | managerB | alice | bob',
    examples: {
      health: 'curl -H "x-user: admin" http://localhost:3000/health',
      listEmployeesAdmin: 'curl -H "x-user: admin" http://localhost:3000/employees',
    },
    notes: 'Root and /health are public. All other endpoints require x-user header.',
  });
});

// Health (public)
app.get('/health', (req, res) => res.json({ status: 'ok' }));
// Who am I (protected)
app.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Missing x-user header' });
  res.json({ user: req.user });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Users for testing: x-user header as one of: admin, managerA, managerB, alice, bob');
});
