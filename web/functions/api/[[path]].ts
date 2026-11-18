
export const onRequest: PagesFunction<{ API_ORIGIN: string }> = async ({
  request,
  env,
  params,
}) => {
  const incoming = new URL(request.url);
  const segments = Array.isArray(params.path) ? params.path : [];
  const target = new URL(`/api/${segments.join("/")}`, env.API_ORIGIN);
  target.search = incoming.search;

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

  // Preserve multiple Set-Cookie headers (login + logout can differ).
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};
