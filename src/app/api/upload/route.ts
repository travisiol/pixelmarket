import { NextResponse } from "next/server";

/**
 * Pins a token logo to IPFS through Pinata (PINATA_JWT, server-side only)
 * and answers { uri: "ipfs://<cid>" }. Without a JWT it answers 501 and the
 * form falls back to a pasted https URL. Pons' own upload endpoint is
 * origin-gated; it is not impersonated here.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) return NextResponse.json({ error: "uploads are not configured" }, { status: 501 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File)) return NextResponse.json({ error: "missing image" }, { status: 400 });
  if (!TYPES.has(file.type)) return NextResponse.json({ error: "png, jpeg, webp or gif only" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "5 mb max" }, { status: 413 });

  const body = new FormData();
  body.append("file", file, file.name || "logo");
  body.append("pinataMetadata", JSON.stringify({ name: `pixelmarket-${Date.now()}` }));
  const r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body,
  });
  if (!r.ok) return NextResponse.json({ error: `pinata answered ${r.status}` }, { status: 502 });
  const j = (await r.json()) as { IpfsHash?: string };
  if (!j.IpfsHash) return NextResponse.json({ error: "pinata returned no hash" }, { status: 502 });
  return NextResponse.json({ uri: `ipfs://${j.IpfsHash}` });
}
