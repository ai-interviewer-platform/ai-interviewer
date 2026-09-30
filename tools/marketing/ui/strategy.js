export function strategyView({ el, node, api, action, exportJSON, inspect, showView }) {
  const picked = new Set();
  let selectedDraft;
  const list = value => Array.isArray(value) ? value.filter(item => item !== null) : [];
  function field(form, label, name, value = '') {
    const id = `brief-${name}`, input = node('textarea'); input.id = id; input.name = name; input.value = value; input.required = true;
    const title = node('label', label); title.htmlFor = id; form.append(title, input); return input;
  }
  async function cloudStatus() {
    const status = await api('/api/cloud');
    el('cloud-status').textContent = status.status === 'saved' ? `Last cloud sync verified · ${status.verified} files · ${status.verifiedAt}`
      : status.status === 'pending' ? `Cloud archive pending · ${status.error ?? 'No sync receipt yet'}. Local records retained.` : 'Local records · cloud archive not configured';
  }
  function renderDraft(draft) {
    selectedDraft = draft.id;
    const root = el('strategy-detail'), proposal = draft.proposal ?? {};
    root.replaceChildren(node('h3', proposal.title || 'Rejected proposal'), node('p', `${draft.status} · CTA / distribution: ${draft.distributionStatus}`, 'brief-state'));
    root.append(node('p', 'Export is a review artifact. This tool cannot publish. Model audits can miss errors; review every claim and source before approval.', 'muted'));
    for (const problem of draft.problems) root.append(node('p', problem));
    root.append(node('h3', 'Product proof'));
    for (const fact of Object.values(draft.facts)) root.append(node('p', `${fact.text} — ${fact.proof}`));
    root.append(node('h3', 'Observed evidence'));
    for (const evidence of draft.evidence) {
      const row = node('details'); row.append(node('summary', `${evidence.id} · ${evidence.title}`), node('p', evidence.observation.description ?? evidence.observation.text), node('p', JSON.stringify(evidence.observation), 'muted'), node('p', `${evidence.coverage} · ${evidence.gaps.join(' · ')}`, 'muted'));
      if (evidence.url) { const link = node('a', 'Open original source'); link.href = evidence.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); }
      row.append(action('Inspect saved evidence', async () => { const runs = await api('/api/runs'), run = runs.find(item => item.id === evidence.runId); if (!run) throw new Error('Current run unavailable; the observation snapshot remains in this brief'); inspect(run, false, evidence.sourceId); }));
      root.append(row);
    }
    root.append(node('h3', 'Hypotheses'));
    for (const hypothesis of list(proposal.hypotheses)) root.append(node('p', `${hypothesis.text} [${list(hypothesis.evidenceIds).join(', ')}]`));
    for (const [label, value] of [['Audience need', proposal.audienceNeed], ['Positioning', proposal.positioning], ['Proposed format', proposal.format], ['Proposed channel', proposal.channel], ['Proposed CTA', proposal.cta], ['Proposed launch action', proposal.launchAction], ['Measurement definition', proposal.measurement ? `${proposal.measurement.event} / ${proposal.measurement.denominator}` : 'Missing'], ['Original hook', proposal.hook], ['Creative review notes', proposal.creativeNotes]]) root.append(node('h3', label), node('p', value));
    root.append(node('h3', 'Original script'));
    for (const line of list(proposal.script)) root.append(node('p', `${line.text} [product proof: ${list(line.factIds).join(', ') || 'no factual claim'}]`));
    root.append(node('h3', 'Unresolved assumptions'));
    for (const assumption of list(proposal.assumptions)) root.append(node('p', assumption));
    root.append(action('Export review artifact', () => exportJSON(draft, `${draft.id}-strategy.json`)));
    const review = node('form', undefined, 'brief-form'); review.append(node('h3', 'Human review & owner choices'));
    field(review, 'Reviewer / owner', 'reviewer'); field(review, 'Review rationale', 'rationale');
    field(review, 'Selected production format', 'format', proposal.format).readOnly = true;
    field(review, 'Selected channel', 'channel', proposal.channel).readOnly = true;
    field(review, 'Channel / community access', 'access'); field(review, 'Organic / paid sequencing', 'sequencing');
    const label = node('label', 'Actual landing action'), launch = node('select'); label.htmlFor = 'brief-launchAction'; launch.id = 'brief-launchAction'; launch.name = 'launchAction';
    launch.add(new Option('Choose the owner-selected primary action', '')); launch.add(new Option('Waitlist', 'waitlist')); launch.add(new Option('Personal practice', 'personal_practice')); review.append(label, launch);
    field(review, 'Selected CTA', 'cta', proposal.cta).readOnly = true;
    review.append(node('p', 'Approval verifies the configured landing page’s current primary action. An unchosen action stays proposed. To change format, channel or CTA, generate a new brief.', 'muted'));
    for (const decision of ['approve', 'reject']) { const button = node('button', decision === 'approve' ? 'Approve brief' : 'Reject brief'); button.value = decision; button.formNoValidate = decision === 'reject'; review.append(button); }
    review.onsubmit = async event => {
      event.preventDefault(); const button = event.submitter; button.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(review)), { reviewer, rationale, ...choices } = values;
        await api(`/api/strategy/${draft.id}/review`, { decision: button.value, reviewer, rationale, choices }); await refresh();
      } catch (error) { el('strategy-status').textContent = error.message; } finally { button.disabled = false; }
    };
    root.append(review);
    root.append(node('h3', 'Outcome lineage'), node('p', draft.previousId ? `Revises brief ${draft.previousId} using outcomes ${list(draft.basedOnOutcomes).join(', ') || 'recorded before outcome IDs'}.` : 'A new experiment: no previous brief.'));
    for (const item of list(draft.outcomes).filter(outcome => outcome.aggregate)) {
      root.append(node('p', `${item.aggregate.window.start} – ${item.aggregate.window.end} · ${item.aggregate.landing.documents} landing documents · campaign attribution ${item.attribution.campaign}. ${item.interpretation}`, 'muted'));
      for (const comparison of item.comparisons) root.append(node('p', `${comparison.assessment}: ${comparison.hypothesis} Observed: ${comparison.observed} Feedback: ${comparison.feedback}`));
      root.append(node('p', `Revised recommendation: ${item.recommendation}`), node('p', `Unresolved: ${item.unresolved.join(' · ')}`));
    }
    const outcome = node('form', undefined, 'brief-form'); outcome.append(node('h3', 'Compare outcomes for the next brief'));
    outcome.append(node('p', 'Import the aggregate report downloaded from the Coursay operator page. Only counts enter this tool. Counts are site-wide for the window: Coursay records no campaign attribution, so none is joined to this brief.', 'muted'));
    field(outcome, 'Outcome recorder', 'outcome-reviewer');
    const reportLabel = node('label', 'Coursay aggregate report (JSON)'), report = node('input'); report.type = 'file'; report.accept = 'application/json'; report.id = 'outcome-report'; report.required = true; reportLabel.htmlFor = report.id; outcome.append(reportLabel, report);
    list(proposal.hypotheses).forEach((hypothesis, index) => {
      const group = node('fieldset'); group.append(node('legend', `Hypothesis ${index + 1}: ${hypothesis.text}`)); outcome.append(group);
      field(group, 'Observed in the aggregates', `outcome-observed-${index}`); field(group, 'Self-selected feedback', `outcome-feedback-${index}`);
      const label = node('label', 'Assessment'), assessment = node('select'); assessment.id = `outcome-assessment-${index}`; assessment.name = assessment.id; label.htmlFor = assessment.id; assessment.required = true;
      assessment.add(new Option('Choose an assessment', '')); for (const value of ['consistent', 'inconsistent', 'inconclusive']) assessment.add(new Option(value, value)); group.append(label, assessment);
    });
    field(outcome, 'Revised recommendation', 'outcome-recommendation'); field(outcome, 'Unresolved explanations — one per line', 'outcome-unresolved');
    outcome.append(node('button', 'Save outcome comparison'));
    outcome.onsubmit = async event => {
      event.preventDefault(); event.submitter.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(outcome)), hypotheses = list(proposal.hypotheses);
        let parsed; try { parsed = JSON.parse(await report.files[0].text()); } catch { throw new Error('Choose the JSON report downloaded from the Coursay operator page'); }
        await api(`/api/strategy/${draft.id}/outcomes`, { reviewer: values['outcome-reviewer'], report: parsed, recommendation: values['outcome-recommendation'],
          unresolved: values['outcome-unresolved'].split('\n').map(line => line.trim()).filter(Boolean),
          comparisons: hypotheses.map((_, index) => ({ observed: values[`outcome-observed-${index}`], feedback: values[`outcome-feedback-${index}`], assessment: values[`outcome-assessment-${index}`] })) });
        await refresh();
      } catch (error) { el('strategy-status').textContent = error.message; } finally { event.submitter.disabled = false; }
    };
    root.append(outcome);
    const provenance = node('details'); provenance.append(node('summary', 'Models, claim audit, reviews & outcomes'), node('pre', JSON.stringify(draft, null, 2))); root.append(provenance);
  }
  async function refresh() {
    const [data, runs] = await Promise.all([api('/api/strategy'), api('/api/runs'), cloudStatus()]);
    el('strategy-provider').textContent = `Generative model: ${data.model} · direct Alibaba · independent of Jev. Generation plus a separate claim audit use your configured covered quota.`;
    if (!el('strategy-facts').children.length) for (const [id, fact] of Object.entries(data.productFacts)) { const label = node('label'), input = node('input'); input.type = 'checkbox'; input.name = 'fact'; input.value = id; input.checked = true; label.append(input, document.createTextNode(` ${fact.text}`)); el('strategy-facts').append(label); }
    el('strategy-sources').replaceChildren();
    for (const run of runs.filter(item => item.status !== 'running')) for (const source of run.sources.filter(item => item.evidence)) {
      const label = node('label'), input = node('input'), key = `${run.id}/${source.id}`; input.type = 'checkbox'; input.value = key; input.name = 'source'; input.checked = picked.has(key);
      input.onchange = () => input.checked ? picked.add(key) : picked.delete(key); label.append(input, document.createTextNode(` ${source.title} · ${source.evidence.coverage}`)); el('strategy-sources').append(label);
    }
    if (!el('strategy-sources').children.length) el('strategy-sources').append(node('p', 'Analyze a source or open Library & search first.'));
    const previous = el('strategy-previous').value;
    el('strategy-previous').replaceChildren(new Option('New experiment', ''), ...data.drafts.map(draft => new Option(`${draft.proposal?.title || 'Rejected proposal'} · ${draft.outcomes.length} outcomes`, draft.id))); el('strategy-previous').value = previous;
    const drafts = data.drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    el('strategy-drafts').replaceChildren(node('h3', 'Saved briefs'));
    if (!drafts.length) { el('strategy-drafts').append(node('p', 'Generate a source-linked proposal to review.')); return; }
    const label = node('label', 'Brief to inspect'), select = node('select'); label.htmlFor = 'brief-selector'; select.id = 'brief-selector';
    drafts.forEach(draft => select.add(new Option(`${draft.proposal?.title || 'Rejected proposal'} · ${draft.status}`, draft.id)));
    select.value = drafts.some(draft => draft.id === selectedDraft) ? selectedDraft : drafts[0].id;
    const detail = node('div'); detail.id = 'strategy-detail'; el('strategy-drafts').append(label, select, detail);
    select.onchange = () => renderDraft(drafts.find(draft => draft.id === select.value)); renderDraft(drafts.find(draft => draft.id === select.value));
  }
  el('strategy-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; el('strategy-status').textContent = 'Generating and checking claims…';
    try {
      const result = await api('/api/strategy/generate', { goals: el('strategy-goals').value, audience: el('strategy-audience').value,
        factIds: [...el('strategy-facts').querySelectorAll(':checked')].map(input => input.value),
        sources: [...el('strategy-sources').querySelectorAll(':checked')].map(input => { const [runId, sourceId] = input.value.split('/'); return { runId, sourceId }; }), previousId: el('strategy-previous').value || undefined });
      selectedDraft = result.id; await refresh(); el('strategy-status').textContent = `${result.status} · saved for review`;
    } catch (error) { el('strategy-status').textContent = error.message; } finally { button.disabled = false; }
  };
  return { refresh, cloudStatus, add(source) { picked.add(`${source.runId}/${source.id}`); showView('strategy'); } };
}
