# Firebase integration design — milestone 1

Status: design only. No Firebase project settings, live Firestore rules, existing Biblereise code, or deployed Cloud Functions have been changed.

## Existing environment inspected

- Firebase project ID: `bible-escape-room`.
- Existing Firebase web SDK: 12.19.0.
- Existing teacher auth: Firebase Email/Password; active profiles in `teachers/{uid}`.
- Existing student result submission: a separate named Firebase app uses anonymous authentication.
- Existing result collection: `challengeResults/{resultId}`.
- Existing Cloud Functions region: `europe-west3`.
- Existing Biblereise contains both Bible Challenge and Bible Escape Room. Initial Rewards integration covers Bible Challenge only.

## Important current limitation

Biblereise currently sends a browser-generated result with fields such as `score`, `correctCount`, and per-answer `correct`/ `points`. Firestore rules validate the shape and ranges of these values, but do not independently calculate correctness or points. Anonymous authentication also does not identify a student in the Rewards programme.

Therefore, existing `challengeResults` documents are useful for teacher reporting but must not directly trigger Rewards points.

## Recommended integration pattern

1. Keep the current `challengeResults` flow intact for compatibility with Biblereise.
2. Add a Rewards student identity model. Store a normalized student code lookup separately from the student profile; store only a strong server-side hash of the PIN, never plaintext PINs.
3. Authenticate code + PIN through a rate-limited callable function. After verifying the PIN hash, issue a Firebase custom token for the corresponding student UID. The client signs in with that token. A code alone is not authentication.
4. When a signed-in student starts an eligible Bible Challenge, create a short-lived server-issued challenge attempt/session bound to the student's UID and challenge ID.
5. Modify the Bible Challenge client in a reviewed branch to submit the attempt/session ID and raw answers, not a trusted score. Keep the existing result-writing path unchanged until parity tests pass.
6. In a trusted Cloud Function, load the published challenge and answer key, validate the attempt belongs to the signed-in student, calculate correctness and points server-side, and reject malformed or expired attempts.
7. Use a Firestore transaction and a unique attempt/award ID so the same attempt cannot earn points twice.
8. Store an immutable points ledger. Calculate a student's balance from ledger entries or maintain a balance only in the same trusted transaction.
9. Use teacher-only operations for student management, manual adjustments (mandatory reason), reward catalogue edits, and redemption approval.
10. Test in an emulator or isolated test project first; deploy rules/functions only after review and backup.

## Proposed data model

- `rewardStudents/{studentUid}`: minimal profile, class/group, active status, createdAt; no email required.
- `studentCodeLookups/{normalizedCode}`: student UID and server-side PIN hash / credential metadata. Restrict all client reads and writes.
- `rewardChallengeAttempts/{attemptId}`: student UID, challenge ID, expiry, status, and server timestamps. No answer key stored here.
- `pointTransactions/{transactionId}`: student UID, signed point delta, reason/type, source attempt ID, createdAt, and optional teacher UID for manual adjustments. Immutable to clients.
- `rewards/{rewardId}`: display name/description in German and Arabic, cost, active flag, stock/availability as needed.
- `redemptions/{redemptionId}`: student UID, reward ID, points cost, status, createdAt, reviewedBy/reviewedAt.
- Existing `challenges/{challengeId}` and `challengeResults/{resultId}` remain in place.

All names are proposals, not created collections.

## Points policy to confirm

Initial proposal:
- 1 point per correctly answered question, based on the server's answer-key comparison.
- Optional +3 completion bonus, once per eligible challenge attempt. Decide whether the bonus requires all questions answered or a minimum completion threshold.
- One award per attempt ID; repeated submissions are idempotent.
- Teacher adjustments require a reason and create a ledger entry; do not edit old entries to alter balances.

## Security and operational guardrails

- Never accept score, correctness, or points as authoritative input from the browser.
- Apply login throttling / abuse controls to student code + PIN authentication.
- Do not reveal whether a student code exists in login error messages.
- Use least-privilege Firestore rules. Students should read only their own profile, balance/ledger, and eligible rewards; they must not create point transactions directly.
- Teachers must be authorized using the existing active teacher profile and, where appropriate, admin role.
- Keep student data minimal and avoid storing unnecessary personal information.
- Existing Firebase web config values are client configuration, not service-account credentials. Never add service account keys to this repository.
- Check the Firebase billing plan before adding Cloud Functions; existing functions use `europe-west3`.
- The repository is currently public. Consider changing it to private before adding operational details or any sensitive configuration.

## Acceptance tests before launch

- Correct answers earn the expected points; incorrect answers earn none.
- Forged browser score/correct flags do not change points.
- Replaying the same attempt cannot award points twice.
- Expired attempts and attempts for another student's UID are rejected.
- A student cannot read another student's profile, ledger, or redemptions.
- Students cannot create/edit/delete point transactions or approve redemptions.
- Manual adjustments require a reason and are auditable.
- Teacher access follows existing authorization; inactive teachers are rejected.
- Bible Escape Room continues working unchanged.
- No live rules or function deployment until emulator/test results and rollback plan are reviewed.
