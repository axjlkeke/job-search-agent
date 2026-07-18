import {
  fetchZhidaJobs,
  ZhidaJobsUnavailableError,
  type ZhidaJobFilters,
} from "@/lib/server/zhida-jobs";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

class InvalidFilterError extends Error {}

function readFilter(
  searchParams: URLSearchParams,
  name: keyof ZhidaJobFilters,
): string | undefined {
  const raw = searchParams.get(name);
  if (raw === null) return undefined;

  const value = raw.trim();
  if (!value || value.length > 80 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new InvalidFilterError();
  }
  return value;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const searchParams = new URL(request.url).searchParams;
    const filters: ZhidaJobFilters = {
      keyword: readFilter(searchParams, "keyword"),
      company: readFilter(searchParams, "company"),
      majorCode: readFilter(searchParams, "majorCode"),
      educationLevel: readFilter(searchParams, "educationLevel"),
      graduationYear: readFilter(searchParams, "graduationYear"),
      city: readFilter(searchParams, "city"),
    };

    const result = await fetchZhidaJobs(filters, {
      pageSize: filters.majorCode ? 100 : 50,
    });
    return Response.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof InvalidFilterError) {
      return Response.json(
        {
          error: {
            code: "INVALID_FILTER",
            message: "筛选条件格式不正确。",
            retryable: false,
          },
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const unavailable =
      error instanceof ZhidaJobsUnavailableError
        ? error
        : new ZhidaJobsUnavailableError();

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
