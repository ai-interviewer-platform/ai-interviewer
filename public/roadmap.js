import { topics, topicTrees, exercises } from './model.js';

const stages = ['Foundations', 'Core patterns', 'Apply the idea'];
const problemIds = topic => [...new Set(topicTrees[topic.id].flatMap(branch => branch.leaves.flatMap(leaf => leaf.exercises)))];
export function practiceStatus(ids, state) {
  const started = state.historyDeleted ? 0 : ids.filter(id => id === state.personal.problem).length;
  const completed = !state.historyDeleted && state.retry?.ran && state.retry?.fixed && ids.includes(state.retry.problem) ? 1 : 0;
  return { started, completed, total: ids.length, tone: completed ? 'complete' : started ? 'started' : 'available' };
}
function meter(status) {
  return `<span class="road-progress"><span>${status.completed}/${status.total} practiced</span><span class="progress-track" aria-hidden="true"><span style="--progress:${status.completed / status.total * 100}%"></span></span></span>`;
}
export function roadmapScreen(state, route, ui) {
  const { link, button, icon } = ui;
  const view = route.params.get('view') ?? (matchMedia('(max-width: 48rem)').matches ? 'list' : 'map');
  const selected = topics.find(topic => topic.id === (route.params.get('topic') ?? 'sets'));
  const topicNode = topic => {
    const status = practiceStatus(problemIds(topic), state);
    const label = status.tone === 'complete' ? 'Practiced with guidance' : status.tone === 'started' ? 'In progress' : 'Available';
    return `<a class="road-node ${status.tone}" aria-label="${topic.name}, ${label}, ${status.completed} of ${status.total} practiced" ${selected?.id === topic.id ? 'aria-current="true"' : ''} id="topic-${topic.id}" href="#roadmap?topic=${topic.id}&view=${view}" style="--column:${topic.column + 1};--row:${topic.row === 2 ? 2 : 1}"><span class="road-node-title"><i aria-hidden="true"></i>${topic.name}${icon('chevron')}</span><span class="road-node-detail">${topic.note}</span>${meter(status)}</a>`;
  };
  const selection = selected ? `<section class="selected-topic" aria-labelledby="topic-title"><div><p class="eyebrow">Selected topic</p><h2 id="topic-title" tabindex="-1">${selected.name}</h2></div><div class="selected-leaves">${topicTrees[selected.id].flatMap(branch => branch.leaves.map(leaf => `<a class="subtopic-card" id="leaf-${leaf.id}" href="#roadmap?topic=${selected.id}&view=${view}&leaf=${leaf.id}" aria-haspopup="dialog"><strong>${leaf.name}</strong><span class="subtopic-count">${leaf.exercises.length} ${leaf.exercises.length === 1 ? 'problem' : 'problems'}</span><small>${branch.note}</small></a>`)).join('')}</div></section>` : '';
  return `<div class="page-title"><h1>Learning roadmap</h1>${link('Start interview', 'setup', 'primary', 'play')}</div>
    <div class="roadmap-toolbar"><div class="segmented" aria-label="Roadmap view">${link('Graph', `roadmap?view=map${selected ? `&topic=${selected.id}` : ''}`, view === 'map' ? 'selected' : '')}${link('List', `roadmap?view=list${selected ? `&topic=${selected.id}` : ''}`, view === 'list' ? 'selected' : '')}</div><div class="road-key"><span><i class="available"></i>Available</span><span><i class="started"></i>In progress</span><span><i class="complete"></i>Practiced with guidance</span>${button('How this works', 'map-help', 'quiet small')}</div></div>
    ${view === 'map' ? `<section class="road-graph" aria-label="Topic map"><div class="graph-stages">${stages.map((stage, index) => `<span class="stage-label stage-${index}"><i aria-hidden="true"></i>${stage}</span>`).join('')}</div><div class="map-scroll" tabindex="0" role="region" aria-label="Learning map, scroll horizontally for more topics"><div class="road-grid"><svg aria-hidden="true"><path data-from="sequences" data-to="sets"/><path data-from="sequences" data-to="flow"/><path data-from="sets" data-to="repeat"/><path data-from="flow" data-to="runs"/></svg>${topics.map(topicNode).join('')}</div></div><div class="graph-controls"><span>Demo activity</span><div>${button('Pan left', 'pan-left', 'quiet small', 'back')}${button('Pan right', 'pan-right', 'quiet small', 'arrow')}</div></div></section>` : `<section class="road-list" aria-label="Topic list">${topics.map(topicNode).join('')}</section>`}
    ${selection}`;
}
export function getPracticeLeaf(route) {
  const topic = topics.find(item => item.id === route.params.get('topic'));
  const leaf = topicTrees[topic?.id]?.flatMap(branch => branch.leaves).find(item => item.id === route.params.get('leaf'));
  return leaf ? { topic, leaf } : null;
}
export function problemDrawer(selection, ui) {
  const { button, link, icon } = ui;
  return `<div class="practice-drawer-head"><div><p class="eyebrow">${selection.topic.name}</p><h2 id="drawer-title">${selection.leaf.name}</h2><span class="difficulty-tag">Python · Foundations</span></div>${button('Close problems', 'close-problems', 'quiet small', 'close')}</div><div class="practice-drawer-body"><h3 class="section-label">Practice problems</h3><div class="drawer-summary">${selection.leaf.exercises.length} ${selection.leaf.exercises.length === 1 ? 'problem' : 'problems'} available</div><ol class="practice-problems">${selection.leaf.exercises.map(id => `<li><span class="problem-circle" aria-hidden="true">${icon('code')}</span><div><h3>${exercises[id].title}</h3><p>${exercises[id].lead}</p></div><span class="difficulty-tag">Foundations</span>${link('Practice', `setup?problem=${id}`, 'secondary small', 'arrow')}</li>`).join('')}</ol></div>`;
}

export function positionRoadmapConnections() {
  const grid = document.querySelector('.road-grid');
  if (!grid) return;
  const svg = grid.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${grid.clientWidth} ${grid.clientHeight}`);
  svg.querySelectorAll('path').forEach(path => {
    const from = grid.querySelector(`#topic-${path.dataset.from}`);
    const to = grid.querySelector(`#topic-${path.dataset.to}`);
    const x1 = from.offsetLeft + from.offsetWidth;
    const y1 = from.offsetTop + from.offsetHeight / 2;
    const x2 = to.offsetLeft;
    const y2 = to.offsetTop + to.offsetHeight / 2;
    const bend = (x1 + x2) / 2;
    path.setAttribute('d', `M${x1} ${y1} C${bend} ${y1} ${bend} ${y2} ${x2} ${y2}`);
  });
}
