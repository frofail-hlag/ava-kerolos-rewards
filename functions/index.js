"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { promisify } = require("util");
const { evaluateQuestions } = require("./answer-evaluator");

admin.initializeApp();
const db = admin.firestore();
const scrypt = promisify(crypto.scrypt);
const REGION = "europe-west3";
const PIN_KEYLEN = 64;
const PIN_SALT_BYTES = 16;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const ATTEMPT_TTL_MS = 60 * 60 * 1000;
const CORRECT_ANSWER_POINTS = 1;
const COMPLETION_BONUS = 3;

function fail(code, message) {
  throw new functions.https.HttpsError(code, message);
}
function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}
function requireTeacher(context) {
  if (!context.auth) fail("unauthenticated", "Bitte melde dich als Lehrkraft an.");
  return db.collection("teachers").doc(context.auth.uid).get().then((snap) => {
    if (!snap.exists || snap.get("active") !== true) {
      fail("permission-denied", "Ein aktives Lehrkraftkonto ist erforderlich.");
    }
    return { uid: context.auth.uid, admin: snap.get("admin") === true };
  });
}
function requireRewardStudent(context) {
  if (!context.auth || context.auth.token.rewardStudent !== true) {
    fail("permission-denied", "Bitte melde dich mit deinem Schülercode an.");
  }
  return context.auth.uid;
}
async function hashPin(pin, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(PIN_SALT_BYTES);
  const derived = await scrypt(String(pin), salt, PIN_KEYLEN);
  return { salt: salt.toString("hex"), hash: Buffer.from(derived).toString("hex") };
}
function safeCompareHex(a, b) {
  if (!/^[0-9a-f]+$/i.test(a || "") || !/^[0-9a-f]+$/i.test(b || "") || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Teacher creates a student. PIN is hashed server-side and never returned.
 * The teacher's existing active profile authorizes this operation.
 */
exports.createRewardStudent = functions.region(REGION).https.onCall(async (data, context) => {
  const teacher = await requireTeacher(context);
  const code = cleanCode(data && data.studentCode);
  const pin = String((data && data.pin) || "");
  const displayName = String((data && data.displayName) || "").trim().slice(0, 80);
  const classId = String((data && data.classId) || "").trim().slice(0, 80);
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) fail("invalid-argument", "Der Schülercode muss 4–24 Zeichen aus Buchstaben, Zahlen oder Bindestrichen enthalten.");
  if (!/^\d{4,10}$/.test(pin)) fail("invalid-argument", "Die PIN muss aus 4–10 Ziffern bestehen.");
  if (displayName.length < 1) fail("invalid-argument", "Bitte gib einen Anzeigenamen ein.");
  if (!classId) fail("invalid-argument", "Bitte wähle eine Klasse.");
  const lookupRef = db.collection("studentCodeLookups").doc(code);
  const uid = "reward_" + crypto.randomBytes(18).toString("hex");
  const profileRef = db.collection("rewardStudents").doc(uid);
  const credentials = await hashPin(pin);
  const now = admin.firestore.FieldValue.serverTimestamp();
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(lookupRef);
      if (existing.exists) fail("already-exists", "Dieser Schülercode ist bereits vergeben.");
      tx.create(profileRef, {
        displayName, classId, active: true, balance: 0, totalEarned: 0, createdAt: now,
        createdBy: teacher.uid, authUid: uid
      });
      tx.create(lookupRef, {
        studentUid: uid, pinSalt: credentials.salt, pinHash: credentials.hash,
        active: true, failedAttempts: 0, lockUntil: null, createdAt: now
      });
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error("createRewardStudent failed", error);
    fail("internal", "Der Schüler konnte nicht angelegt werden. Bitte versuche es erneut.");
  }
  return { studentUid: uid, studentCode: code, displayName, classId };
});

/**
 * Login responses deliberately do not disclose whether a student code exists.
 * A per-code lockout slows repeated PIN guessing; production should also add
 * App Check / monitoring and teacher-assisted resets.
 */
exports.loginRewardStudent = functions.region(REGION).https.onCall(async (data, context) => {
  const code = cleanCode(data && data.studentCode);
  const pin = String((data && data.pin) || "");
  if (!/^[A-Z0-9-]{4,24}$/.test(code) || !/^\d{4,10}$/.test(pin)) {
    fail("unauthenticated", "Schülercode oder PIN ist ungültig.");
  }
  const lookupRef = db.collection("studentCodeLookups").doc(code);
  const lookupSnap = await lookupRef.get();
  // Perform a dummy scrypt operation for unknown codes to reduce obvious timing differences.
  if (!lookupSnap.exists) {
    await hashPin(pin, "00112233445566778899aabbccddeeff");
    fail("unauthenticated", "Schülercode oder PIN ist ungültig.");
  }
  const lookup = lookupSnap.data();
  const nowMs = Date.now();
  if (lookup.active !== true || (lookup.lockUntil && lookup.lockUntil.toMillis && lookup.lockUntil.toMillis() > nowMs)) {
    fail("resource-exhausted", "Die Anmeldung ist vorübergehend gesperrt. Bitte wende dich an deine Lehrkraft.");
  }
  const attempted = await hashPin(pin, lookup.pinSalt);
  const valid = safeCompareHex(attempted.hash, lookup.pinHash);
  if (!valid) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(lookupRef);
      if (!fresh.exists) return;
      const current = fresh.data();
      const count = (Number(current.failedAttempts) || 0) + 1;
      tx.update(lookupRef, {
        failedAttempts: count,
        lockUntil: count >= LOGIN_MAX_FAILURES ? admin.firestore.Timestamp.fromMillis(nowMs + LOGIN_LOCK_MS) : null
      });
    });
    fail("unauthenticated", "Schülercode oder PIN ist ungültig.");
  }
  const profileSnap = await db.collection("rewardStudents").doc(lookup.studentUid).get();
  if (!profileSnap.exists || profileSnap.get("active") !== true) fail("unauthenticated", "Schülercode oder PIN ist ungültig.");
  await lookupRef.update({ failedAttempts: 0, lockUntil: null, lastLoginAt: admin.firestore.FieldValue.serverTimestamp() });
  const token = await admin.auth().createCustomToken(lookup.studentUid, { rewardStudent: true });
  return { token, displayName: profileSnap.get("displayName"), classId: profileSnap.get("classId") };
});

/** Teacher can deactivate a student and reset the PIN without reading the old PIN. */
exports.resetRewardStudentPin = functions.region(REGION).https.onCall(async (data, context) => {
  await requireTeacher(context);
  const code = cleanCode(data && data.studentCode);
  const pin = String((data && data.newPin) || "");
  if (!/^[A-Z0-9-]{4,24}$/.test(code) || !/^\d{4,10}$/.test(pin)) fail("invalid-argument", "Bitte prüfe Schülercode und neue PIN.");
  const ref = db.collection("studentCodeLookups").doc(code);
  const snap = await ref.get();
  if (!snap.exists) fail("not-found", "Der Schüler wurde nicht gefunden.");
  const credentials = await hashPin(pin);
  await ref.update({
    pinSalt: credentials.salt, pinHash: credentials.hash,
    failedAttempts: 0, lockUntil: null,
    pinUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
});

/**
 * Teacher-only publishing bridge. The Biblereise teacher UI must call this
 * after publishing/updating a challenge. This private collection is the
 * trusted evaluator source; the public challenges collection is not trusted
 * for answer keys because published documents are readable by students.
 */
exports.syncRewardChallengeAnswerKey = functions.region(REGION).https.onCall(async (data, context) => {
  const teacher = await requireTeacher(context);
  const challengeId = String((data && data.challengeId) || "").trim();
  const suppliedQuestions = data && data.questions;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(challengeId) || !Array.isArray(suppliedQuestions)) {
    fail("invalid-argument", "Ungültige Challenge-Antworten.");
  }
  const challengeRef = db.collection("challenges").doc(challengeId);
  const snap = await challengeRef.get();
  if (!snap.exists || snap.get("status") !== "published") {
    fail("failed-precondition", "Nur veröffentlichte Challenges können vorbereitet werden.");
  }
  const publicQuestions = snap.get("questions");
  if (!Array.isArray(publicQuestions) || publicQuestions.length < 3 || publicQuestions.length > 10 ||
      suppliedQuestions.length !== publicQuestions.length) {
    fail("failed-precondition", "Die Challenge muss 3 bis 10 passende Fragen enthalten.");
  }
  const publicIds = publicQuestions.map((q) => String(q && q.id || ""));
  const suppliedIds = suppliedQuestions.map((q) => String(q && q.id || ""));
  if (publicIds.some((id, i) => !id || id !== suppliedIds[i]) || new Set(publicIds).size !== publicIds.length) {
    fail("failed-precondition", "Die Fragen stimmen nicht mit der veröffentlichten Challenge überein.");
  }
  const safeQuestions = suppliedQuestions.map((q) => ({
    id: String(q.id),
    type: String(q.type || "choice"),
    a: q.a,
    aAr: q.aAr,
    accepted: Array.isArray(q.accepted) ? q.accepted.slice(0, 30) : [],
    acceptedAr: Array.isArray(q.acceptedAr) ? q.acceptedAr.slice(0, 30) : [],
    items: Array.isArray(q.items) ? q.items.slice(0, 20) : []
  }));
  await db.collection("rewardChallengeAnswerKeys").doc(challengeId).set({
    challengeId, questions: safeQuestions, syncedBy: teacher.uid,
    syncedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, challengeId, questionCount: safeQuestions.length };
});

/**
 * Anonymous Biblereise students receive answer feedback only after submitting
 * the entire challenge. The answer key is read only by the Admin SDK.
 */
exports.evaluateBibleChallengeSubmission = functions.region(REGION).https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.token || !context.auth.token.firebase ||
      context.auth.token.firebase.sign_in_provider !== "anonymous") {
    fail("unauthenticated", "Bitte starte die Challenge erneut.");
  }
  const challengeId = String((data && data.challengeId) || "").trim();
  const answers = data && data.answers;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(challengeId) || !Array.isArray(answers) || answers.length > 10) {
    fail("invalid-argument", "Ungültige Challenge-Antworten.");
  }
  const [challengeSnap, keySnap] = await Promise.all([
    db.collection("challenges").doc(challengeId).get(),
    db.collection("rewardChallengeAnswerKeys").doc(challengeId).get()
  ]);
  if (!challengeSnap.exists || challengeSnap.get("status") !== "published") {
    fail("failed-precondition", "Diese Challenge ist nicht mehr veröffentlicht.");
  }
  if (!keySnap.exists) fail("failed-precondition", "Diese Challenge wurde noch nicht sicher vorbereitet. Bitte informiere die Lehrkraft.");
  const publicQuestions = challengeSnap.get("questions");
  const keyQuestions = keySnap.get("questions");
  if (!Array.isArray(publicQuestions) || !Array.isArray(keyQuestions) ||
      publicQuestions.length !== keyQuestions.length || answers.length !== keyQuestions.length) {
    fail("invalid-argument", "Die Anzahl der Antworten stimmt nicht mit der Challenge überein.");
  }
  if (publicQuestions.some((q, i) => !q || !keyQuestions[i] || q.id !== keyQuestions[i].id)) {
    fail("failed-precondition", "Die Challenge wurde geändert. Bitte starte sie erneut.");
  }
  let evaluation;
  try {
    evaluation = evaluateQuestions(keyQuestions, answers);
  } catch (error) {
    fail("invalid-argument", error.message || "Ungültige Antworten.");
  }
  const answerById = new Map(answers.map((item) => [item.questionId, item.answer]));
  const keyById = new Map(keyQuestions.map((item) => [item.id, item]));
  const details = evaluation.answerDetails.map((detail) => {
    const question = publicQuestions.find((q) => q.id === detail.questionId);
    const key = keyById.get(detail.questionId);
    let correctAnswer = "";
    if (key.type === "choice") {
      correctAnswer = (question.opts || [])[Number(key.a)] || "";
    } else if (key.type === "truefalse") {
      correctAnswer = String(key.a) === "true" ? "true" : "false";
    } else if (key.type === "order") {
      correctAnswer = (key.items || []).join(" → ");
    } else {
      correctAnswer = String(key.a || key.aAr || (key.accepted || [])[0] || (key.acceptedAr || [])[0] || "");
    }
    return {
      questionId: detail.questionId,
      correct: detail.correct,
      given: answerById.get(detail.questionId),
      correctAnswer,
      explanation: String(question.explanation || ""),
      explanationAr: String(question.explanationAr || "")
    };
  });
  return {
    correctCount: evaluation.correctCount,
    questionCount: evaluation.questionCount,
    pointsAwarded: evaluation.pointsAwarded,
    answerDetails: details
  };
});

exports.startRewardChallengeAttempt = functions.region(REGION).https.onCall(async (data, context) => {
  const studentUid = requireRewardStudent(context);
  const challengeId = String((data && data.challengeId) || "").trim();
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(challengeId)) fail("invalid-argument", "Ungültige Challenge.");
  const profile = await db.collection("rewardStudents").doc(studentUid).get();
  if (!profile.exists || profile.get("active") !== true) fail("permission-denied", "Dieses Schülerkonto ist deaktiviert.");
  const challengeSnap = await db.collection("challenges").doc(challengeId).get();
  if (!challengeSnap.exists || challengeSnap.get("status") !== "published") fail("failed-precondition", "Diese Challenge ist nicht veröffentlicht.");
  const questions = challengeSnap.get("questions");
  if (!Array.isArray(questions) || questions.length < 3 || questions.length > 10) fail("failed-precondition", "Diese Challenge kann nicht für Rewards gewertet werden.");
  const questionIds = questions.map((q) => String(q && q.id || ""));
  if (questionIds.some((id) => !id) || new Set(questionIds).size !== questionIds.length) {
    fail("failed-precondition", "Die Challenge enthält ungültige oder doppelte Fragen-IDs.");
  }
  const attemptRef = db.collection("rewardChallengeAttempts").doc();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ATTEMPT_TTL_MS);
  await attemptRef.create({
    studentUid, challengeId, status: "started",
    questionIds,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt
  });
  return { attemptId: attemptRef.id, expiresAt: expiresAt.toDate().toISOString() };
});

/**
 * Server recalculates points from the published answer key. Client-supplied
 * scores/correct flags are never accepted. One transaction per attempt prevents
 * duplicate awards on retries.
 */
exports.submitRewardChallengeAttempt = functions.region(REGION).https.onCall(async (data, context) => {
  const studentUid = requireRewardStudent(context);
  const attemptId = String((data && data.attemptId) || "").trim();
  const submittedAnswers = data && data.answers;
  if (!/^[A-Za-z0-9_-]{10,150}$/.test(attemptId) || !Array.isArray(submittedAnswers) || submittedAnswers.length > 10) {
    fail("invalid-argument", "Ungültige Challenge-Antworten.");
  }
  const attemptRef = db.collection("rewardChallengeAttempts").doc(attemptId);
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists || attemptSnap.get("studentUid") !== studentUid) fail("permission-denied", "Dieser Versuch gehört nicht zu deinem Konto.");
  if (attemptSnap.get("status") === "awarded") {
    return { alreadyAwarded: true, pointsAwarded: attemptSnap.get("pointsAwarded") || 0 };
  }
  if (attemptSnap.get("status") !== "started" || attemptSnap.get("expiresAt").toMillis() < Date.now()) {
    fail("deadline-exceeded", "Dieser Versuch ist abgelaufen. Bitte starte die Challenge erneut.");
  }
  const challengeId = attemptSnap.get("challengeId");
  const challengeRef = db.collection("challenges").doc(challengeId);
  const answerKeyRef = db.collection("rewardChallengeAnswerKeys").doc(challengeId);
  const [challengeSnap, answerKeySnap] = await Promise.all([challengeRef.get(), answerKeyRef.get()]);
  if (!challengeSnap.exists || challengeSnap.get("status") !== "published") fail("failed-precondition", "Diese Challenge ist nicht mehr veröffentlicht.");
  if (!answerKeySnap.exists) fail("failed-precondition", "Die Challenge wurde noch nicht sicher für Rewards vorbereitet. Bitte informiere die Lehrkraft.");
  const questions = answerKeySnap.get("questions");
  if (!Array.isArray(questions) || questions.length !== attemptSnap.get("questionIds").length || submittedAnswers.length !== questions.length) {
    fail("invalid-argument", "Die Anzahl der Antworten stimmt nicht mit der Challenge überein.");
  }
  const publicIds = attemptSnap.get("questionIds");
  const keyIds = questions.map((q) => String(q && q.id || ""));
  if (keyIds.some((id, index) => !id || id !== publicIds[index]) || new Set(keyIds).size !== keyIds.length) {
    fail("failed-precondition", "Die Challenge wurde seit dem Start geändert. Bitte starte sie erneut.");
  }
  let evaluation;
  try {
    evaluation = evaluateQuestions(questions, submittedAnswers);
  } catch (error) {
    fail("invalid-argument", error.message || "Ungültige Antworten.");
  }
  const { correctCount, pointsAwarded, answerDetails: details } = evaluation;
  const ledgerRef = db.collection("pointTransactions").doc("challenge_" + attemptId);
  await db.runTransaction(async (tx) => {
    const studentRef = db.collection("rewardStudents").doc(studentUid);
    const [freshAttempt, freshLedger, freshProfile] = await Promise.all([tx.get(attemptRef), tx.get(ledgerRef), tx.get(studentRef)]);
    if (!freshAttempt.exists || freshAttempt.get("studentUid") !== studentUid) fail("permission-denied", "Dieser Versuch ist ungültig.");
    if (freshLedger.exists || freshAttempt.get("status") === "awarded") return;
    if (freshAttempt.get("status") !== "started" || freshAttempt.get("expiresAt").toMillis() < Date.now()) fail("deadline-exceeded", "Dieser Versuch ist abgelaufen.");
    if (!freshProfile.exists || freshProfile.get("active") !== true) fail("permission-denied", "Dieses Schülerkonto ist deaktiviert.");
    tx.create(ledgerRef, {
      studentUid, delta: pointsAwarded, type: "challenge_earned",
      challengeId: freshAttempt.get("challengeId"), attemptId,
      correctCount, questionCount: questions.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(studentRef, {
      balance: (Number(freshProfile.get("balance")) || 0) + pointsAwarded,
      totalEarned: (Number(freshProfile.get("totalEarned")) || 0) + pointsAwarded
    });
    tx.update(attemptRef, {
      status: "awarded", pointsAwarded, correctCount,
      questionCount: questions.length,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  return { pointsAwarded, correctCount, questionCount: questions.length, answerDetails: details };
});

/** Read own profile and ledger only. */
exports.getRewardStudentSummary = functions.region(REGION).https.onCall(async (_data, context) => {
  const studentUid = requireRewardStudent(context);
  const [profile, ledger] = await Promise.all([
    db.collection("rewardStudents").doc(studentUid).get(),
    db.collection("pointTransactions").where("studentUid", "==", studentUid).limit(50).get()
  ]);
  if (!profile.exists || profile.get("active") !== true) fail("permission-denied", "Dieses Schülerkonto ist deaktiviert.");
  const transactions = ledger.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const balance = Number(profile.get("balance")) || 0;
  return {
    displayName: profile.get("displayName"),
    classId: profile.get("classId"),
    balance,
    transactions: transactions.map((item) => ({
      id: item.id, delta: item.delta, type: item.type,
      createdAt: item.createdAt && item.createdAt.toDate ? item.createdAt.toDate().toISOString() : null
    }))
  };
});


/** Student requests a reward; no points are spent until a teacher approves. */
exports.requestRewardRedemption = functions.region(REGION).https.onCall(async (data, context) => {
  const studentUid = requireRewardStudent(context);
  const rewardId = String((data && data.rewardId) || "").trim();
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(rewardId)) fail("invalid-argument", "Ungültige Belohnung.");
  const rewardRef = db.collection("rewards").doc(rewardId);
  const rewardSnap = await rewardRef.get();
  if (!rewardSnap.exists || rewardSnap.get("active") !== true) fail("not-found", "Diese Belohnung ist nicht verfügbar.");
  const cost = Number(rewardSnap.get("cost"));
  if (!Number.isSafeInteger(cost) || cost <= 0) fail("failed-precondition", "Diese Belohnung hat keinen gültigen Punktewert.");
  const redemptionRef = db.collection("redemptions").doc();
  await redemptionRef.create({
    studentUid, rewardId, rewardName: String(rewardSnap.get("name") || ""),
    pointsCost: cost, status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { redemptionId: redemptionRef.id, status: "pending", pointsCost: cost };
});

/** Teacher approves/rejects a pending request. Approval and point deduction are atomic. */
exports.reviewRewardRedemption = functions.region(REGION).https.onCall(async (data, context) => {
  const teacher = await requireTeacher(context);
  const redemptionId = String((data && data.redemptionId) || "").trim();
  const decision = String((data && data.decision) || "").trim();
  const reviewNote = String((data && data.reviewNote) || "").trim().slice(0, 500);
  if (!/^[A-Za-z0-9_-]{10,150}$/.test(redemptionId) || !["approve", "reject"].includes(decision)) {
    fail("invalid-argument", "Ungültige Entscheidung.");
  }
  const redemptionRef = db.collection("redemptions").doc(redemptionId);
  const redemptionSnap = await redemptionRef.get();
  if (!redemptionSnap.exists) fail("not-found", "Die Anfrage wurde nicht gefunden.");
  const redemption = redemptionSnap.data();
  const studentUid = redemption.studentUid;
  const pointsCost = Number(redemption.pointsCost);
  const ledgerRef = db.collection("pointTransactions").doc("redemption_" + redemptionId);
  await db.runTransaction(async (tx) => {
    const [freshRedemption, ledger, profile] = await Promise.all([
      tx.get(redemptionRef),
      tx.get(ledgerRef),
      tx.get(db.collection("rewardStudents").doc(studentUid))
    ]);
    if (!freshRedemption.exists || freshRedemption.get("status") !== "pending") {
      fail("failed-precondition", "Diese Anfrage wurde bereits bearbeitet.");
    }
    if (!profile.exists || profile.get("active") !== true) fail("failed-precondition", "Das Schülerkonto ist nicht aktiv.");
    if (decision === "reject") {
      tx.update(redemptionRef, {
        status: "rejected", reviewedBy: teacher.uid,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewNote
      });
      return;
    }
    if (!Number.isSafeInteger(pointsCost) || pointsCost <= 0 || ledger.exists) fail("failed-precondition", "Die Punktebuchung ist ungültig.");
    const balance = Number(profile.get("balance")) || 0;
    if (balance < pointsCost) fail("failed-precondition", "Nicht genügend Punkte für diese Belohnung.");
    tx.create(ledgerRef, {
      studentUid, delta: -pointsCost, type: "reward_redeemed",
      redemptionId, rewardId: freshRedemption.get("rewardId"),
      reason: "Teacher-approved reward redemption",
      createdBy: teacher.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(profile.ref, { balance: balance - pointsCost });
    tx.update(redemptionRef, {
      status: "approved", reviewedBy: teacher.uid,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewNote
    });
  });
  return { ok: true, decision };
});
