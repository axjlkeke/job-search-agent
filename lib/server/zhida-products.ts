import { getServerIntegrationConfig } from "./config.ts";

const PRODUCT_REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_GRANT_LEVELS = new Set(["normal", "vip", "svip"]);

export type ZhidaProductFeature = {
  title: string;
  description: string | null;
};

export type NormalizedZhidaProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  grantLevel: "normal" | "vip" | "svip";
  monthlyPrice: string | null;
  quarterlyPrice: string | null;
  yearlyPrice: string | null;
  lifetimePrice: string | null;
  features: ZhidaProductFeature[];
  highlights: string[];
  isRecommended: boolean;
  purchaseUrl: string;
};

export type ZhidaProductsResult = {
  products: NormalizedZhidaProduct[];
  fetchedAt: string;
  ownership: "requires_login";
};

export class ZhidaProductsUnavailableError extends Error {
  readonly code = "ZHIDA_PRODUCTS_UNAVAILABLE";

  constructor() {
    super("在线服务目录暂时不可用，请稍后重试。");
    this.name = "ZhidaProductsUnavailableError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizePrice(value: unknown): string | null {
  const text = normalizeText(value, 24);
  if (!text || !/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  return text;
}

function normalizeTextList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const values = value
    .map((item) => normalizeText(item, 120))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(values)).slice(0, maxItems);
}

function normalizeFeatures(value: unknown): ZhidaProductFeature[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const feature = asRecord(entry);
      const title = normalizeText(feature?.title, 120);
      if (!title) return null;
      return {
        title,
        description: normalizeText(feature?.description, 300),
      };
    })
    .filter((feature): feature is ZhidaProductFeature => feature !== null)
    .slice(0, 20);
}

export function normalizeZhidaProduct(
  value: unknown,
): NormalizedZhidaProduct | null {
  const product = asRecord(value);
  if (!product) return null;

  const id = normalizeText(product.id, 64);
  const name = normalizeText(product.name, 100);
  const slug = normalizeText(product.slug, 50);
  const grantLevel = normalizeText(product.grantLevel, 20);

  if (
    !id ||
    !name ||
    !slug ||
    !/^[a-z0-9-]+$/.test(slug) ||
    !grantLevel ||
    !ALLOWED_GRANT_LEVELS.has(grantLevel)
  ) {
    return null;
  }

  return {
    id,
    name,
    slug,
    description: normalizeText(product.description, 600),
    grantLevel: grantLevel as "normal" | "vip" | "svip",
    monthlyPrice: normalizePrice(product.monthlyPrice),
    quarterlyPrice: normalizePrice(product.quarterlyPrice),
    yearlyPrice: normalizePrice(product.yearlyPrice),
    lifetimePrice: normalizePrice(product.lifetimePrice),
    features: normalizeFeatures(product.features),
    highlights: normalizeTextList(product.highlights, 12),
    isRecommended: product.isRecommended === true,
    purchaseUrl: `https://www.zhidasihai.cn/pricing/${encodeURIComponent(slug)}`,
  };
}

function extractTrpcJson(payload: unknown): unknown {
  const envelope = Array.isArray(payload) ? payload[0] : payload;
  const root = asRecord(envelope);
  if (!root || root.error) return null;

  const result = asRecord(root.result);
  const data = result?.data;
  const dataRecord = asRecord(data);
  return dataRecord && "json" in dataRecord ? dataRecord.json : data;
}

export async function fetchZhidaProducts(): Promise<ZhidaProductsResult> {
  const config = getServerIntegrationConfig();
  if (!config.zhidaTrpcUrl) throw new ZhidaProductsUnavailableError();

  const endpoint = new URL(
    `${config.zhidaTrpcUrl.replace(/\/$/, "")}/product.list`,
  );
  endpoint.searchParams.set("input", JSON.stringify({ json: null }));

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PRODUCT_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new ZhidaProductsUnavailableError();

    const payload: unknown = await response.json();
    const json = extractTrpcJson(payload);
    if (!Array.isArray(json)) throw new ZhidaProductsUnavailableError();

    const products = json
      .map(normalizeZhidaProduct)
      .filter((product): product is NormalizedZhidaProduct => product !== null);

    return {
      products,
      fetchedAt: new Date().toISOString(),
      ownership: "requires_login",
    };
  } catch (error) {
    if (error instanceof ZhidaProductsUnavailableError) throw error;
    throw new ZhidaProductsUnavailableError();
  }
}
