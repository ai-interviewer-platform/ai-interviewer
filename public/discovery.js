import { exercises } from './model.js';

export function homeScreen(state, route, ui) {
  if (!state.historyDeleted && route.params.get('state') !== 'empty') return homeV2Screen(state, ui);
  const { link, button, icon, badge } = ui;
  const stages = ['Attempt saved', 'Review the evidence', 'Try it differently'];
  return `<div class="home-heading"><div><p class="eyebrow">Your practice / A fresh start</p><h1>Make this your starting point.</h1></div></div>
  <div class="home-layout">
    <section class="focus-work" aria-labelledby="focus-title"><div class="focus-top"><span class="eyebrow">Begin here</span>${badge('No activity yet', 'accent')}</div><div class="focus-body"><p class="small">Get to know the workspace</p><h2 id="focus-title">Try the flow.<br>Find your footing.</h2><div class="actions">${link('Try a guided sample', 'sample', 'primary', 'arrow')}${link('Start my interview', 'setup', 'quiet')}</div></div><div class="focus-bottom">${icon('flag')}<span>The guided sample never counts toward personal activity.</span></div></section>
    <section class="practice-thread" aria-labelledby="thread-title"><div class="section-heading"><h2 id="thread-title">Your practice thread</h2><span class="small muted">Not started</span></div><div class="stage-track segmented" role="group" aria-label="Attempt stages" data-stage="1">${['Attempt', 'Review', 'Retry'].map((label, index) => button(label, `thread-stage-${index}`, index === 1 ? 'selected' : '').replace('type="button"', `type="button" aria-pressed="${index === 1}"`)).join('')}</div><ol class="thread-steps">${stages.map((stage, index) => `<li class=""><span class="thread-marker" aria-hidden="true">${index + 1}</span><div><h3>${stage}</h3><p>Not started</p><span class="small muted">Not started</span></div></li>`).join('')}</ol></section>
    <section class="home-history" aria-labelledby="history-title"><div class="section-heading"><h2 id="history-title">Recent activity</h2>${link('All sessions', 'sessions', 'quiet small', 'arrow')}</div><p class="empty-inline">No activity yet.</p></section>
    <section class="home-route" aria-labelledby="route-title"><div class="section-heading"><h2 id="route-title">Your learning path</h2>${link('Open roadmap', 'roadmap', 'quiet small', 'map')}</div><div class="path-preview"><span>Sequences</span><span aria-hidden="true">→</span><a href="#roadmap?topic=sets">Maps & sets ${icon('expand')}</a><span aria-hidden="true">→</span><span>Repeated values</span></div></section>
  </div><div class="home-bottom"><span>Fictional profile and activity · nothing here measures mastery</span>${link(state.sampleRoute !== 'sample' ? 'Resume the guided sample' : 'Explore the guided sample', state.sampleRoute, 'quiet small')}${link('Example review', 'review?source=sample', 'quiet small')}</div>`;
}

export { roadmapScreen, getPracticeLeaf, problemDrawer } from './roadmap.js';

// Layout and fixture values from the supplied Home v2 design.
function designValues(state) {
    const cur = state.homeStage ?? (state.retry ? 2 : 1);
    const labels = ['Attempt', 'Review', 'Retry'];
    const stages = labels.map((label, i) => ({
      label, done: i < cur, current: i === cur ? 'step' : undefined,
      action: `thread-stage-${i}`,
      color: i === cur ? 'var(--ink)' : i < cur ? 'var(--ink-2)' : 'var(--ink-3)',
      bg: i === cur ? 'linear-gradient(180deg,var(--raised-lit),var(--raised))' : 'transparent',
      shadow: i === cur ? 'var(--ring), var(--light-top), var(--shadow-contact)' : 'none',
    }));
    const stepData = [
      { title: 'Attempt saved', detail: 'First repeated tag · prepared code, text transcript · today 10:42' },
      { title: 'Review the evidence', detail: 'One finding at checkpoint 04:26 · limitation stated' },
      { title: 'Try it differently', detail: 'Fresh Coach practice from the saved checkpoint, when you’re ready' },
    ];
    // Node map. Positions are percentages of the recess pane.
    const P = { x: 13, y: 40 }, S = { x: 38, y: 24 }, M = { x: 60, y: 52 }, R = { x: 85, y: 22 }, B = { x: 30, y: 70 };
    const solid = 'oklch(1 0 0 / 0.22)', faint = 'oklch(1 0 0 / 0.14)';
    const edges = [
      { a: P, b: S, stroke: solid, dash: '0' },
      { a: S, b: M, stroke: 'var(--accent)', dash: '0' },
      { a: M, b: R, stroke: faint, dash: '3 4' },
      { a: S, b: B, stroke: faint, dash: '3 4' },
    ].map(e => ({ x1: e.a.x, y1: e.a.y, x2: e.b.x, y2: e.b.y, stroke: e.stroke, dash: e.dash }));
    const shape = { circle: { clip: 'none', radius: '50%' }, diamond: { clip: 'polygon(50% 0,100% 50%,50% 100%,0 50%)', radius: '0' }, hex: { clip: 'polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%)', radius: '0' }, tri: { clip: 'polygon(50% 4%,100% 96%,0 96%)', radius: '0' }, penta: { clip: 'polygon(50% 2%,98% 38%,80% 96%,20% 96%,2% 38%)', radius: '0' } };
    const node = (pos, label, count, kind, state, extra = {}) => {
      const s = shape[kind];
      const done = state === 'done', current = state === 'current';
      return { x: pos.x + '%', y: pos.y + '%', href: ({ 'Sequences': '#roadmap?topic=sequences', 'Maps & sets': '#roadmap?topic=sets', 'Repeated values': '#roadmap?topic=sets&leaf=seen' }[label] || '#roadmap'), label, count, hint: `${label} · ${count}`,
        size: current ? '30px' : '24px', clip: s.clip, radius: s.radius,
        fill: done ? 'var(--ink-2)' : current ? 'var(--accent)' : 'var(--ink-3)',
        inset: (done || current) ? '0' : '1.5px', innerFill: (done || current) ? 'transparent' : 'var(--recess)',
        glow: current ? '0 0 0 6px var(--accent-soft), 0 0 24px var(--accent-soft)' : 'none',
        mark: done ? '✓' : current ? '' : extra.mark ?? '', markColor: done ? 'var(--ground)' : 'var(--ink-3)',
        color: current ? 'var(--ink)' : done ? 'var(--ink-2)' : 'var(--ink-3)' };
    };
    const nodes = [
      node(P, 'Sequences', '6 problems', 'circle', 'done'),
      node(S, 'Maps & sets', '4 problems · in review', 'diamond', 'current'),
      node(M, 'Repeated values', '5 problems', 'hex', 'next', { mark: '5' }),
      node(R, 'Two pointers', '7 problems', 'tri', 'later'),
      node(B, 'Bonus · Strings', '3 problems', 'penta', 'later', { mark: '3' }),
    ];
    return {
      stages, stageCount: `${cur + 1} / 3`, stageTitle: stepData[cur].title, stageDetail: stepData[cur].detail,
      edges, nodes,
      activity: [
        { href: '#review', title: 'First repeated tag', status: 'Review ready · 1 finding', dot: 'var(--accent)', when: 'Today 10:42' },
        { href: '#interview?problem=alert', title: 'First threshold alert', status: 'Draft saved', dot: 'var(--ink-3)', when: 'Yesterday' },
        { href: '#review?state=pending&problem=runs', title: 'First consecutive pair', status: 'Review pending', dot: 'var(--pending)', when: 'Sep 11' },
      ],
    };
}

function homeV2Screen(state, ui) {
  const { esc } = ui;
  const { stages, stageCount, stageTitle, stageDetail, edges, nodes, activity } = designValues(state);
  const name = state.profile?.name || 'Alex';
  const retry = state.retry?.problem === state.personal.problem ? state.retry : null;
  const draft = retry?.draft || state.personal.draft;
  const actionPath = retry?.draft ? 'retry' : state.personal.draft ? 'interview' : retry?.finished ? 'related' : 'review';
  const actionLabel = draft ? 'Continue your interview' : retry?.finished ? 'Explore related practice' : 'Open your review';
  const status = draft ? 'DRAFT SAVED' : 'REVIEW READY';
  const headline = draft ? 'You can start where you left off.' : retry?.finished ? 'Carry the idea into a new problem.' : 'You found the match. What happened next?';
  activity[0] = { ...activity[0], title: exercises[state.personal.problem].title, href: state.personal.draft ? '#interview' : '#review', status: state.personal.draft ? 'Draft saved' : 'Review ready · 1 finding' };
  return `<div class="v2-home-1 v2-screen v2-home">
    <div class="v2-home-2 enter">
      <div>
        <p class="v2-home-3">Monday · Sep 15</p>
        <h1 class="v2-home-4">Welcome back, ${esc(name ?? '')}.</h1>
      </div>
      <div class="v2-home-5"><span class="v2-home-6"></span>Internship preparation · Python</div>
    </div>

    <a href="#${esc(actionPath ?? '')}" class="v2-home-7 enter" aria-labelledby="focus-title">
      <div aria-hidden="true" class="v2-home-8">
        <div class="v2-home-9"></div>
        <div class="v2-home-10">
          <div class="v2-home-11"><span>first_repeated_tag.py</span><span>04:26</span></div>
          <pre class="v2-home-12"><span class="v2-home-13"><span class="v2-home-14">4</span><span class="v2-home-15">    <span class="v2-home-16">if</span> tag <span class="v2-home-17">in</span> seen:</span></span><span class="v2-home-18 annotation"><span class="v2-home-19">5</span><span class="v2-home-20">        answer = index</span></span><span class="v2-home-21"><span class="v2-home-22">6</span><span class="v2-home-23">    seen.add(tag)</span></span></pre>
        </div>
      </div>
      <div class="v2-home-24">
        <p class="v2-home-25"><span><span class="v2-home-26">Maps &amp; sets</span> / First repeated tag</span><span class="v2-home-27">${esc(status ?? '')}</span></p>
        <h2 id="focus-title" class="v2-home-28">${esc(headline ?? '')}</h2>
        <p class="v2-home-29">You described stopping at the first match. The saved code keeps scanning and overwrites the answer. One finding at checkpoint 04:26, evidence attached.</p>
        <div class="v2-home-30">
          <span class="v2-home-31 pressable">${esc(actionLabel ?? '')}<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12m-5-5 5 5-5 5"></path></svg></span>
          <span class="v2-home-32">Saved today 10:42 · text · mock</span>
        </div>
      </div>
    </a>

    <div class="v2-home-33">
      <section class="v2-home-34 enter" aria-labelledby="route-title">
        <div class="v2-home-35">
          <span aria-hidden="true" class="v2-home-36"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h5v5H2zM13 3h5v5h-5zM13 12h5v5h-5zM7 10h3V5.5h3M10 10v4.5h3"></path></svg></span>
          <h2 id="route-title" class="v2-home-37">Your learning path</h2>
          <span class="v2-home-38"><span class="v2-home-39"></span>done<span class="v2-home-40"></span>suggested, not locked</span>
          <a href="#roadmap" class="v2-home-41">Open roadmap<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12m-5-5 5 5-5 5"></path></svg></a>
        </div>
        <div class="v2-map-scroll" tabindex="0" role="region" aria-label="Learning path"><div class="v2-home-42">
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" class="v2-home-43">
            ${edges.map((e) => `
              <line x1="${esc(e.x1 ?? '')}" y1="${esc(e.y1 ?? '')}" x2="${esc(e.x2 ?? '')}" y2="${esc(e.y2 ?? '')}" stroke="${esc(e.stroke ?? '')}" stroke-width="1.25" stroke-dasharray="${esc(e.dash ?? '')}" vector-effect="non-scaling-stroke"></line>
            `).join('')}
          </svg>
          ${nodes.map((n) => `
            <a href="${esc(n.href ?? '')}" title="${esc(n.hint ?? '')}" style="position:absolute;left:${esc(n.x ?? '')};top:${esc(n.y ?? '')};transform:translate(-50%,-50%);display:grid;place-items:center;width:40px;height:40px;border-radius:50%;color:${esc(n.color ?? '')}" class="v2-home-44">
              <span aria-hidden="true" style="position:relative;width:${esc(n.size ?? '')};height:${esc(n.size ?? '')};clip-path:${esc(n.clip ?? '')};border-radius:${esc(n.radius ?? '')};background:${esc(n.fill ?? '')};box-shadow:${esc(n.glow ?? '')};display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;font-weight:600;color:${esc(n.markColor ?? '')}" class="v2-home-45"><span style="position:absolute;inset:${esc(n.inset ?? '')};clip-path:${esc(n.clip ?? '')};border-radius:${esc(n.radius ?? '')};background:${esc(n.innerFill ?? '')}" class="v2-home-46"></span><span class="v2-home-47">${esc(n.mark ?? '')}</span></span>
              <span class="v2-home-48"><span class="v2-home-49">${esc(n.label ?? '')}</span><span class="v2-home-50">${esc(n.count ?? '')}</span></span>
            </a>
          `).join('')}
        </div></div>
      </section>

      <div class="v2-home-51">
        <section class="v2-home-52 enter" aria-labelledby="thread-title">
          <div class="v2-home-53">
            <h2 id="thread-title" class="v2-home-54">This attempt</h2>
            <span class="v2-home-55">${esc(stageCount ?? '')}</span>
          </div>
          <div role="group" aria-label="Attempt stages" class="v2-home-56">
            ${stages.map((s) => `
              <button type="button" aria-current="${esc(s.current ?? 'false')}" aria-pressed="${s.current === 'step'}" data-action="${esc(s.action ?? '')}" class="v2-home-57 pressable" style="min-height:32px;border:0;border-radius:6px;font-size:12px;font-weight:600;color:${esc(s.color ?? '')};background:${esc(s.bg ?? '')};box-shadow:${esc(s.shadow ?? '')};display:inline-flex;align-items:center;justify-content:center;gap:6px">${s.done ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m4 10 4 4 8-8"></path></svg>` : ''}${esc(s.label ?? '')}</button>
            `).join('')}
          </div>
          <p class="v2-home-58"><span class="v2-home-59">${esc(stageTitle ?? '')}</span> · ${esc(stageDetail ?? '')}</p>
        </section>

        <section class="v2-home-60 enter" aria-labelledby="history-title">
          <div class="v2-home-61">
            <h2 id="history-title" class="v2-home-62">Recent</h2>
            <a href="#sessions" class="v2-home-63">All sessions</a>
          </div>
          <div class="v2-home-64">
            ${activity.map((a) => `
              <a href="${esc(a.href ?? '')}" class="v2-home-65">
                <span title="${esc(a.title ?? '')}" class="v2-home-66">${esc(a.title ?? '')}</span>
                <span class="v2-home-67">${esc(a.when ?? '')}</span>
                <span class="v2-home-68"><span style="width:6px;height:6px;border-radius:50%;background:${esc(a.dot ?? '')}" class="v2-home-69"></span>${esc(a.status ?? '')}</span>
              </a>
            `).join('')}
          </div>
        </section>
      </div>
    </div>
    <div class="v2-home-70 enter">
      <span class="v2-home-71">Fictional profile and activity · nothing here measures mastery</span>
      <a href="#sample" class="v2-home-72">Explore the guided sample</a>
      <a href="#setup" class="v2-home-73">New interview</a>
    </div>
  </div>`;
}
