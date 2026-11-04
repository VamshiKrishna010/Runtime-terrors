# Login and Analytics repair

The current project stores all data in Convex and uses an optional FastAPI vision service,
but no authentication provider, user table, credential endpoint, or session verifier.
The login screen therefore implements the explicitly labeled hackathon demo option,
not a second production authentication system. It never requests or stores a password.

Continue as Demo User starts an eight-hour sessionStorage marker in this browser tab.
Reloading preserves it; expiry or Sign Out clears the session and unmounts the app,
returning to login. The marker is not an auth token and grants no backend protection.
Identity is the fixed demo@veripulse.local account. Storage errors appear in the login
card; service errors are separate workspace/Analytics errors. Real email/password
login, account creation and identity verification are not supported or advertised.
Convex functions have no per-user access control; this gate does not add any.

Analytics navigation was crashing on the removed analyticsRef variable. Its recent
row handler also referenced the removed setIncidents setter after the app migrated
to Convex. Both are repaired. Analytics is now a live Convex query
(`convex/analytics.ts`) over the same data as Live Incidents, so a recent-incident
row opens its incident directly; a deleted incident shows an explanatory error.
Missing optional collections normalize to empty collections. Missing/incompatible
summary responses show Analytics unavailable with Retry. No fake statistics are added.

Analytics styles were missing following an interrupted implementation; scoped styles
now provide fixed chart heights and responsive grids. Existing module layouts remain.

Vite exposes only the exact public CONVEX_URL (plus the standard public VITE_ prefix),
not every CONVEX_ environment value. Do not put secrets in VITE_ variables. The /api
proxy defaults to 127.0.0.1:8000 locally or backend:8000 inside Docker. Override using
BACKEND_PROXY_TARGET if necessary. No .env values are printed or committed.

Checks from frontend/: npm test; npm run build.
Manual flow: open the app, Continue as Demo User, select all four sidebar views,
refresh, open profile, Sign out, then sign in again. Live browser checks require an available browser session.
