const ASSETS = {
  earth: {
    urls: [
      'https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/pia18/pia18033/PIA18033.jpg?w=2048&h=2048&fit=clip&crop=faces%2Cfocalpoint',
      'https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA18033.jpg'
    ],
    source: 'NASA / JPL / Suomi NPP VIIRS'
  },
  earthquake: {
    urls: [
      'https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/styles/full_width/public/thumbnails/image/cpnm23.jpg?itok=S_ZoCjyD'
    ],
    source: 'USGS'
  },
  tsunami: {
    urls: [
      'https://upload.wikimedia.org/wikipedia/commons/8/84/2011_tsunami_wave_height.jpg'
    ],
    source: 'NOAA public domain / Wikimedia Commons mirror'
  },
  volcano: {
    urls: [
      'https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/styles/full_width/public/thumbnails/image/IMG_7351.JPG?itok=kLQkMYWQ'
    ],
    source: 'USGS'
  },
  tornado: {
    urls: [
      'https://upload.wikimedia.org/wikipedia/commons/3/3f/Dop_binger_tornado.jpg'
    ],
    source: 'NOAA NSSL public domain / Wikimedia Commons mirror'
  }
};

async function fetchFirst(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'KINGAI-Disaster-Watch/1.0',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });
      const type = response.headers.get('Content-Type') || '';
      if (response.ok && type.toLowerCase().startsWith('image/')) return response;
    } catch (_) {}
  }
  return null;
}

export async function onRequest(context) {
  const key = String(context.params.asset || '').toLowerCase();
  const asset = ASSETS[key];
  if (!asset) return new Response('Not found', { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(context.request.url), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetchFirst(asset.urls);
  if (!upstream) {
    return new Response('Asset upstream unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  headers.set('X-Asset-Source', asset.source);
  headers.set('X-Content-Type-Options', 'nosniff');

  const response = new Response(upstream.body, { status: 200, headers });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
