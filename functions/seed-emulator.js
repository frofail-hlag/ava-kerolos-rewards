"use strict";

// Safe local-only seed. It refuses to run unless both Auth and Firestore emulators
// are configured for the demo project; it cannot seed the live Firebase project.
const crypto = require("node:crypto");
const admin = require("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT;
if (projectId !== "demo-ava-rewards" ||
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to seed: use demo-ava-rewards with Auth and Firestore emulators.");
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();
const auth = admin.auth();

async function ensureTeacher() {
  const email = "test.teacher@example.test";
  const password = "TestTeacher123!";
  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password, displayName: "Test Teacher", emailVerified: true, disabled: false });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ email, password, displayName: "Test Teacher", emailVerified: true });
  }
  await db.doc("teachers/" + user.uid).set({
    active: true,
    admin: true,
    email,
    displayName: "Test Teacher",
    createdAt: new Date().toISOString()
  });
  return user.uid;
}

async function seedStudent(teacherUid) {
  const studentUid = "reward_test_1001";
  const code = "TEST-1001";
  const pin = "2468";
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 64).toString("hex");
  await auth.getUser(studentUid).catch(async (error) => {
    if (error.code !== "auth/user-not-found") throw error;
    return auth.createUser({ uid: studentUid, displayName: "Test Student" });
  });
  await db.doc("rewardStudents/" + studentUid).set({
    displayName: "Test Student",
    classId: "test-class",
    active: true,
    balance: 0,
    totalEarned: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: teacherUid,
    authUid: studentUid
  });
  await db.doc("studentCodeLookups/" + code).set({
    studentUid,
    pinSalt: salt.toString("hex"),
    pinHash: hash,
    active: true,
    failedAttempts: 0,
    lockUntil: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

(async () => {
  const teacherUid = await ensureTeacher();
  await seedStudent(teacherUid);
  console.log("Emulator seed ready.");
  console.log("Teacher: test.teacher@example.test / TestTeacher123!");
  console.log("Student: TEST-1001 / 2468");
  console.log("No production Firebase project was accessed.");
  await admin.app().delete();
})().catch(async (error) => {
  console.error(error);
  try { await admin.app().delete(); } catch (_) {}
  process.exit(1);
});
