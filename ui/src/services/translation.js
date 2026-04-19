export async function translateToTarget(text, targetLang) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLang,
    dt: 't',
    q: text,
  });

  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`translation_failed_${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('invalid_translation_payload');
  }

  const translated = data[0]
    .map((part) => (Array.isArray(part) ? part[0] : ''))
    .join('')
    .trim();

  if (!translated) {
    throw new Error('empty_translation');
  }

  return translated;
}
