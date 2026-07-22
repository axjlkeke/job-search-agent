import { getPublicIntegrationStatus } from "@/lib/server/config";
import { probeCareerIntelligenceHealth } from "@/lib/server/career-intelligence";
import { isZhidaJobsLive } from "@/lib/server/zhida-jobs";

export const dynamic = "force-dynamic";

const LIVE_STATUS_TTL_MS = 30_000;
let liveStatusCache: { checkedAt: number; value: boolean } | null = null;
let intelligenceStatusCache: {
  checkedAt: number;
  value: Awaited<ReturnType<typeof probeCareerIntelligenceHealth>>;
} | null = null;

async function readLiveStatus(): Promise<boolean> {
  const now = Date.now();
  if (liveStatusCache && now - liveStatusCache.checkedAt < LIVE_STATUS_TTL_MS) {
    return liveStatusCache.value;
  }
  const value = await isZhidaJobsLive();
  liveStatusCache = { checkedAt: now, value };
  return value;
}

async function readIntelligenceStatus(): Promise<
  Awaited<ReturnType<typeof probeCareerIntelligenceHealth>>
> {
  const now = Date.now();
  if (
    intelligenceStatusCache &&
    now - intelligenceStatusCache.checkedAt < LIVE_STATUS_TTL_MS
  ) {
    return intelligenceStatusCache.value;
  }
  const value = await probeCareerIntelligenceHealth();
  intelligenceStatusCache = { checkedAt: now, value };
  return value;
}

export async function GET(): Promise<Response> {
  const [
    {
      ragConfigured,
      difyConfigured,
      aiConfigured,
      advisorProtected,
      advisorAccessEnabled,
      zhidaBridgeConfigured,
    },
    zhidaLive,
    intelligenceStatus,
  ] = await Promise.all([
    Promise.resolve(getPublicIntegrationStatus()),
    readLiveStatus(),
    readIntelligenceStatus(),
  ]);

  return Response.json(
    {
      zhidaLive,
      intelligenceLive: intelligenceStatus.live,
      intelligenceCounts: intelligenceStatus.counts,
      ragConfigured,
      difyConfigured,
      aiConfigured,
      advisorProtected,
      advisorAccessEnabled,
      zhidaBridgeConfigured,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=30",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
