import { NewDocumentForm } from "@/components/NewDocumentForm";
import { can, currentRole } from "@/lib/roles";

// Server actions on this page call the model, sometimes more than once.
export const maxDuration = 120;

export const metadata = { title: "Add a document · Intake Desk" };

export default async function NewDocumentPage() {
  const role = await currentRole();
  return <NewDocumentForm allowed={can.runModel(role)} />;
}
