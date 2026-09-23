import { KnowledgeDesk, type SectionView } from "@/components/KnowledgeDesk";
import { q } from "@/lib/db";
import { can, currentRole } from "@/lib/roles";

// Server actions on this page call the model, sometimes more than once.
export const maxDuration = 120;

export const metadata = { title: "Ask the SOPs · Intake Desk" };

export default async function AskPage() {
  const role = await currentRole();
  const sections = await q<SectionView>(
    `select id, sop_id, sop_title, owner, n, heading, body, version, edited_by, created_at::text
     from intake.sop_sections where is_current order by sop_id, n`,
  );
  return <KnowledgeDesk sections={sections} canEdit={can.editKnowledge(role)} />;
}
