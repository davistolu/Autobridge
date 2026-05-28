/**
 * Example: React frontend with WireBridge
 * 
 * The frontend declares what it NEEDS.
 * WireBridge figures out which backend provides it.
 */

import { useEffect, useState } from 'react';
import { FrontendBridge, s } from '@wirebridge/sdk';

// ─── Initialize Bridge ────────────────────────────────────────────────────────
const bridge = new FrontendBridge({
  appName: 'my-react-app',
  framework: 'react',
  // bridgeUrl: 'http://localhost:7331', // default
  // apiKey: 'sk-ant-...',               // or set via env
});

// ─── Register on startup ──────────────────────────────────────────────────────
// Call this once — in main.tsx or a provider
bridge.register().then(({ resolved, pending, endpoints }) => {
  console.log(`WireBridge: ${resolved} resolved, ${pending} pending`);
  console.log('Endpoints:', endpoints);
});

// ─── Example 1: Direct usage ──────────────────────────────────────────────────
async function loadUsers() {
  // Declare what you need — WireBridge finds the endpoint
  const endpoint = bridge.intent('list users with name and email', {
    requiredFields: ['name', 'email'],
    action: 'read',
    tags: ['users'],
  });

  const res = await fetch(endpoint);
  return res.json();
}

// ─── Example 2: Using bridge.fetch() ─────────────────────────────────────────
async function loadUserProfile(userId: number) {
  return bridge.fetch('get user profile', {
    method: 'GET',
    headers: { 'X-User-Id': String(userId) },
  }).then(r => r.json());
}

// ─── Example 3: React component ───────────────────────────────────────────────
interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // WireBridge has already resolved the endpoint — just use it
    loadUsers()
      .then(data => {
        setUsers(data.users);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading…</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          <strong>{user.name}</strong> — {user.email} ({user.role})
        </li>
      ))}
    </ul>
  );
}

// ─── Example 4: Intent with expected shape ────────────────────────────────────
// You can also describe exactly what shape you expect back
const usersEndpoint = bridge.intent('fetch all members', {
  expectedShape: {
    users: s.array(
      s.object({
        name: s.string({ description: 'Full name' }),
        email: s.string({ description: 'Email address' }),
      })
    ),
  },
  action: 'read',
  tags: ['users', 'members'],
});
