import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "baby_tracker_access";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

type AccessConfig = {
  code: string;
  token: string;
};

async function getAccessConfig(): Promise<AccessConfig | null> {
  const { env } = await import("cloudflare:workers");
  const code =
    typeof env.BABY_TRACKER_ACCESS_CODE === "string"
      ? env.BABY_TRACKER_ACCESS_CODE.trim()
      : "";
  const token =
    typeof env.BABY_TRACKER_ACCESS_TOKEN === "string"
      ? env.BABY_TRACKER_ACCESS_TOKEN.trim()
      : "";

  if (!code || !token) {
    return null;
  }

  return { code, token };
}

export async function isTrackerAccessEnabled() {
  return Boolean(await getAccessConfig());
}

export async function hasTrackerAccess(request: NextRequest) {
  const config = await getAccessConfig();
  if (!config) {
    return true;
  }

  return request.cookies.get(ACCESS_COOKIE)?.value === config.token;
}

export async function requireTrackerAccess(request: NextRequest) {
  if (await hasTrackerAccess(request)) {
    return null;
  }

  return NextResponse.json(
    { error: "This baby tracker is private. Enter the family access code." },
    { status: 401 },
  );
}

export async function unlockTracker(request: NextRequest) {
  const config = await getAccessConfig();
  if (!config) {
    return NextResponse.json({ ok: true, locked: false });
  }

  const body = await request.json().catch(() => ({}));
  const submittedCode = typeof body.code === "string" ? body.code.trim() : "";
  if (submittedCode !== config.code) {
    return NextResponse.json(
      { error: "That code did not match. Try again." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true, locked: false });
  response.cookies.set(ACCESS_COOKIE, config.token, {
    httpOnly: true,
    maxAge: THIRTY_DAYS,
    path: "/",
    sameSite: "lax",
    secure: true,
  });

  return response;
}

export async function lockTracker() {
  const response = NextResponse.json({ ok: true, locked: true });
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: true,
  });

  return response;
}
