#!/usr/bin/env node
/**
 * One-time ingestion of the instructor-reviewed CSE 1203 question bank
 * (CSE1203_Mock_Test_Question_Bank_Lectures_1_2.docx, parsed to
 * scripts/data/question_bank.json) into question_banks/questions/
 * question_options, plus creation of the first assessment
 * ("CSE 1203 Mock Test — Lectures 1 & 2") and its sampling rules
 * (5 from Lecture 1, 5 from Lecture 2).
 *
 * Uses the admin client — this is a one-time bulk load of a reviewed
 * document, the same category of operation as supabase/seed.sql, not a
 * per-request user action. The instructor-facing UI this pass adds
 * (create/edit questions and tests) goes through ordinary RLS-scoped
 * instructor writes; this script only ever needs to run once per bank.
 *
 * The assessment is created PUBLISHED (so the instructor can preview it
 * immediately) but LOCKED (no student can start it) — unlock happens
 * through the real "Manage test" UI, not this script, per instruction.
 *
 * Usage: node --env-file=.env.local scripts/ingest-question-bank.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const COURSE_ID = "11111111-1111-1111-1111-111111111111";
const LECTURE_1_ID = "6f9552b5-9b40-4706-8a29-4297fcca01fd";
const LECTURE_2_ID = "342d2c46-f6dd-41ef-bf71-fe21fe6bd636";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SECRET_KEY");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const raw = await readFile(
    path.resolve(import.meta.dirname, "data/question_bank.json"),
    "utf-8",
  );
  const parsedQuestions = JSON.parse(raw);
  if (parsedQuestions.length !== 100) {
    throw new Error(`Expected 100 questions, got ${parsedQuestions.length}`);
  }

  // Idempotent: if a bank with this title already exists for the
  // course, reuse it (delete and recreate its questions) rather than
  // duplicating on re-run.
  const bankTitle = "CSE 1203 — Lectures 1 & 2 Question Bank";
  const { data: existingBank } = await admin
    .from("question_banks")
    .select("id")
    .eq("course_id", COURSE_ID)
    .eq("title", bankTitle)
    .maybeSingle();

  let bankId;
  if (existingBank) {
    bankId = existingBank.id;
    await admin.from("questions").delete().eq("bank_id", bankId); // cascades options
    console.log(`reusing existing bank ${bankId}, cleared old questions`);
  } else {
    const { data: bank, error: bankError } = await admin
      .from("question_banks")
      .insert({ course_id: COURSE_ID, title: bankTitle, version: 1 })
      .select("id")
      .single();
    if (bankError) throw bankError;
    bankId = bank.id;
    console.log(`created bank ${bankId}`);
  }

  let inserted = 0;
  for (const q of parsedQuestions) {
    const sourceLectureId = q.lecture === "L1" ? LECTURE_1_ID : LECTURE_2_ID;

    const { data: question, error: qError } = await admin
      .from("questions")
      .insert({
        bank_id: bankId,
        source_lecture_id: sourceLectureId,
        topic: q.topic,
        difficulty: "easy",
        question_type: "single_choice",
        prompt: q.prompt,
        active: true,
        source_position: q.number,
      })
      .select("id")
      .single();
    if (qError) throw new Error(`question ${q.number}: ${qError.message}`);

    const optionRows = q.options.map((o, i) => ({
      question_id: question.id,
      position: i,
      text: o.text,
      is_correct: o.correct,
    }));
    const { error: optError } = await admin.from("question_options").insert(optionRows);
    if (optError) throw new Error(`question ${q.number} options: ${optError.message}`);

    inserted++;
  }
  console.log(`inserted ${inserted} questions with options`);

  // The assessment itself — idempotent on title within the course.
  const assessmentTitle = "CSE 1203 Mock Test — Lectures 1 & 2";
  const { data: existingAssessment } = await admin
    .from("assessments")
    .select("id")
    .eq("course_id", COURSE_ID)
    .eq("title", assessmentTitle)
    .maybeSingle();

  let assessmentId;
  if (existingAssessment) {
    assessmentId = existingAssessment.id;
    await admin.from("assessment_rules").delete().eq("assessment_id", assessmentId);
    await admin
      .from("assessments")
      .update({ bank_id: bankId, question_count: 10 })
      .eq("id", assessmentId);
    console.log(`reusing existing assessment ${assessmentId}`);
  } else {
    const { data: assessment, error: aError } = await admin
      .from("assessments")
      .insert({
        course_id: COURSE_ID,
        bank_id: bankId,
        title: assessmentTitle,
        instructions:
          "10 easy questions covering Lectures 1 and 2 — 5 from each, in random order with randomized answer choices. Low-stakes practice: your results are shown immediately after you submit. You get one attempt.",
        question_count: 10,
        published_at: new Date().toISOString(), // visible/previewable now
        locked: true, // students cannot start until an instructor unlocks it
      })
      .select("id")
      .single();
    if (aError) throw aError;
    assessmentId = assessment.id;
    console.log(`created assessment ${assessmentId}`);
  }

  const { error: rulesError } = await admin.from("assessment_rules").insert([
    { assessment_id: assessmentId, position: 1, source_lecture_id: LECTURE_1_ID, count: 5 },
    { assessment_id: assessmentId, position: 2, source_lecture_id: LECTURE_2_ID, count: 5 },
  ]);
  if (rulesError) throw rulesError;
  console.log("created assessment rules (5 from Lecture 1, 5 from Lecture 2)");

  console.log("\nDone.", { bankId, assessmentId });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
