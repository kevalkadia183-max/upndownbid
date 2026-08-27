// Invoice PDFs are generated server-side, never uploaded by a client, so
// they are written directly into the private object dir here rather than
// going through the presigned-upload flow the object storage skill sets up
// for user uploads. Access is gated by our own ownership/admin checks in
// the invoice routes, not the generic ACL policy framework.
import { objectStorageClient } from "./objectStorage";

function privateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR is not configured for invoice storage");
  }
  return dir;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3) {
    throw new Error("Invalid object storage path: must contain at least a bucket name");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

// Saves the PDF under `<privateDir>/invoices/<invoiceId>.pdf` and returns
// the `/objects/...` path convention used by getObjectEntityFile /
// downloadObject, so the same serving helpers work unmodified.
export async function saveInvoicePdf(invoiceId: string, pdf: Buffer): Promise<string> {
  let dir = privateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const entityId = `invoices/${invoiceId}.pdf`;
  const fullPath = `${dir}${entityId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const bucket = objectStorageClient.bucket(bucketName);
  await bucket.file(objectName).save(pdf, {
    contentType: "application/pdf",
    metadata: { contentType: "application/pdf" },
  });
  return `/objects/${entityId}`;
}

export async function readInvoicePdf(objectPath: string): Promise<Buffer> {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error("Invalid invoice object path");
  }
  let dir = privateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const entityId = objectPath.slice("/objects/".length);
  const fullPath = `${dir}${entityId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error("Invoice PDF not found in storage");
  }
  const [contents] = await file.download();
  return contents;
}
