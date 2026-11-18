interface Env {
  API_URL: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);

    if (incoming.pathname.startsWith("/api/")) {
      const target = new URL(incoming.pathname + incoming.search, env.API_URL);
      const headers = new Headers(request.headers);
      headers.delete("host");

      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : request.body,
        redirect: "manual",
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      responseHeaders.delete("set-cookie");

      for (const cookie of upstream.headers.getSetCookie()) {
        responseHeaders.append("set-cookie", cookie);
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
