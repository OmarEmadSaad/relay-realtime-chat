# Demo credentials

These accounts are created by `npm run seed` (`scripts/seedDemo.ts`). They are **public demo accounts**, so they are not real people and the password is published on purpose.

**Password for every account:** `DemoChat2026!`

| Name | Email | Role | Good for |
| --- | --- | --- | --- |
| Lina Haddad | `lina@demo.example.com` | user | The main demo user. Has unread messages, direct chats and two groups |
| Marcus Reed | `marcus@demo.example.com` | user | Chat with Lina in a second browser |
| Aisha Khan | `aisha@demo.example.com` | user | Group member, direct chat with Lina |
| Diego Alvarez | `diego@demo.example.com` | user | Group member, direct chat with Lina |
| Sofia Rossi | `sofia@demo.example.com` | admin | Shows the role badge. Refused by admin endpoints (see below) |
| Kenji Tanaka | `kenji@demo.example.com` | user | Member of "Frontend Guild" only |

## Try it

1. Open http://localhost:3000 in one browser and sign in as **Lina** (the login screen has one-click demo buttons).
2. Open a private/incognito window (or another browser) and sign in as **Marcus**.
3. Open the Lina ↔ Marcus chat on both sides and type: you'll see the typing indicator, instant delivery, "Seen", online status and unread badges.

## What demo accounts can't do

- **No administration.** User-management endpoints (`GET/POST/PUT/PATCH/DELETE /api/users…`) need the admin or manager role **and** a non-demo account. The demo "admin" Sofia gets `403`.
- **No access to other people's conversations.** Every conversation endpoint and socket event checks membership on the server; a demo user only sees conversations they belong to.
- **No elevated roles.** Sign-up always creates role `user`; a `role` in the request body is ignored.

## How the seed script stays safe

- Only creates or updates users flagged `isDemo: true`. If one of the demo emails belongs to a real account, it is left alone and its demo conversations are skipped.
- Only touches conversations it created itself (marked with a `seedKey`), and those only contain demo users.
- Safe to re-run: existing demo data is kept. `npm run seed -- --reset` re-creates only the demo conversations' messages, with fresh timestamps.
- Never deletes users, collections or databases. Passwords are stored as bcrypt hashes.

## Your own admin account

For the admin endpoints, create a real manager account (the password is never stored in the code):

```bash
npm run create-manager -- --email you@example.com --password "a-strong-password" \
  --first-name Your --last-name Name --phone +201000000000
```
