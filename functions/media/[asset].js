const ASSETS = {
  earth: {
    url: 'https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA18033.jpg',
    source: 'NASA / Suomi NPP VIIRS'
  },
  earthquake: {
    url: 'https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/styles/full_width/public/thumbnails/image/cpnm23.jpg?itok=S_ZoCjyD',
    source: 'USGS'
  },
  tsunami: {
    url: 'https://www.noaa.gov/sites/default/files/styles/square_width_856px_webp/public/legacy/image/2021/Mar/PHOTO-%20Ludington%20meteotsunami%20wave%20over%20breakwaters-04132018-DebbieMaglothin-1500x1000%20.JPG.webp?itok=6G9EPRBH',
    source: 'NOAA'
  },
  volcano: {
    url: 'https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/styles/full_width/public/thumbnails/image/IMG_7351.JPG?itok=kLQkMYWQ',
    source: 'USGS'
  },
  tornado: {
    url: 'https://www.noaa.gov/sites/default/files/styles/landscape_width_1275px_webp/public/2024-07/pl23_con00010.jpg.webp?h=dc7fd145&itok=aKbdccAQ',
    source: 'NOAA'
  }
};

export async function onRequest(context) {
  const key = String(context.params.asset || '').toLowerCase();
  const asset = ASSETS[key];
  if (!asset) return new Response('Not found', { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(context.request.url), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetch(asset.url, {
    headers: {
      'User-Agent': 'KINGAI-Disaster-Watch/1.0',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });
  if (!upstream.ok) {
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
