import { exercises } from './model.js';

// Layout and fixture values from the supplied Profile v2 design.
function designValues(state) {
    const W = 26;
    const at = (w, d) => w * 7 + d;
    const active = new Set(state.historyDeleted ? [] : [at(3,1), at(3,3), at(6,2), at(9,1), at(9,4), at(12,2), at(12,3), at(13,1), at(15,2), at(15,4), at(18,1), at(18,3), at(18,4), at(20,2), at(21,1), at(21,5), at(22,1), at(22,2), at(23,3), at(24,1), at(24,2), at(24,4), at(25,0), at(25,1)]);
    const strong = new Set([at(12,3), at(18,4), at(22,2), at(25,1)]);
    const weeks = Array.from({ length: W }, (_, w) => ({ days: Array.from({ length: 7 }, (_, d) => { const i = at(w, d); const on = active.has(i);
      return { title: on ? 'Prepared practice' : 'No activity',
        bg: on && strong.has(i) ? 'var(--accent)' : on ? 'oklch(from var(--accent) l c h / 0.5)' : 'var(--recess)',
        ring: on ? 'none' : 'var(--shadow-recess)' }; }) }));
    let best = 0, run = 0; for (let i = 0; i < W * 7; i++) { run = active.has(i) ? run + 1 : 0; best = Math.max(best, run); }
    const months = ['Mar','Apr','May','Jun','Jul','Aug','Sep'].map((label, i) => ({ label, col: String(1 + Math.round(i * (W / 7) )) }));
    const shape = { diamond: { clip: 'polygon(50% 0,100% 50%,50% 100%,0 50%)', radius: '0' }, circle: { clip: 'none', radius: '50%' }, hex: { clip: 'polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%)', radius: '0' } };
    const topic = (label, count, pct, kind, fill) => ({ label, count, pct, href: '#roadmap?topic=' + ({ Arrays: 'sequences', Loops: 'flow', Sets: 'sets' }[label]), clip: shape[kind].clip, radius: shape[kind].radius, fill, inset: 'none' });
    return {
      weeks, weekCount: W, months, rangeLabel: `LAST ${W} WEEKS`, activeDays: active.size, bestStreak: `${best} days`,
      stats: [{ k: 'attempts', v: '3', color: 'var(--ink)' }, { k: 'reviews', v: '1', color: 'var(--ink)' }, { k: 'retries', v: '0', color: 'var(--ink-3)' }, { k: 'guided', v: '1', color: 'var(--coach)' }],
      topics: [
        topic('Arrays', '2 attempts · 6 problems', '33%', 'diamond', 'var(--node-yellow)'),
        topic('Loops', '1 attempt · 4 problems', '25%', 'circle', 'var(--node-green)'),
        topic('Sets', '1 attempt · in review', '25%', 'hex', 'var(--accent)'),
      ],
      recent: [
        { href: '#review', title: 'First repeated tag', when: 'Today 10:42', status: 'Review ready · 1 finding', dot: 'var(--accent)' },
        { href: '#interview?problem=alert', title: 'First threshold alert', when: 'Yesterday', status: 'Draft saved', dot: 'var(--ink-3)' },
        { href: '#review?state=pending&problem=runs', title: 'First consecutive pair', when: 'Sep 11', status: 'Review pending', dot: 'var(--pending)' },
      ].map((r, i, a) => { const last = i === a.length - 1; return { ...r, grow: last ? '0 0 auto' : '1 1 auto', pad: last ? '-6px' : '12px', rail: last ? 'none' : 'var(--divider-dashed)' }; }),
    };
}

export function profileScreen(state, ui) {
  const { esc } = ui;
  const { weeks, weekCount, months, rangeLabel, activeDays, bestStreak, stats, topics, recent } = designValues(state);
  const name = state.profile?.name || 'Alex';
  const initial = name.charAt(0).toUpperCase();
  const bio = state.profile?.bio || '';
  if (state.historyDeleted) { stats.forEach(s => { s.v = '0'; }); topics.length = 0; recent.length = 0; }
  else { stats[2].v = state.retry?.finished ? '1' : '0'; recent[0] = { ...recent[0], title: exercises[state.personal.problem].title, href: state.personal.draft ? '#interview' : '#review', status: state.personal.draft ? 'Draft saved' : 'Review ready · 1 finding' }; }
  return `<div class="v2-profile-1 v2-screen v2-profile">
    <header class="v2-profile-2 enter" aria-label="Identity">
      <span aria-hidden="true" class="v2-profile-3">${esc(initial ?? '')}</span>
      <div class="v2-profile-4">
        <h1 class="v2-profile-5">${esc(name ?? '')}</h1>
        <span class="v2-profile-6">Internship preparation · Python</span>
        <span class="v2-profile-7">DEMO</span>
      </div>
      <button type="button" data-action="edit-profile" class="v2-profile-8 pressable">Edit profile</button>
      <div class="v2-profile-9"><dl class="v2-profile-stat-list">
        ${stats.map((s) => `
          <div class="v2-profile-10"><dt class="v2-profile-12">${esc(s.k ?? '')}</dt><dd style="margin:0;font-family:var(--font-mono);font-size:1.25rem;font-weight:500;color:${esc(s.color ?? '')}" class="v2-profile-11">${esc(s.v ?? '')}</dd></div>
        `).join('')}
        </dl><span class="v2-profile-13">Counts, not a readiness score.</span>
      </div>
    </header>${esc(bio ?? '')}

    <div class="v2-profile-14">
      <div class="v2-profile-15">
        <section class="v2-profile-16 enter" aria-labelledby="activity-h">
          <div class="v2-profile-17">
            <span aria-hidden="true" class="v2-profile-18"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h4l2-5 3 10 2-5h3"></path></svg></span>
            <h2 id="activity-h" class="v2-profile-19">Practice activity</h2>
            <span class="v2-profile-20">${esc(rangeLabel ?? '')}</span>
          </div>
          <div class="v2-profile-21">
            <div class="v2-calendar-scroll" tabindex="0" role="region" aria-label="26 weeks of fictional practice activity"><div class="v2-profile-22">
              <div aria-hidden="true" class="v2-profile-23"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
              <div style="display:grid;grid-template-columns:repeat(${esc(weekCount ?? '')},1fr);gap:3px" class="v2-profile-24">
                ${weeks.map((w) => `
                  <span class="v2-profile-25">${w.days.map((d) => `<span title="${esc(d.title ?? '')}" style="aspect-ratio:1;border-radius:3px;background:${esc(d.bg ?? '')};box-shadow:${esc(d.ring ?? '')}" class="v2-profile-26"></span>`).join('')}</span>
                `).join('')}
              </div>
              <span></span>
              <div style="display:grid;grid-template-columns:repeat(${esc(weekCount ?? '')},1fr);margin-top:8px;font-size:11px;color:var(--ink-3);font-family:var(--font-mono)" class="v2-profile-27">
                ${months.map((m) => `<span style="grid-column:${esc(m.col ?? '')}" class="v2-profile-28">${esc(m.label ?? '')}</span>`).join('')}
              </div>
            </div>
            </div><div class="v2-profile-29">
              <span><span class="v2-profile-30">${esc(activeDays ?? '')}</span> active days</span>
              <span><span class="v2-profile-31">${esc(bestStreak ?? '')}</span> longest run</span>
              <span>Most recent · <span class="v2-profile-32">${state.historyDeleted ? 'None' : 'Today'}</span></span>
              <span class="v2-profile-33">Less<span class="v2-profile-34"></span><span class="v2-profile-35"></span><span class="v2-profile-36"></span>More</span>
            </div>
          </div>
        </section>

        <section class="v2-profile-37 enter" aria-labelledby="topics-h">
          <div class="v2-profile-38">
            <h2 id="topics-h" class="v2-profile-39">Topics touched</h2>
            <a href="#roadmap" class="v2-profile-40">Open roadmap</a>
          </div>
          <div class="v2-profile-41">
            ${topics.map((t) => `
              <a href="${esc(t.href ?? '')}" class="v2-profile-42">
                <span aria-hidden="true" class="v2-profile-43"><span style="width:22px;height:22px;clip-path:${esc(t.clip ?? '')};border-radius:${esc(t.radius ?? '')};background:${esc(t.fill ?? '')};box-shadow:${esc(t.inset ?? '')}" class="v2-profile-44"></span></span>
                <span class="v2-profile-45">${esc(t.label ?? '')}</span>
                <span class="v2-profile-46">${esc(t.count ?? '')}</span>
                <span aria-hidden="true" class="v2-profile-47"><span style="display:block;height:100%;width:${esc(t.pct ?? '')};border-radius:2px;background:${esc(t.fill ?? '')}" class="v2-profile-48"></span></span>
              </a>
            `).join('')}
          </div>
        </section>
      </div>

      <div class="v2-profile-49">
        <a href="#review" class="v2-profile-50 enter" aria-labelledby="focus-h">
          <div class="v2-profile-51">
            <span class="v2-profile-52">Current focus</span>
            <span class="v2-profile-53">2 ATTEMPTS</span>
          </div>
          <h2 id="focus-h" class="v2-profile-54">Stopping at the first qualifying event</h2>
          <p class="v2-profile-55">One finding across two attempts describes the same decision: return at the match instead of overwriting the answer. Evidence stays inspectable in each review.</p>
          <div class="v2-profile-56">
            <span class="v2-profile-57 pressable">Open the review<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12m-5-5 5 5-5 5"></path></svg></span>
            <span class="v2-profile-58">or choose another focus on the roadmap</span>
          </div>
        </a>

        <section class="v2-profile-59 enter" aria-labelledby="recent-h">
          <h2 id="recent-h" class="v2-profile-60">Recent</h2>
          <ol class="v2-profile-61">
            ${recent.map((r) => `
              <li style="flex:${esc(r.grow ?? '')};display:grid;grid-template-columns:12px 1fr;gap:12px;padding:0" class="v2-profile-62">
                <span aria-hidden="true" class="v2-profile-63"><span style="flex:0 0 auto;width:11px;height:11px;border-radius:50%;margin-top:5px;background:${esc(r.dot ?? '')}" class="v2-profile-64"></span><span style="flex:1;width:0;margin:4px 0 -9px;border-left:${esc(r.rail ?? '')}" class="v2-profile-65"></span></span>
                <a href="${esc(r.href ?? '')}" style="display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-self:start;padding:6px 10px;margin:-6px -10px ${esc(r.pad ?? '')};border-radius:var(--radius-control)" class="v2-profile-66">
                  <span class="v2-profile-67">${esc(r.title ?? '')}</span>
                  <span class="v2-profile-68">${esc(r.when ?? '')}</span>
                  <span class="v2-profile-69">${esc(r.status ?? '')}</span>
                </a>
              </li>
            `).join('')}
          </ol>
        </section>
      </div>
    </div>
  </div>`;
}
