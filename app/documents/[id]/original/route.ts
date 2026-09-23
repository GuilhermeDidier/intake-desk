import { q } from "@/lib/db";

// Serves the original PDF of a document that arrived as a file.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await q<{ original_pdf: Buffer | null }>(`select original_pdf from intake.documents where id = $1`, [Number(id) || 0]);
  if (!row?.original_pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.original_pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="document-${id}.pdf"` },
  });
}
