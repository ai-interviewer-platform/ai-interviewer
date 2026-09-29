const models = { gemini: 'gemini-embedding-2', tongyi: 'tongyi-embedding-vision-plus' };

export function alibabaHost(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Configure an Alibaba HTTPS host'); }
  const validHost = ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'cn-hongkong.dashscope.aliyuncs.com'].includes(url.hostname)
    || /^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname);
  if (!validHost || url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Configure an Alibaba HTTPS host without path, credentials or query');
  }
  return url.origin;
}

function validateInput(provider, input, purpose) {
  if (!['document', 'query'].includes(purpose)) throw new Error('Unsupported embedding purpose');
  if (!input || !['text', 'image', 'video'].includes(input.modality)) throw new Error('Unsupported modality; use text, image or video');
  if (input.modality === 'text') {
    if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('Text is required');
    return;
  }
  if (provider === 'tongyi' && input.modality === 'video') {
    let url;
    try { url = new URL(input.url); } catch { throw new Error('Tongyi requires a public HTTPS video URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || input.data) throw new Error('Tongyi requires a public HTTPS video URL');
    return;
  }
  if (typeof input.data !== 'string' || !input.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)
      || typeof input.mimeType !== 'string' || !input.mimeType.startsWith(`${input.modality}/`)) {
    throw new Error('Media requires base64 data and a matching MIME type');
  }
}

function geminiRequest(input, purpose) {
  const part = input.modality === 'text'
    ? { text: purpose === 'query' ? `task: search result | query: ${input.text}` : `title: ${input.title ?? ''} | text: ${input.text}` }
    : { inline_data: { mime_type: input.mimeType, data: input.data } };
  return { model: `models/${models.gemini}`, content: { parts: [part] } };
}

function tongyiRequest(input) {
  const value = input.modality === 'text' ? input.text
    : input.data ? `data:${input.mimeType};base64,${input.data}` : input.url;
  return { model: models.tongyi, input: { contents: [{ [input.modality]: value }] } };
}

// One media item per call keeps both providers' independent vectors comparable
// within their own spaces. This interface never promises cross-model similarity.
export async function embed({ provider, input, purpose = 'document', env = process.env, fetch: request = globalThis.fetch, signal }) {
  if (!Object.hasOwn(models, provider)) throw new Error('Unsupported embedding provider');
  const prefix = provider === 'gemini' ? 'GEMINI' : 'DASHSCOPE';
  if (!env[`${prefix}_API_KEY`]) throw new Error(`Missing ${prefix}_API_KEY`);
  if (env[`${prefix}_COVERED_USAGE_CONFIRMED`] !== 'true') throw new Error(`Confirm covered usage for ${prefix} before calling`);
  const host = provider === 'tongyi' ? alibabaHost(env.DASHSCOPE_BASE_URL) : null;
  validateInput(provider, input, purpose);
  const url = provider === 'gemini'
    ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent'
    : `${host}/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding`;
  const started = performance.now();
  let response;
  try {
    response = await request(url, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(provider === 'gemini' ? { 'x-goog-api-key': env.GEMINI_API_KEY } : { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}` }) },
      body: JSON.stringify(provider === 'gemini' ? geminiRequest(input, purpose) : tongyiRequest(input)),
    });
  } catch {
    throw new Error(signal?.aborted ? 'Embedding cancelled' : 'Embedding transport failed');
  }
  if (!response.ok) throw new Error(`Embedding ${provider} HTTP ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Embedding response is not valid JSON'); }
  const vector = provider === 'gemini' ? data.embedding?.values : data.output?.embeddings?.find(item => item.index === 0)?.embedding;
  if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite) || !vector.some(value => value !== 0)) {
    throw new Error('Embedding response has no usable vector');
  }
  return {
    provider, model: models[provider], dimensions: vector.length, modality: input.modality,
    encodingVersion: 'independent-retrieval-v1', vector, usage: data.usageMetadata ?? data.usage ?? null,
    elapsedMs: performance.now() - started, createdAt: new Date().toISOString(),
  };
}
