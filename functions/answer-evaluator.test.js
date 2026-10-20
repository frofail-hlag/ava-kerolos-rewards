"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAnswer, isCorrect, evaluateQuestions } = require("./answer-evaluator");

test("choice accepts the correct numeric index only", () => {
  assert.equal(isCorrect({ type: "choice", a: 2 }, 2), true);
  assert.equal(isCorrect({ type: "choice", a: 2 }, "2"), true);
  assert.equal(isCorrect({ type: "choice", a: 2 }, 1), false);
  assert.equal(isCorrect({ type: "choice", a: 2 }, "not-a-number"), false);
});

test("true/false compares boolean strings and rejects malformed answer keys", () => {
  assert.equal(isCorrect({ type: "truefalse", a: "true" }, "true"), true);
  assert.equal(isCorrect({ type: "truefalse", a: "true" }, "false"), false);
  assert.equal(isCorrect({ type: "truefalse", a: "anything" }, "anything"), false);
});

test("ordering requires exact order and disallows duplicate indexes", () => {
  const q = { type: "order", items: ["first", "second", "third"] };
  assert.equal(isCorrect(q, [0, 1, 2]), true);
  assert.equal(isCorrect(q, [1, 0, 2]), false);
  assert.equal(isCorrect(q, [0, 0, 2]), false);
  assert.equal(isCorrect(q, [0, 1]), false);
});

test("text answers support accepted German and Arabic variants", () => {
  const q = { type: "text", a: "Moses", aAr: "مُوسَى", accepted: ["Moshe"], acceptedAr: ["موسى"] };
  assert.equal(isCorrect(q, "MOSES"), true);
  assert.equal(isCorrect(q, "Moshe"), true);
  assert.equal(isCorrect(q, "موسى"), true);
  assert.equal(isCorrect(q, "مُوسَى"), true);
  assert.equal(isCorrect(q, "Aaron"), false);
  assert.equal(normalizeAnswer("إِبْرَاهِيم"), normalizeAnswer("ابراهيم"));
});

test("all correct earns one per answer plus completion bonus; partial does not", () => {
  const questions = [
    { id: "q1", type: "choice", a: 1 },
    { id: "q2", type: "truefalse", a: "false" },
    { id: "q3", type: "order", items: ["a", "b"] }
  ];
  const perfect = evaluateQuestions(questions, [
    { questionId: "q1", answer: 1 },
    { questionId: "q2", answer: "false" },
    { questionId: "q3", answer: [0, 1] }
  ]);
  assert.equal(perfect.correctCount, 3);
  assert.equal(perfect.pointsAwarded, 6);
  const partial = evaluateQuestions(questions, [
    { questionId: "q1", answer: 1 },
    { questionId: "q2", answer: "true" },
    { questionId: "q3", answer: [0, 1] }
  ]);
  assert.equal(partial.correctCount, 2);
  assert.equal(partial.pointsAwarded, 2);
});

test("invalid counts, duplicate IDs and unknown question IDs are rejected", () => {
  assert.throws(() => evaluateQuestions([], []), /between 3 and 10/);
  const qs = [{ id: "q1" }, { id: "q2" }, { id: "q3" }];
  assert.throws(() => evaluateQuestions(qs, [{ questionId: "q1" }]), /count must match/);
  assert.throws(() => evaluateQuestions(qs, [
    { questionId: "q1", answer: 1 }, { questionId: "q1", answer: 1 }, { questionId: "q3", answer: 1 }
  ]), /unique question IDs/);
  assert.throws(() => evaluateQuestions(qs, [
    { questionId: "q1", answer: 1 }, { questionId: "q2", answer: 1 }, { questionId: "other", answer: 1 }
  ]), /unique question IDs|unknown question/);
});
