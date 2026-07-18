import {
  fetchZhidaProducts,
  ZhidaProductsUnavailableError,
} from "@/lib/server/zhida-products";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(): Promise<Response> {
  try {
    const result = await fetchZhidaProducts();
    return Response.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const unavailable =
      error instanceof ZhidaProductsUnavailableError
        ? error
        : new ZhidaProductsUnavailableError();

    return Response.json(
      {
        error: {
          code: unavailable.code,
          message: unavailable.message,
          retryable: true,
        },
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
