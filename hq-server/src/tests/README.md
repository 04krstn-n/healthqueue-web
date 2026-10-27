# HealthQueue+ server tests

Automated tests for the panel recommendations. They use Node's built-in test
runner, so **no extra npm packages** are needed, and they do **not** need
MongoDB, Firebase, Semaphore or OpenAI. Database models are replaced with
in-memory stand-ins (`tests/helpers/`), so the real controllers, middleware,
routes and services are what gets tested.

```bash
cd server
node --test tests/*.test.js                          # quick run
node --test --test-reporter=spec tests/*.test.js     # readable list (used for TEST-RESULTS.txt)
```

Optional: add `"test": "node --test tests/*.test.js"` to `package.json` scripts so `npm test` works.

Latest run: **64 tests, 64 passed** (`TEST-RESULTS.txt`).

## What each file covers (mapped to the panel)

| File | Tests | Panel recommendation |
|---|---|---|
| `security.test.js` | Boots the real Express app. 401 for no / tampered / wrong-secret / expired / revoked / `alg:none` tokens; 403 for deactivated accounts; role taken from the database, not the token; 403 access matrix for patient, staff, facility admin; NoSQL-operator injection; invalid IDs; helmet headers; CORS allow-list; login rate limit | Isip System #9 (security testing), #1 |
| `authAndPrivacy.test.js` | 5 wrong passwords lock the account for 15 min; lock expires; deactivated/unverified blocked; forgot-password does not reveal which numbers are registered; password policy | Isip System #1, #9 |
| `patientDataScope.test.js` | ID photos: real-image check, stored AES-256-GCM encrypted, tamper detection; only owner, same-clinic staff and super admin can view; other clinics cannot approve | Isip System #9, Isip Doc #11 (data protection) |
| `socketSecurity.test.js` | Real-time rooms: anonymous gets nothing; patient gets only anonymous pings and own room; staff only own clinic; revoked / forged / deactivated tokens treated as anonymous | Isip System #6, #9 |
| `gracePeriod.test.js` | S1–S10: call starts the 5-min grace; arrival within 5 min; automatic no-show after 5 min; staff vs sweeper at the same instant; requeue; "on my way"; two staff calling at once; re-call refused; other clinic refused; two sweepers at once | Isip System #7 (remote queue + grace period) |
| `exceptionalScenarios.test.js` | Cancel own ticket; double-tap cancel; cancel others' / finished tickets; manual vs automatic no-show; duplicate registration by phone (any format) and email; invalid / incomplete registration data; password stored hashed | Isip System #11, #2; Saac-Nape #3 |
| `notifications.test.js` | Push delivered; push failed -> SMS fallback; no device -> SMS; routine update not texted; push and SMS both fail; delayed push; push throws; walk-in SMS / no phone; SMS not configured | Isip System #3 (delayed/failed delivery) |
| `reminders.test.js` | 24-hour and 1-hour appointment reminders, no duplicates, SMS fallback | Isip System #3 |
| `effectiveness.test.js` | Predicted-vs-actual reads the right field (regression for the bug that always showed 0 tickets); MAE / bias / within-N%; historical-average baseline | Saac-Nape #1, #2 |
| `validators.test.js` | PH mobile numbers, IDs, regex escaping, operator stripping | Isip System #2 (data validation) |

## Concurrency / load test (Isip System #10, Saac-Nape #3)

`scripts/loadtest/concurrencyTest.js` runs against a **test** server (never
the live clinic database). Start the server with:

```
NODE_ENV=development  DISABLE_RATE_LIMIT=true  (and leave SEMAPHORE_API_KEY unset)
```

then:

```bash
node scripts/loadtest/concurrencyTest.js --base http://localhost:4000 \
     --clinic <clinicId> --service "<a service of that clinic>" --users 50 --duration 30
```

It creates N test patients and measures:
1. all N joining the same queue at the same moment (every join accepted, all queue numbers unique)
2. every patient double-tapping "Join" (no extra tickets)
3. all N booking the same appointment slot (never more than the slot capacity, no double bookings)
4. N phones polling queue status for 30 s (p50 / p95 / p99 response time, error rate, requests per second)

Then it cancels the test tickets and appointments. It saves a `.md` table you
can paste into Chapter 4. Run it at 50, 100 and 200 users and report all three.

## Manual checks still needed (not automatable here)

- **Mobile network interruption:** turn on airplane mode (a) before tapping *Join Queue*, (b) right after tapping *Book*, (c) while the 5-minute grace timer runs. Expected: clear error, no duplicate ticket, the app recovers when the connection returns.
- **Accessibility re-scan:** run Google Accessibility Scanner again on the screens in Tables 48–49 after this update (icon buttons now have labels and 48 dp touch targets) and report before vs. after.
- **Flutter build:** run `flutter analyze` and build both apps. The Dart changes are small (tooltips, `Semantics` wrappers), but they could not be compiled in the environment where they were written.
