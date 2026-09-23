import { NewDocumentForm } from "@/components/NewDocumentForm";
import { can, currentRole } from "@/lib/roles";

export const metadata = { title: "Paste a document · Intake Desk" };

export default async function NewDocumentPage() {
  const role = await currentRole();
  return <NewDocumentForm allowed={can.runModel(role)} />;
}
