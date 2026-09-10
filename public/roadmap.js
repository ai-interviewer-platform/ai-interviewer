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
function node(name, href, id, status, detail, icon, style = '') {
  const label = status.tone === 'complete' ? 'Practiced with guidance' : status.tone === 'started' ? 'In progress' : 'Available';
  return `<a class="road-node ${status.tone}" aria-label="${name}, ${label}, ${status.completed} of ${status.total} practiced" id="${id}" href="#${href}" ${style}><span class="road-node-title">${name}${icon('chevron')}</span><span class="road-node-detail">${detail} · ${label}</span>${meter(status)}</a>`;
}
export function roadmapScreen(state, route, ui) {
  const { link, button, icon } = ui;
  const view = route.params.get('view') ?? (matchMedia('(max-width: 48rem)').matches ? 'list' : 'map');
  const selected = topics.find(topic => topic.id === route.params.get('topic'));
  const topicNode = topic => node(topic.name, `roadmap?topic=${topic.id}&view=${view}`, `topic-${topic.id}`, practiceStatus(problemIds(topic), state), `${topicTrees[topic.id].length} subtopics`, icon, `style="--column:${topic.column};--row:${topic.row}"`);
  const header = `<div class="page-title"><div><h1>Learning roadmap</h1><p>Build the fundamentals. Put them into practice.</p></div>${link('Start interview', 'setup', 'secondary', 'play')}</div><div class="roadmap-toolbar"><div class="segmented" aria-label="Roadmap view">${link('Graph', `roadmap?view=map${selected ? `&topic=${selected.id}` : ''}`, view === 'map' ? 'selected' : '', 'map')}${link('List', `roadmap?view=list${selected ? `&topic=${selected.id}` : ''}`, view === 'list' ? 'selected' : '', 'list')}</div>${button('How this works', 'map-help', 'quiet', 'book')}</div>`;
  let content;
  if (selected) {
    const branches = topicTrees[selected.id];
    content = `<div class="road-breadcrumb">${link('Back', `roadmap?view=${view}&return=${selected.id}`, 'secondary small', 'back')}<span>Roadmap /</span><h2 id="topic-title" tabindex="-1">${selected.name}</h2></div><p class="muted">${selected.note}. Choose a practice to see its problems.</p><div class="${view === 'map' ? 'map-scroll' : 'road-list'}" ${view === 'map' ? 'tabindex="0" role="region" aria-label="Subtopic graph, scroll horizontally"' : ''}><div class="${view === 'map' ? 'skill-graph' : 'skill-list'}"><div class="skill-origin road-node started"><strong>${selected.name}</strong><span class="road-node-detail">${branches.length} subtopics</span></div><ul class="skill-branches">${branches.map(branch => `<li><div class="skill-label"><strong>${branch.name}</strong><span>${branch.note}</span></div><ul>${branch.leaves.map(leaf => `<li>${node(leaf.name, `roadmap?topic=${selected.id}&view=${view}&leaf=${leaf.id}`, `leaf-${leaf.id}`, practiceStatus(leaf.exercises, state), `${leaf.exercises.length} ${leaf.exercises.length === 1 ? 'problem' : 'problems'} · Open practice`, icon, 'aria-haspopup="dialog"')}</li>`).join('')}</ul></li>`).join('')}</ul></div></div>`;
  } else if (view === 'list') {
    content = `<div class="road-list">${stages.map((stage, index) => `<section class="road-group"><h2 class="stage-label stage-${index}"><span></span>${stage}<i></i></h2>${topics.filter(topic => topic.column === index).map(topicNode).join('')}</section>`).join('')}</div>`;
  } else {
    content = `<section class="road-graph"><div class="graph-stages">${stages.map((stage, i) => `<span class="stage-label stage-${i}"><span></span>${stage}</span>`).join('')}</div><div class="map-scroll" tabindex="0" role="region" aria-label="Learning map, scroll horizontally for more topics"><div class="road-grid"><svg viewBox="0 0 1040 410" aria-hidden="true"><path d="M240 205L400 65M240 205L400 345M640 65H800M640 345H800"/></svg>${topics.map(topicNode).join('')}</div></div><div class="graph-controls">${button('Pan left', 'pan-left', 'quiet small', 'back')}${button('Pan right', 'pan-right', 'quiet small', 'arrow')}</div></section>`;
  }
  return `${header}${content}<div class="road-key"><span><i class="available"></i>Available</span><span><i class="started"></i>In progress</span><span><i class="complete"></i>Practiced with guidance</span></div><p class="catalog-note">Demo activity · counts reflect prepared practice, not mastery.</p>`;
}
export function getPracticeLeaf(route) {
  const topic = topics.find(item => item.id === route.params.get('topic'));
  const leaf = topicTrees[topic?.id]?.flatMap(branch => branch.leaves).find(item => item.id === route.params.get('leaf'));
  return leaf ? { topic, leaf } : null;
}
export function problemDrawer(selection, ui) {
  const { button, link, icon } = ui;
  return `<div class="practice-drawer-head"><div><p class="eyebrow">${selection.topic.name}</p><h2 id="drawer-title">${selection.leaf.name}</h2><span class="difficulty-tag">Python · Foundations</span></div>${button('Close problems', 'close-problems', 'quiet small', 'close')}</div><div class="practice-drawer-body"><p>${selection.topic.note}. Explore the idea through an original interview problem.</p><h3 class="section-label">Practice problems</h3><div class="drawer-summary">${selection.leaf.exercises.length} ${selection.leaf.exercises.length === 1 ? 'problem' : 'problems'} available</div><ol class="practice-problems">${selection.leaf.exercises.map(id => `<li><span class="problem-circle" aria-hidden="true">${icon('code')}</span><div><h3>${exercises[id].title}</h3><p>${exercises[id].lead}</p></div><span class="difficulty-tag">Foundations</span>${link('Practice', `setup?problem=${id}`, 'secondary small', 'arrow')}</li>`).join('')}</ol><p class="drawer-note">Choose a problem to review your interview setup.</p></div>`;
}
