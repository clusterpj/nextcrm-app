import { prismadb } from "@/lib/prisma";
import { NextResponse } from "next/server";

/**
 * Web-to-lead ingest endpoint.
 *
 * Used by pedrojimenez.dev's `/api/scope` to mirror every captured lead into
 * NextCRM, which is Pedro's admin surface. Auth is a shared secret
 * (`NEXTCRM_TOKEN`) sent in the Authorization header, raw or Bearer-prefixed.
 *
 * Body (all optional except a way to reach the visitor):
 *   firstName, lastName, name (combined), account, job, email, phone,
 *   lead_source (resolved by name, created if missing), description.
 */
export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return NextResponse.json(
      { message: "Invalid content-type" },
      { status: 400 }
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();

  const expected = (process.env.NEXTCRM_TOKEN ?? "").trim();
  if (!expected) {
    return NextResponse.json(
      { message: "NEXTCRM_TOKEN not defined" },
      { status: 401 }
    );
  }
  if (!token || token !== expected) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: "No body" }, { status: 400 });
  }

  const {
    firstName,
    lastName,
    name,
    account,
    job,
    email,
    phone,
    lead_source,
    description,
  } = body as Record<string, unknown>;

  const emailStr = typeof email === "string" ? email.trim() : "";
  // A lead must be reachable: email is the primary handle for web leads.
  if (!emailStr && !(typeof name === "string" && name.trim())) {
    return NextResponse.json(
      { message: "Missing required fields" },
      { status: 400 }
    );
  }

  // Combined "name" field → first/last split (the portfolio sends one field).
  let first = typeof firstName === "string" ? firstName.trim() : "";
  let last = typeof lastName === "string" ? lastName.trim() : "";
  if ((!first || !last) && typeof name === "string" && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (!first) first = parts[0] ?? "";
    if (!last) last = parts.slice(1).join(" ") || "—";
  }
  if (first && !last) last = "—";

  try {
    // Resolve the lead source by name, creating it on first use (name is unique).
    const sourceName = (typeof lead_source === "string" && lead_source.trim()) || "Web";
    const source = await prismadb.crm_Lead_Sources.upsert({
      where: { name: sourceName },
      update: {},
      create: { name: sourceName, v: 1 },
    });

    const lead = await prismadb.crm_Leads.create({
      data: {
        v: 1,
        firstName: first || null,
        // lastName is required by the model — placeholder when unknown.
        lastName: last || "—",
        company: typeof account === "string" ? account : null,
        jobTitle: typeof job === "string" ? job : null,
        email: emailStr || null,
        phone: typeof phone === "string" ? phone : null,
        description: typeof description === "string" ? description : null,
        lead_source_id: source.id,
      },
    });

    return NextResponse.json(
      { message: "New lead created successfully", id: lead.id },
      { status: 201 }
    );
  } catch (error) {
    console.error("[create-lead-from-web]", error);
    return NextResponse.json(
      { message: "Error creating new lead" },
      { status: 500 }
    );
  }
}
