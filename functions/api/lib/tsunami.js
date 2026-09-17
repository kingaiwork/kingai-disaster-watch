const timestamp = (value) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
};

const isFresh = (value, hours, nowMs = Date.now()) => {
  const ms = timestamp(value);
  return ms != null && ms <= nowMs + 5 * 60 * 1000 && nowMs - ms <= hours * 3600 * 1000;
};

export function tsunamiLevel(category='') {
  const c = String(category || '').trim().toUpperCase();
  if (c.includes('WARNING')) return ['WARNING', 96];
  if (c.includes('ADVISORY')) return ['ADVISORY', 72];
  if (c.includes('WATCH')) return ['WATCH', 55];
  if (c.includes('CANCELLATION') || c.includes('CANCEL')) return ['CANCELLATION', 0];
  if (c.includes('INFORMATION')) return ['INFORMATION', 12];
  return ['MESSAGE', 8];
}

function textTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m
    ? m[1]
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<br\s*\/?\s*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function decodeXml(s='') {
  return s
    .replaceAll('&amp;','&')
    .replaceAll('&lt;','<')
    .replaceAll('&gt;','>')
    .replaceAll('&quot;','"')
    .replaceAll('&#39;',"'");
}

export function categoryFromSummary(summary='') {
  const m = String(summary).match(/Category:\s*(Warning|Advisory|Watch|Cancellation|Information)/i);
  return m ? m[1] : '';
}

export function parseAtom(xml, center, nowMs = Date.now()) {
  const entries = [...String(xml).matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].slice(0, 20).map(m => {
    const block = m[0];
    const title = decodeXml(textTag(block, 'title'));
    const updated = textTag(block, 'updated');
    const summary = decodeXml(textTag(block, 'summary'));
    const category = categoryFromSummary(summary);
    const link = block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || '';
    const [level, score] = tsunamiLevel(category || summary || title);
    const ms = timestamp(updated);
    const ageSeconds = ms == null ? null : Math.max(0, Math.round((nowMs - ms) / 1000));
    return {
      center,
      title,
      category: category || level,
      updated,
      ageSeconds,
      link,
      level,
      score,
      fresh24h: isFresh(updated, 24, nowMs)
    };
  });
  return entries;
}
