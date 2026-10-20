"use strict";

// Pure evaluator for the existing Biblereise Bible Challenge question schema.
// Choice: q.a is the zero-based correct option index.
// True/false: q.a is the string "true" or "false".
// Order: q.items are authored in correct order; student submits original item indexes.
// Text: accepted answers may be in a/aAr/accepted/acceptedAr.
function normalizeAnswer(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isCorrect(question, submitted) {
  if (!question || typeof question !== "object") return false;
  const type = String(question.type || "choice");
  if (type === "choice") {
    const expected = Number(question.a);
    const actual = Number(submitted);
    return Number.isInteger(expected) && Number.isInteger(actual) && actual === expected;
  }
  if (type === "truefalse") {
    return String(submitted).toLowerCase() === String(question.a).toLowerCase()
      && ["true", "false"].includes(String(question.a).toLowerCase());
  }
  if (type === "order") {
    if (!Array.isArray(submitted) || !Array.isArray(question.items)) return false;
    const expected = question.items.map((_, index) => index);
    const actual = submitted.map(Number);
    return actual.length === expected.length
      && new Set(actual).size === expected.length
      && actual.every((value, index) => Number.isInteger(value) && value === expected[index]);
  }
  const accepted = [
    question.a,
    question.aAr,
    ...(Array.isArray(question.accepted) ? question.accepted : []),
    ...(Array.isArray(question.acceptedAr) ? question.acceptedAr : [])
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const normalized = normalizeAnswer(submitted);
  return normalized !== "" && accepted.some((value) => normalizeAnswer(value) === normalized);
}

function evaluateQuestions(questions, submittedAnswers) {
  if (!Array.isArray(questions) || questions.length < 3 || questions.length > 10) {
    throw new TypeError("Challenge must contain between 3 and 10 questions.");
  }
  if (!Array.isArray(submittedAnswers) || submittedAnswers.length !== questions.length) {
    throw new TypeError("Answer count must match question count.");
  }
  const byId = new Map();
  for (const answer of submittedAnswers) {
    if (!answer || typeof answer.questionId !== "string" || !answer.questionId || byId.has(answer.questionId)) {
      throw new TypeError("Answers must have unique question IDs.");
    }
    byId.set(answer.questionId, answer.answer);
  }
  const seen = new Set();
  const details = questions.map((question) => {
    const id = String(question && question.id || "");
    if (!id || seen.has(id) || !byId.has(id)) throw new TypeError("Question IDs must be unique and every answer must match.");
    seen.add(id);
    return { questionId: id, correct: isCorrect(question, byId.get(id)) };
  });
  if (seen.size !== byId.size) throw new TypeError("An answer references an unknown question.");
  const correctCount = details.filter((item) => item.correct).length;
  const bonusPoints = correctCount === questions.length ? 3 : 0;
  return {
    correctCount,
    questionCount: questions.length,
    pointsAwarded: correctCount + bonusPoints,
    answerDetails: details
  };
}

module.exports = { normalizeAnswer, isCorrect, evaluateQuestions };
