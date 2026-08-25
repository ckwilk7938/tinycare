import { NextRequest } from "next/server";
import { lockTracker, unlockTracker } from "../../tracker-access";

export async function POST(request: NextRequest) {
  return unlockTracker(request);
}

export async function DELETE() {
  return lockTracker();
}
