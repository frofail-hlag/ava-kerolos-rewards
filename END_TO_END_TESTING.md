# Local end-to-end test setup (safe demo project)

This branch is for local integration testing only. It is not a production deployment branch.

- Firebase project ID is pinned to `demo-ava-rewards`, a Firebase Emulator Suite demo project.
- The Rewards PWA disables login on any host other than `localhost` or `127.0.0.1`.
- The Biblereise test branch connects to Auth, Firestore and Functions emulators only on localhost.
- Do not merge this branch or deploy it. The normal production branch/configuration is unchanged.

## One-time setup

Requirements: Node.js 22, Java 21 (for the Firestore emulator), and the Firebase CLI.

Clone both repositories and check out the `end-to-end-test-setup` branch in each:

- `frofail-hlag/ava-kerolos-rewards`
- `frofail-hlag/Bible-Escape-Room-Game`

In the Rewards repository, install backend dependencies:

```sh
cd functions
npm install
cd ..
```

## Run the emulators

From the root of the Rewards repository, run:

```sh
firebase emulators:start --project demo-ava-rewards --only auth,firestore,functions
```

Keep this terminal open. It loads the combined test Firestore rules and Rewards callable functions. Do not use the production project ID for this command.

In a second terminal, seed disposable teacher and student accounts:

```sh
cd functions
npm run seed:emulator
```

The seed command refuses to run unless Auth and Firestore emulators are detected and the project ID is exactly `demo-ava-rewards`.

Test-only credentials:
- Teacher: `test.teacher@example.test` / `TestTeacher123!`
- Student: `TEST-1001` / `2468`

## Open both apps locally

From the Biblereise repository root:

```sh
python3 -m http.server 8001
```

From the Rewards repository root, in another terminal:

```sh
python3 -m http.server 8002
```

Open:
- Biblereise: http://localhost:8001
- Rewards: http://localhost:8002

## End-to-end acceptance test

1. In Biblereise, sign in as the test teacher.
2. Create a new Bible Challenge with at least 3 questions and publish it.
3. Confirm the challenge saves without a Firebase sync warning.
4. Open Biblereise in a separate private/incognito browser window and complete the published challenge.
5. Submit the challenge and confirm the result/answer feedback appears only after submission.
6. Claim the result using student code `TEST-1001` and PIN `2468`.
7. Open Rewards at http://localhost:8002 and sign in with the same student code/PIN.
8. Confirm the balance reflects the award. A perfect 3/3 result should award 6 points (3 correct answers + 3 bonus).
9. Repeat the claim for the same result and confirm the balance does not increase a second time.
10. Return to the teacher session and confirm the result is visible in the teacher results view.

Use only the seeded test account and newly created test challenges. The emulator data is disposable and is not live student data.

## Automated checks

The Rewards branch runs evaluator tests, backend syntax checks, and callable integration tests. The Biblereise branch runs JavaScript syntax checks and Firestore rules emulator tests. These automated checks are necessary but do not substitute for the browser acceptance test above.
