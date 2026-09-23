// Retrieval eval: for each question, the section that answers it must be among the sections
// handed to the model (the top K, same K the app uses).
// Runs against the live knowledge base without calling the model, so it is free to run on
// every SOP edit. Grow this list whenever staff ask something the assistant got wrong.
import { RETRIEVE_K as K, search } from "@/lib/knowledge";

const CASES: [question: string, expected: string][] = [
  ["A referral came in without a member ID. What do I do?", "SOP-101 §2"],
  ["Can we send records to a patient's attorney?", "SOP-104 §1"],
  ["A patient mentioned chest pain in a portal message. What now?", "SOP-106 §2"],
  ["An approval expires next week, what should scheduling do?", "SOP-102 §2"],
  ["The consent form is not signed", "SOP-103 §2"],
  ["The referring doctor's NPI looks wrong", "SOP-101 §4"],
  ["A payer denied the MRI. Do we call the patient?", "SOP-102 §3"],
  ["Another doctor treating the patient wants the office notes", "SOP-104 §2"],
  ["Patient says her new insurance starts next month", "SOP-105 §2"],
  ["How quickly do we have to route a fax?", "SOP-100 §1"],
];

(async () => {
  let pass = 0;
  for (const [question, expected] of CASES) {
    const top = (await search(question, K)).map((s) => `${s.sop_id} §${s.n}`);
    const ok = top.includes(expected);
    if (ok) pass++;
    console.log(`${ok ? "pass" : "FAIL"}  ${question}\n      expected ${expected}, got ${top.join(", ") || "nothing"}`);
  }
  console.log(`\nrecall@${K}: ${pass}/${CASES.length} questions retrieve the section that answers them`);
  process.exit(pass === CASES.length ? 0 : 1);
})();
