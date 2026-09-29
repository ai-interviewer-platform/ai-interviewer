export function evaluate(run) {
  const judgments = [], coverage = [];
  for (const source of run.sources) {
    const references = new Map((source.corrections ?? []).map(item => [item.field, item]));
    for (const [field, reference] of references) {
      const model = source.classification?.answers[field];
      judgments.push({ sourceId: source.id, title: source.title, field, model: model?.choice ?? model?.score ?? null,
        reference: reference.choice ?? reference.score, agrees: reference.agreesWithModel, reviewer: reference.reviewer, reason: reference.reason, createdAt: reference.createdAt });
    }
    coverage.push({ sourceId: source.id, title: source.title, url: source.url, provenance: source.provenance,
      status: source.status, visual: source.evidence?.coverage ?? 'unavailable', speech: source.evidence?.speech?.status ?? 'unavailable',
      gaps: source.evidence?.gaps ?? [], error: source.error ?? null, observedMetrics: source.observedMetrics,
      timings: source.timings, visionUsage: source.evidence?.usage ?? source.evidence?.segments?.map(item => item.usage) ?? null,
      classificationUsage: source.classification?.usage ?? null, billing: source.classification?.billing ?? null,
      models: { vision: source.evidence?.model, judgment: source.classification?.model, taxonomy: source.classification?.taxonomyVersion } });
  }
  return { runId: run.id, query: run.query, queryMode: run.queryMode, sourceCount: run.sources.length,
    createdAt: run.createdAt, finishedAt: run.finishedAt, discoveryCost: run.discovery?.cost ?? null,
    referenceCount: judgments.length, agreements: judgments.filter(item => item.agrees).length,
    disagreements: judgments.filter(item => !item.agrees).length, judgments, coverage,
    interpretation: 'Latest reference per field; references are reviewer judgments, not ground truth. No quality threshold or conversion inference.' };
}
