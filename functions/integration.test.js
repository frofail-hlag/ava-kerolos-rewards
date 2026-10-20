"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword } = require("firebase/auth");
const { getFunctions, httpsCallable, connectFunctionsEmulator } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "demo-ava-rewards";
const region = "europe-west3";
const app = initializeApp({ projectId, apiKey: "fake-api-key", appId: "1:123456789:web:emulator" }, "integration-client");
const auth = getAuth(app);
const functions = getFunctions(app, region);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const call = (name, data) => httpsCallable(functions, name)(data).then((result) => result.data);
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

test("secure Biblereise evaluation persists trusted result and reward claim is idempotent", async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    t.skip("Requires Firebase Auth, Firestore and Functions emulators.");
    return;
  }
  connectAuthEmulator(auth, "http://" + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const suffix = Date.now().toString(36);
  const teacherUid = "teacher_" + suffix;
  const challengeId = "challenge_" + suffix;
  const resultId = "result_" + suffix;
  const studentUid = "reward_" + suffix;
  await admin.auth().createUser({ uid: teacherUid, email: teacherUid + "@example.test", password: "TestPassword123!" });
  const teacherApp = initializeApp({ projectId, apiKey: "fake-api-key", appId: "1:123456789:web:teacher" }, "teacher-" + suffix);
  const teacherAuth = getAuth(teacherApp);
  connectAuthEmulator(teacherAuth, "http://" + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  await signInWithEmailAndPassword(teacherAuth, teacherUid + "@example.test", "TestPassword123!");
  const teacherFunctions = getFunctions(teacherApp, region);
  connectFunctionsEmulator(teacherFunctions, "127.0.0.1", 5001);

  await db.doc("teachers/" + teacherUid).set({ active: true, admin: true });
  await db.doc("challenges/" + challengeId).set({
    status: "published", updatedAt: "version-" + suffix,
    questions: [
      { id: "q1", type: "choice", opts: ["A", "B"], optsAr: ["أ", "ب"] },
      { id: "q2", type: "truefalse", question: "Sky is blue?", questionAr: "هل السماء زرقاء؟" },
      { id: "q3", type: "text", question: "Name the prophet", questionAr: "اذكر اسم النبي" }
    ]
  });
  const teacherQuestions = [
    { id: "q1", type: "choice", a: 1 },
    { id: "q2", type: "truefalse", a: "true" },
    { id: "q3", type: "text", a: "Moses", aAr: "موسى", accepted: ["Moshe"], acceptedAr: ["مُوسَى"] }
  ];
  const syncKey = (data) => httpsCallable(teacherFunctions, "syncRewardChallengeAnswerKey")(data).then((result) => result.data);
  await assert.rejects(
    () => syncKey({ challengeId, questions: teacherQuestions, expectedUpdatedAt: "stale-version-" + suffix }),
    "answer-key sync must reject an outdated public challenge version"
  );
  const synced = await syncKey({ challengeId, questions: teacherQuestions, expectedUpdatedAt: "version-" + suffix });
  assert.equal(synced.ok, true);
  assert.equal(synced.questionCount, 3);
  const syncedKey = (await db.doc("rewardChallengeAnswerKeys/" + challengeId).get()).data();
  assert.equal(syncedKey.publicUpdatedAt, "version-" + suffix);
  assert.equal(syncedKey.questions[2].aAr, "موسى", "teacher publishing bridge must preserve Arabic answers");

  await signInAnonymously(auth);
  const evaluation = await call("evaluateBibleChallengeSubmission", {
    challengeId, resultId, studentName: "Integration Student", elapsedSeconds: 12,
    answers: [
      { questionId: "q1", answer: 1 },
      { questionId: "q2", answer: "true" },
      { questionId: "q3", answer: "موسى" }
    ]
  });
  assert.equal(evaluation.correctCount, 3);
  assert.equal((await db.doc("verifiedChallengeResults/" + resultId).get()).exists, true);
  assert.equal((await db.doc("challengeResults/" + resultId).get()).exists, true);

  // A public challenge edit must invalidate the old private answer key.
  await db.doc("challenges/" + challengeId).update({ updatedAt: "stale-version-" + suffix });
  await assert.rejects(
    () => call("evaluateBibleChallengeSubmission", {
      challengeId, resultId: "stale_" + suffix, studentName: "Stale Version Test", elapsedSeconds: 10,
      answers: [
        { questionId: "q1", answer: 1 },
        { questionId: "q2", answer: "true" },
        { questionId: "q3", answer: "Moses" }
      ]
    }),
    "evaluation must reject a stale private answer key"
  );
  await db.doc("challenges/" + challengeId).update({ updatedAt: "version-" + suffix });

  // Exercise the one-time migration against emulator-only legacy data.
  const legacyChallengeId = "legacy_" + suffix;
  await db.doc("challenges/" + legacyChallengeId).set({
    status: "published", updatedAt: "legacy-version-" + suffix,
    questions: [
      { id: "legacy-q1", type: "choice", q: "Pick one", qAr: "اختر", opts: ["A", "B"], optsAr: ["أ", "ب"], a: 1, aAr: "ب" },
      { id: "legacy-q2", type: "truefalse", q: "True?", qAr: "صحيح؟", a: "true" },
      { id: "legacy-q3", type: "order", q: "Order events", qAr: "رتب الأحداث", items: ["First", "Second", "Third"], itemsAr: ["الأول", "الثاني", "الثالث"] }
    ]
  });
  const migrate = (data = {}) => httpsCallable(teacherFunctions, "migratePublishedChallengeAnswerKeys")(data).then((result) => result.data);
  const migration = await migrate({});
  assert.equal(migration.ok, true);
  assert.equal(migration.migrated, 1);
  const migratedPublic = (await db.doc("challenges/" + legacyChallengeId).get()).data();
  const migratedKey = (await db.doc("rewardChallengeAnswerKeys/" + legacyChallengeId).get()).data();
  assert.equal(migratedPublic.questions.some((question) =>
    ["a", "aAr", "accepted", "acceptedAr"].some((field) => Object.prototype.hasOwnProperty.call(question, field))
  ), false, "legacy public questions must not retain answer fields");
  assert.equal(migratedKey.publicUpdatedAt, migratedPublic.updatedAt, "private key must match the migrated public version");
  assert.equal(migratedKey.questions[0].a, 1, "choice answer must be preserved privately");
  assert.equal(migratedKey.questions[1].a, "true", "true/false answer must be preserved privately");
  const shuffledItems = migratedPublic.questions[2].items;
  const correctOrder = migratedKey.questions[2].correctOrder;
  assert.deepEqual(correctOrder.map((index) => shuffledItems[index]), ["First", "Second", "Third"],
    "private correct order must map to the shuffled public order");
  const rerun = await migrate({});
  assert.equal(rerun.migrated, 0, "migration should be idempotent on a second run");

  await db.doc("rewardStudents/" + studentUid).set({
    displayName: "Integration Student", classId: "test", active: true,
    balance: 0, totalEarned: 0, authUid: studentUid
  });
  await admin.auth().createUser({ uid: studentUid, email: studentUid + "@example.test", password: "TestPassword123!" });
  await admin.auth().setCustomUserClaims(studentUid, { rewardStudent: true });
  const studentApp = initializeApp({ projectId, apiKey: "fake-api-key", appId: "1:123456789:web:student" }, "student-" + suffix);
  const studentAuth = getAuth(studentApp);
  connectAuthEmulator(studentAuth, "http://" + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  await signInWithEmailAndPassword(studentAuth, studentUid + "@example.test", "TestPassword123!");
  const studentFunctions = getFunctions(studentApp, region);
  connectFunctionsEmulator(studentFunctions, "127.0.0.1", 5001);
  const claim = (data) => httpsCallable(studentFunctions, "claimBibleChallengeReward")(data).then((result) => result.data);
  const first = await claim({ resultId });
  const second = await claim({ resultId });
  assert.equal(first.pointsAwarded, 6);
  assert.equal(first.alreadyAwarded, false);
  assert.equal(second.pointsAwarded, 6);
  assert.equal(second.alreadyAwarded, true);
  const profile = await db.doc("rewardStudents/" + studentUid).get();
  assert.equal(profile.get("balance"), 6);
  assert.equal(profile.get("totalEarned"), 6);
  assert.equal((await db.doc("pointTransactions/bible_result_" + resultId).get()).exists, true);

  // Exercise student redemption requests and teacher review against the emulator.
  const rewardId = "reward_item_" + suffix;
  await db.doc("rewards/" + rewardId).set({ name: "Test Reward", cost: 4, active: true });
  await db.doc("rewards/reject_item_" + suffix).set({ name: "Rejected Reward", cost: 2, active: true });
  await db.doc("rewards/expensive_item_" + suffix).set({ name: "Too Expensive", cost: 10, active: true });
  const requestRedemption = (id) => httpsCallable(studentFunctions, "requestRewardRedemption")({ rewardId: id }).then((result) => result.data);
  const reviewRedemption = (id, decision) => httpsCallable(teacherFunctions, "reviewRewardRedemption")({
    redemptionId: id, decision, reviewNote: "Emulator integration test"
  }).then((result) => result.data);
  const approvedRequest = await requestRedemption(rewardId);
  assert.equal(approvedRequest.status, "pending");
  assert.equal(approvedRequest.pointsCost, 4);
  await reviewRedemption(approvedRequest.redemptionId, "approve");
  assert.equal((await db.doc("redemptions/" + approvedRequest.redemptionId).get()).get("status"), "approved");
  assert.equal((await db.doc("rewardStudents/" + studentUid).get()).get("balance"), 2);
  assert.equal((await db.doc("pointTransactions/redemption_" + approvedRequest.redemptionId).get()).get("delta"), -4);
  await assert.rejects(
    () => reviewRedemption(approvedRequest.redemptionId, "approve"),
    "a redemption must not be approved twice"
  );

  const rejectedRequest = await requestRedemption("reject_item_" + suffix);
  await reviewRedemption(rejectedRequest.redemptionId, "reject");
  assert.equal((await db.doc("redemptions/" + rejectedRequest.redemptionId).get()).get("status"), "rejected");
  assert.equal((await db.doc("rewardStudents/" + studentUid).get()).get("balance"), 2,
    "rejecting a redemption must not deduct points");

  const expensiveRequest = await requestRedemption("expensive_item_" + suffix);
  await assert.rejects(
    () => reviewRedemption(expensiveRequest.redemptionId, "approve"),
    "approval must fail when the student balance is insufficient"
  );
  assert.equal((await db.doc("redemptions/" + expensiveRequest.redemptionId).get()).get("status"), "pending",
    "failed approval must leave the request pending");
  assert.equal((await db.doc("rewardStudents/" + studentUid).get()).get("balance"), 2,
    "failed approval must not deduct points");

  // A second authenticated student must not be able to claim the same result.
  const otherStudentUid = "other_reward_" + suffix;
  await db.doc("rewardStudents/" + otherStudentUid).set({
    displayName: "Other Student", classId: "test", active: true,
    balance: 0, totalEarned: 0, authUid: otherStudentUid
  });
  await admin.auth().createUser({ uid: otherStudentUid, email: otherStudentUid + "@example.test", password: "TestPassword123!" });
  await admin.auth().setCustomUserClaims(otherStudentUid, { rewardStudent: true });
  const otherStudentApp = initializeApp({ projectId, apiKey: "fake-api-key", appId: "1:123456789:web:other-student" }, "other-student-" + suffix);
  const otherStudentAuth = getAuth(otherStudentApp);
  connectAuthEmulator(otherStudentAuth, "http://" + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  await signInWithEmailAndPassword(otherStudentAuth, otherStudentUid + "@example.test", "TestPassword123!");
  const otherStudentFunctions = getFunctions(otherStudentApp, region);
  connectFunctionsEmulator(otherStudentFunctions, "127.0.0.1", 5001);
  await assert.rejects(
    () => httpsCallable(otherStudentFunctions, "claimBibleChallengeReward")({ resultId }),
    "a different student must not claim an already-awarded result"
  );
  assert.equal((await db.doc("rewardStudents/" + otherStudentUid).get()).get("balance"), 0);

  await Promise.all([
    db.doc("teachers/" + teacherUid).delete(),
    db.doc("challenges/" + challengeId).delete(),
    db.doc("challenges/" + legacyChallengeId).delete(),
    db.doc("rewardChallengeAnswerKeys/" + legacyChallengeId).delete(),
    db.doc("rewardChallengeAnswerKeys/" + challengeId).delete(),
    db.doc("verifiedChallengeResults/" + resultId).delete(),
    db.doc("challengeResults/" + resultId).delete(),
    db.doc("rewardStudents/" + studentUid).delete(),
    db.doc("rewardStudents/" + otherStudentUid).delete(),
    db.doc("pointTransactions/bible_result_" + resultId).delete(),
    db.doc("rewards/" + rewardId).delete(),
    db.doc("rewards/reject_item_" + suffix).delete(),
    db.doc("rewards/expensive_item_" + suffix).delete(),
    db.doc("redemptions/" + approvedRequest.redemptionId).delete(),
    db.doc("redemptions/" + rejectedRequest.redemptionId).delete(),
    db.doc("redemptions/" + expensiveRequest.redemptionId).delete(),
    db.doc("pointTransactions/redemption_" + approvedRequest.redemptionId).delete()
  ]);
  await Promise.all([teacherAuth.signOut(), studentAuth.signOut(), otherStudentAuth.signOut(), auth.signOut()]);
  await Promise.all([admin.auth().deleteUser(teacherUid), admin.auth().deleteUser(studentUid), admin.auth().deleteUser(otherStudentUid)]);
  await Promise.all([deleteApp(teacherApp), deleteApp(studentApp), deleteApp(otherStudentApp), deleteApp(app)]);
});
