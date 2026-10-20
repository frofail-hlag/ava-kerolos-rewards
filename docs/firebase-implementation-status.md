# Firebase backend implementation status

## Work committed

The `firebase-backend-foundation` branch contains a first server-side implementation draft for the Rewards app:

- Teacher-authorized student creation with hashed PINs.
- Student code + PIN login that returns a Firebase custom token.
- Basic per-code lockout after repeated failed PIN attempts.
- Teacher PIN reset.
- Student reward-redemption requests and teacher approve/reject actions; approval writes the points deduction in the same Firestore transaction as the status change.
- Short-lived challenge attempt issuance for published Bible Challenges.
- Server-side correctness calculation and idempotent points ledger award.
- Own-profile and own-ledger summary callable.
- Separate Rules template and Firebase emulator configuration.

## Do not deploy yet

This is a code foundation, not a production-ready integration. It has not been run against the Firebase Emulator Suite or deployed. Do not deploy the standalone `firestore.rules` file to the existing project: it is intentionally a Rewards-only rules template and would block existing Biblereise access if it replaced the current rules.

Before deployment, required work includes:
1. Verify every current Bible Challenge question type and answer format against the evaluator.
2. Review the Arabic normalization rules with representative lesson content.
3. Add tests for login lockout races, PIN resets, invalid/expired attempts, duplicate submissions, and cross-student access.
4. Add App Check / abuse monitoring and decide the operational PIN reset process.
5. Add the Rewards rules as additive matches to the current Biblereise rules, preserving all existing rules.
6. Confirm Firebase billing and project access.
7. Test the custom-token sign-in and callable flow using emulator credentials.
8. Add the minimal Biblereise client integration in a separate branch; preserve the current `challengeResults` flow until acceptance tests pass.
9. Complete the reward catalogue UI and test redemption requests, teacher approve/reject actions, and atomic balance checks before any point spend.
10. Have a human review the security and test results before production deployment.

## Points policy implemented in this draft

- 1 point per correctly answered question.
- +3 points only when every question in the challenge is correct.
- One award per server-issued attempt ID.

This is provisional and can be changed before launch.


## Responsibilities and agreed operating model

- **Who verifies the evaluator:** I will compare the server-side evaluator against the actual Biblereise question schema and prepare/run automated tests where the available environment permits. The owner should also run representative Bible Challenge cases in the test environment before launch; no single review replaces end-to-end testing.
- **Billing:** the owner confirms the existing Firebase project is on the Blaze plan. This removes the known plan-level blocker, but budget alerts, deployed function usage, and actual project permissions still need review.
- **Redemption:** students submit a request. A teacher manually approves or rejects it. Points are deducted only on approval and the approval/status update plus ledger entry must be atomic.
- **No live deployment yet:** no functions or rules have been deployed and no live Firebase data has been changed.


## Evaluator and balance hardening update

- Added `functions/answer-evaluator.js` as a pure module matching the existing Bible Challenge schema (choice index, true/false string, original item-index order, and accepted German/Arabic text variants).
- Added `functions/answer-evaluator.test.js` with Node's built-in test runner and a `npm test` script. The tests are committed but have **not yet been executed in this environment**.
- The server now reads answer keys from the server-only `rewardChallengeAnswerKeys/{challengeId}` collection instead of trusting the student-readable published challenge document.
- Added the teacher-authorized `syncRewardChallengeAnswerKey` callable. The Biblereise teacher UI must call it whenever a challenge is published or updated. Until that integration exists, a challenge without a synced private key is deliberately not eligible for Rewards.
- Student profiles now initialize `balance` and `totalEarned`; challenge awards and teacher-approved redemptions update the balance in the same Firestore transaction as their ledger/status changes. The summary balance no longer depends on reading only the first 200 ledger entries.
- Attempt creation rejects missing or duplicate question IDs.

## Important security finding: Biblereise still exposes answer keys

The current Biblereise rules allow students to read every published document in `challenges`, and those documents include fields such as `a`, `accepted`, and `acceptedAr`. Therefore, **server-side scoring alone is not enough**: a technically curious student could inspect the public document and discover the answers. The new private answer-key collection protects the Rewards evaluator source, but it does not remove this existing exposure from Biblereise.

Before Rewards points can be considered secure, the Biblereise integration must be updated in a separate branch so the student-facing challenge payload omits answer-key fields while teacher views retain them. The publishing flow must also synchronize the trusted private answer key. This is a required blocker, not a cosmetic improvement.

## Current validation status

- Code is committed on `firebase-backend-foundation`; production has not been changed.
- Automated evaluator tests have been authored but not run yet.
- Firebase Emulator Suite integration, Firestore rules merge/testing, custom-token client sign-in, App Check/rate limiting, and Biblereise UI integration remain outstanding.
- The existing Biblereise `firestore.rules` was reviewed. Its published challenge reads expose the answer-key issue described above. The Rewards-only rules template remains **not deployable as a replacement** for the existing rules.
