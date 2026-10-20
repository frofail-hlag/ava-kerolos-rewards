# Firebase backend implementation status

## Work committed

The `firebase-backend-foundation` branch contains a first server-side implementation draft for the Rewards app:

- Teacher-authorized student creation with hashed PINs.
- Student code + PIN login that returns a Firebase custom token.
- Basic per-code lockout after repeated failed PIN attempts.
- Teacher PIN reset.
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
9. Add reward catalogue and redemption transactions, including atomic balance checks before any point spend.
10. Have a human review the security and test results before production deployment.

## Points policy implemented in this draft

- 1 point per correctly answered question.
- +3 points only when every question in the challenge is correct.
- One award per server-issued attempt ID.

This is provisional and can be changed before launch.
