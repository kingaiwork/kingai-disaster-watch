const ORIGIN = 'https://kingai-disaster-watch.pages.dev';

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, ORIGIN);

    const headers = new Headers(request.headers);
    headers.set('x-kingai-edge-host', incoming.hostname);
    headers.set('x-forwarded-host', incoming.hostname);

    const upstreamRequest = new Request(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual'
    });

    const upstream = await fetch(upstreamRequest);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('x-kingai-origin', 'cloudflare-pages');
    responseHeaders.set('x-kingai-edge', 'hazard-pages-edge');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
