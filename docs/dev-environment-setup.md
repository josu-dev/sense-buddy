# Dev environment setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # set BETTER_AUTH_SECRET
pnpm setup:local                         # writes LAN IP -> apps/mobile/.env
pnpm dev:api                             # http://localhost:8787
pnpm dev:mobile
```

Guest auth works with no setup. Google needs the section below + a dev build (Expo Go always falls back to demo).

## Google OAuth

Flow: app gets a Google ID token on-device (`lib/googleAuth.ts`) → `POST /api/auth/sign-in/social` → BetterAuth verifies it (`api/src/auth.ts`). No secret on the device.

### 0. Shared debug key (one SHA-1 for the team)

```bash
pnpm setup:android-debug   # installs checked-in key -> ~/.android/debug.keystore, prints SHA-1
```

### 1. Consent screen

`console.cloud.google.com` → new project → `OAuth consent screen`: type `External`, name `Sense Buddy`, scopes `openid email profile`, add your Gmail as test user.

### 2. Three clients (same project)

**Web** (`Credentials > OAuth client ID > Web application`):
- JS origins: `http://localhost:8787`
- Redirects: `http://localhost:8787/api/auth/callback/google`, `sensebuddy://auth`
- Save `Client ID` → `GOOGLE_CLIENT_ID`, secret → `GOOGLE_CLIENT_SECRET`

**iOS** (`> iOS`): Bundle ID `app.sensebuddy` (from `app.json`). No redirect field. Save ID → `GOOGLE_IOS_CLIENT_ID`.

**Android** (`> Android`): Package `app.sensebuddy`, SHA-1 from step 0. No redirect field. Save ID → `GOOGLE_ANDROID_CLIENT_ID`.

### 3. Env vars

`apps/api/.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`.
`apps/mobile/.env`: same IDs prefixed `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`. Restart both after editing.

### 4. Verify

```bash
npx expo run:android   # or run:ios; Expo Go can't do OAuth
```

Login → Continue with Google → no "demo" notice = real OAuth.

Troubleshooting: demo fallback = missing/rebuilt IDs or Expo Go; `redirect_uri_mismatch` = recheck step 2; access blocked = use a test user; teammate rejected = they need `pnpm setup:android-debug` or their own Android client for their SHA-1.
