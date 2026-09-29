const el = id => document.getElementById(id);
const fields = { hook:'HOOK ARCHETYPE', format:'FORMAT', offer:'OFFER', cta:'CTA INTENT', awareness:'AWARENESS', driver:'DRIVER', funnel:'FUNNEL', hookSpecificity:'HOOK SPECIFICITY', offerStrength:'OFFER STRENGTH', durability:'DURABILITY', claimRisk:'CLAIM RISK', homepageMatch:'HOMEPAGE MATCH' };
const formatColors = { 'problem-solution':'#f5891f', 'offer-promo':'#e85a4a', 'lifestyle-aspiration':'#5b5bd6', 'product-announcement':'#8b4dbf', 'catalog-generic':'#8a8a86', tutorial:'#d63384', testimonial:'#8b4dbf', 'product-demo':'#f5891f', 'talking-head':'#5b5bd6', static:'#e85a4a', unknown:'#8a8a86' };
let current, stream, taxonomy, scoreRubrics, selected, following = true, historyVersion = 0, detailSignature = '', autoSummary = false;
let rowVersion = 0, viewVersion = 0, viewAnimations = [], categoryFilter = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Timing and offsets come from the supplied Video Analysis.dc.html motion system.
const motion = { row:100, hold:900, fade:600, exit:500 };
const pretty = value => String(value).replaceAll('-', ' ');
function node(tag, text, cls) { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (cls) item.className = cls; return item; }
function error(message) { el('message').textContent = message; }
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
function action(text, callback, cls) {
  const button = node('button', text, cls); button.type = 'button';
  button.onclick = async () => { button.disabled = true; try { await callback(); } catch (e) { error(e.message); } finally { button.disabled = false; } }; return button;
}
function answer(source, field) {
  const correction = source.corrections?.findLast(item => item.field === field);
  return correction ? { ...correction, human:true } : source.classification?.answers[field];
}
function label(source, field) { return answer(source,field)?.choice ?? 'unknown'; }
function formatColor(source) { return formatColors[label(source,'format')] ?? '#8a8a86'; }
async function summary(show, completed = false) {
  const version = ++viewVersion;
  viewAnimations.forEach(animation=>animation.cancel());viewAnimations=[];
  const stage=el('summary-view'), dashboard=el('dashboard');
  const animate=(target,frames,duration)=>{const animation=target.animate(frames,{duration,fill:'forwards',easing:'cubic-bezier(.2,.8,.2,1)'});viewAnimations.push(animation);return animation.finished.catch(()=>{});};
  if(!show || reducedMotion.matches) {
    stage.hidden=!show;dashboard.hidden=show;dashboard.inert=show;dashboard.classList.remove('leaving');stage.classList.remove('summary-enter');stage.classList.toggle('summary-stage',show);document.body.classList.toggle('summary-mode',show);return;
  }
  dashboard.hidden=false; dashboard.inert=true;dashboard.classList.add('leaving');stage.hidden=true;
  if(completed)await animate(dashboard,[{opacity:1},{opacity:1}],motion.hold);
  if(version!==viewVersion)return;
  await Promise.all([animate(dashboard,[{opacity:1,filter:'grayscale(0)'},{opacity:.35,filter:'grayscale(1)'}],motion.fade),animate(document.querySelector('.masthead'),[{opacity:1},{opacity:0}],motion.fade)]);
  if(version!==viewVersion)return;
  document.body.classList.add('summary-mode');stage.classList.add('summary-stage','summary-enter');stage.hidden=false;
  await animate(dashboard,[{opacity:.35},{opacity:0}],motion.exit);
  if(version===viewVersion)dashboard.hidden=true;
}
function inspect(run, newlyStarted = false) {
  stream?.close(); selected = null; detailSignature = ''; following = true; categoryFilter=null;autoSummary = newlyStarted; summary(false); el('workspace').close();
  stream = new EventSource(`/api/events/${run.id}`);
  stream.onmessage = event => {
    const before = current?.id === run.id ? current : null; current = JSON.parse(event.data);
    if (following) selected = current.sources.findLast(source => source.classification && !before?.sources.find(old => old.id === source.id)?.classification)?.id ?? selected ?? current.sources[0]?.id;
    render();
    if (current.status !== 'running') { stream.close(); void history(); if (autoSummary && current.status === 'complete' && current.sources.length) void summary(true,true); autoSummary = false; }
  };
  stream.onerror = () => { stream.close(); error('Connection ended. Reopen the run to inspect saved progress.'); };
}
async function history() {
  const version = ++historyVersion, runs = await api('/api/runs'); if (version !== historyVersion) return;
  el('history').replaceChildren(...runs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(run => {
    const row = node('p', `${run.status} · ${run.query} `); row.append(action('Inspect',()=>inspect(run))); return row;
  }));
}
function metric(id, value) {
  const target=el(id),text=String(value),previous=target.textContent;
  if(previous===text)return;
  let same=0;while(same<text.length && text[same]===previous[same])same++;
  const unsettled=node('span',text.slice(same),reducedMotion.matches?'digit':'digit changing-digit');target.replaceChildren(document.createTextNode(text.slice(0,same)),unsettled);
  requestAnimationFrame(()=>requestAnimationFrame(()=>unsettled.classList.remove('changing-digit')));
}
function measured() {
  const completed = current.sources.filter(source => source.classification);
  const count = completed.reduce((sum,source)=>sum+Object.keys(source.classification.answers).length,0);
  const end = current.status === 'running' ? Date.now() : Date.parse(current.finishedAt);
  const seconds = Number.isFinite(end) ? Math.max(0,(end-Date.parse(current.createdAt))/1000) : null;
  const bills = completed.map(source=>source.classification.billing?.reportedCost?.unit === 'MICRO_DOLLAR' && source.classification.billing?.reportedCost?.currency === 'USD' ? source.classification.billing.reportedCost.value : null).filter(Number.isFinite);
  const exa = current.discovery?.cost?.total;
  const cost = bills.length || Number.isFinite(exa) ? (bills.reduce((a,b)=>a+b,0)/1e6+(exa ?? 0)) : null;
  return { completed,count,seconds,cost };
}
function metrics() {
  if (!current) return;
  const m = measured(); metric('read', m.completed.length.toLocaleString()); metric('judgments',m.count.toLocaleString());
  const brands = new Set(current.sources.map(s=>s.evidence?.advertiser).filter(Boolean)); metric('brands',brands.size || '—');
  metric('elapsed',m.seconds===null?'—':`${m.seconds.toFixed(1)}s`); metric('speed',m.seconds && m.count ? (m.count/m.seconds).toFixed(1) : '—'); metric('cost',m.cost === null ? '—' : `$${m.cost.toFixed(4)}`);
}
function select(source) { selected = source.id; following = false; summary(false); render(); }
function renderTiles() {
  const sort = el('sort').value;
  const sources = current.sources.filter(s=>(!el('filter').value || label(s,'hook')===el('filter').value) && (!categoryFilter || label(s,categoryFilter.field)===categoryFilter.value));
  if (sort !== 'arrival') sources.sort((a,b)=>String(sort==='hook'?label(a,'hook'):a[sort]??'').localeCompare(String(sort==='hook'?label(b,'hook'):b[sort]??'')));
  const existing = new Map([...el('tiles').querySelectorAll('.tile')].map(tile=>[tile.dataset.id,tile]));
  for (const source of sources) {
    let tile = existing.get(source.id);
    if (!tile) { tile = action('',()=>select(source),'tile'); tile.dataset.id = source.id; tile.append(node('span',source.title,'tile-label')); }
    const image = source.acquisition?.screenshot;
    if (image && !tile.querySelector('img')) { const img = node('img'); img.src=image; img.alt=''; img.loading='lazy'; tile.prepend(img); }
    tile.setAttribute('aria-label',`${source.title} · ${source.status ?? 'pending'}`); tile.setAttribute('aria-pressed',String(source.id===selected)); tile.style.setProperty('--accent',formatColor(source));
    el('tiles').append(tile); existing.delete(source.id);
  }
  existing.forEach(tile=>tile.remove()); el('tiles').querySelector('.empty')?.remove();
  if (!sources.length) el('tiles').append(node('p','No creatives match this view.','empty'));
  // Reference: 17 desktop columns. Scale cell density to available panel width.
  const columns = Math.max(1,Math.round(17 * el('tiles').clientWidth / 905));
  el('tiles').style.gridTemplateColumns = `repeat(${columns},minmax(0,1fr))`;
  el('source-count').textContent = `${current.sources.filter(s=>s.classification).length} / ${current.sources.length}`;
  el('follow').textContent = following ? 'Following newest' : 'Follow newest'; el('follow').setAttribute('aria-pressed',String(following));
}
function renderDetail() {
  const source = current.sources.find(s=>s.id===selected); if (!source) { detailSignature='';el('results').replaceChildren(node('p','No creative selected.','empty'));el('latency').textContent='AWAITING EVIDENCE';return; }
  const signature = JSON.stringify(source); if (signature === detailSignature) return; detailSignature = signature;
  const version=++rowVersion;
  const previousVideo = el('results').querySelector('video'), previousTime = previousVideo?.currentTime, playing = previousVideo && !previousVideo.paused;
  const sameVideo = previousVideo?.dataset.source === source.id;
  const creative = node('div',undefined,'creative');
  const videoURL = source.acquisition?.playback ?? source.acquisition?.video;
  if (videoURL) {
    const video = node('video'); video.src = videoURL; video.controls = true; video.preload = 'metadata'; video.dataset.source = source.id; video.setAttribute('aria-label', 'Creative video');
    if (source.acquisition.screenshot) video.poster = source.acquisition.screenshot;
    video.onerror = ()=>{ video.after(node('p','Playback unavailable. Open the original source.')); };
    if (sameVideo) video.onloadedmetadata = ()=>{ video.currentTime=previousTime; if(playing) void video.play().catch(()=>{}); };
    creative.append(video);
  } else if (source.acquisition?.screenshot) { const img = node('img'); img.src=source.acquisition.screenshot; img.alt='Captured creative'; creative.append(img); }
  creative.append(node('h3',source.evidence?.advertiser || source.title));
  creative.append(node('p',`${Object.keys(source.classification?.answers ?? {}).length} judgments · one request`));
  const latency = source.timings?.classification;
  el('latency').textContent = latency === undefined ? 'AWAITING JEV' : `${Math.round(latency).toLocaleString()} MS · END TO END`;
  creative.append(node('p',`${source.evidence?.coverage ?? 'media unverified'} · ${source.acquisition?.audio ?? source.evidence?.audio ?? 'audio unknown'}`));
  if (source.error) creative.append(node('p',source.error));
  if (source.url) { const link=node('a','Open original source'); link.href=source.url; link.target='_blank'; link.rel='noopener noreferrer'; creative.append(link); }
  creative.append(action('Evidence & review',()=>openEvidence(source)));
  const copy = source.evidence?.observations?.[0]?.description; if (copy) creative.append(node('p',copy,'copy'));
  const judgments=node('div',undefined,'judgment-list');
  Object.entries(fields).forEach(([key,title],index)=>{
    const value=answer(source,key), unknown=!value || value.choice==='unknown' || value.type==='score' && value.score===null;
    const negative=key==='claimRisk' && value?.choice==='yes' || key==='homepageMatch' && value?.choice==='breaks';
    const row=node('div',undefined,`judgment${unknown?' unknown':''}${value?.type==='score'?' score':''}${negative?' negative':''}`), bar=node('div',undefined,'judgment-value'), fill=node('i',undefined,'fill'),track=node('span',undefined,'judgment-track');
    const width=unknown?0:value.type==='score'?value.score/3*100:value.human?100:(value.confidence ?? 0)*100;
    bar.style.setProperty('--width',`${width}%`);
    const text=node('span',unknown?'unknown':value.type==='score'?`${value.score.toFixed(1)} / 3`:pretty(value.choice),'text');
    track.append(fill);bar.append(text,track);row.append(node('span',title,'judgment-label'),bar,node('span',value?.human?'human':Number.isFinite(value?.confidence)?`${Math.round(value.confidence*100)}%`:'—','confidence'));
    const reveal=()=>{if(version!==rowVersion)return;row.classList.add('arriving');judgments.append(row);requestAnimationFrame(()=>requestAnimationFrame(()=>row.classList.remove('arriving')));};
    if(reducedMotion.matches || !source.classification)reveal();else setTimeout(reveal,index*motion.row);
  });
  el('results').replaceChildren(creative,judgments);
}
function distribution(field) {
  const counts=new Map(); for(const source of current.sources.filter(s=>s.classification)) {const value=label(source,field);counts.set(value,(counts.get(value)??0)+1);}
  return [...counts].sort((a,b)=>b[1]-a[1]);
}
function renderCategory() {
  el('category-bars').replaceChildren(...['hook','format','awareness'].map(field=>{
    const col=node('div',undefined,'distribution');col.append(node('h3',fields[field]));
    const values=distribution(field), total=current.sources.filter(s=>s.classification).length;
    // Five visible ranks and leader-relative widths are specified in the reference.
    values.slice(0,5).forEach(([value,count])=>{const row=action('',()=>{categoryFilter=categoryFilter?.field===field && categoryFilter?.value===value?null:{field,value};renderTiles();},'distribution-row'),p=node('span',undefined,'distribution-label'),bar=node('div',undefined,'bar');row.setAttribute('aria-label',`Filter ${pretty(field)}: ${pretty(value)}`);row.setAttribute('aria-pressed',String(categoryFilter?.field===field && categoryFilter?.value===value));p.append(node('span',pretty(value)),node('span',count));bar.style.setProperty('--width',`${count/(values[0]?.[1] || total)*100}%`);if(field==='format')bar.style.setProperty('--accent',formatColors[value]??'#8a8a86');bar.append(node('i'));row.append(p,bar);col.append(row);});return col;
  }));
  const needs=current.sources.map(source=>({source,missing:Object.keys(fields).filter(field=>{const a=answer(source,field);return !a || a.choice==='unknown' || a.type==='score' && a.score===null;})})).filter(({source,missing})=>missing.length || source.evidence?.gaps.length || source.error);
  el('review-count').textContent=needs.length;
  el('review-cards').replaceChildren(...needs.reverse().map(({source,missing})=>{const card=action('',()=>{select(source);openEvidence(source);},'review-card');card.append(node('strong',source.evidence?.advertiser || source.title),node('span',missing.length?fields[missing[0]]:'COVERAGE','field-name'),node('span',missing.length?`${missing.length} unknown`:'gaps','missing-value'),node('small','MISSING EVIDENCE'));return card;}));
}
function renderSummary() {
  const m=measured(), cards=[];
  for(const [field,title] of [['hook','THE HOOK IN THIS SAMPLE'],['format','THE FORMAT IN THIS SAMPLE'],['awareness','WHO THEY ARE WRITING FOR']]) {
    const top=distribution(field).find(([value])=>value!=='unknown'); const card=node('div',undefined,'summary-card');card.append(node('span',title),node('strong',top?pretty(top[0]):'unknown'),node('p',top?`${top[1]} of ${m.completed.length} analyzed creatives`:'More evidence needed'));cards.push(card);
  }
  const matched=m.completed.filter(s=>s.landingPage && ['holds','breaks'].includes(label(s,'homepageMatch'))), broken=matched.filter(s=>label(s,'homepageMatch')==='breaks').length;
  const card=node('div',undefined,'summary-card');card.append(node('span','PROMISES THAT BREAK ON THE LANDING PAGE'),node('strong',matched.length?`${Math.round(broken/matched.length*100)}%`:'unknown'),node('p',`${matched.length} separately captured landing pages assessed`));cards.push(card);cards.forEach((item,index)=>item.style.setProperty('--index',index));el('summary-cards').replaceChildren(...cards);
  const times=m.completed.map(s=>s.timings?.classification).filter(Number.isFinite).sort((a,b)=>a-b), middle=Math.floor(times.length/2), median=times.length?(times.length%2?times[middle]:(times[middle-1]+times[middle])/2):null;
  el('summary-numbers').replaceChildren(document.createTextNode(m.seconds===null?'Elapsed unavailable. ':`${m.seconds.toFixed(1)} seconds. `),node('span',m.cost===null?'Cost unavailable.':`$${m.cost.toFixed(4)} reported (partial).`,'summary-muted'),node('br'),node('span',`${m.count.toLocaleString()} judgments${median===null?'':` · median ${Math.round(median).toLocaleString()} ms per creative.`}`,'summary-muted'));
}
function openEvidence(source) {
  const root=el('evidence-detail');root.replaceChildren(node('h3',source.title));
  for(const observation of source.evidence?.observations ?? []) {
    if(Number.isFinite(observation.startSeconds))root.append(action(`${observation.startSeconds.toFixed(1)}–${observation.endSeconds.toFixed(1)}s · ${observation.description}`,()=>{el('evidence-dialog').close();const video=el('results').querySelector('video');if(video){video.currentTime=observation.startSeconds;void video.play().catch(()=>{});}},'observation'));
    else root.append(node('p',`${observation.region} · ${observation.description}`));
  }
  for(const gap of source.evidence?.gaps ?? [])root.append(node('p',gap,'muted'));
  const details=node('details');details.append(node('summary','Evidence, provenance, usage & correction history'),node('pre',JSON.stringify(source,null,2)));root.append(details);
  if(source.jevAttempted && !source.jevRunId && current.status!=='running'){
    const form=node('form'),input=node('input');input.required=true;input.setAttribute('aria-label','Monid run ID');form.append(input,node('button','Attach existing Jev run'));form.onsubmit=async event=>{event.preventDefault();try{current=await api(`/api/runs/${current.id}/reconcile`,{sourceId:source.id,runId:input.value});render();el('evidence-dialog').close();}catch(e){error(e.message);}};root.append(form);
  }
  if(source.classification && current.status!=='running'){
    const form=node('form'),field=node('select'),choice=node('select'),score=node('input'),rubric=node('p',undefined,'muted');field.setAttribute('aria-label','Judgment field');choice.setAttribute('aria-label','Corrected label');score.setAttribute('aria-label','Corrected score');score.type='number';score.min='0';score.max='3';score.step='any';Object.keys(fields).forEach(key=>field.add(new Option(key,key)));
    const choices=()=>{const scored=Object.hasOwn(scoreRubrics,field.value);choice.hidden=scored;score.hidden=!scored;score.required=scored;rubric.textContent=scored?scoreRubrics[field.value].map((text,index)=>`${index}: ${text}`).join(' · '):'';if(!scored)choice.replaceChildren(...taxonomy[field.value].map(value=>new Option(value,value)));};field.onchange=choices;choices();
    const reviewer=node('input'),reason=node('input');reviewer.placeholder='Reviewer';reviewer.setAttribute('aria-label','Reviewer');reviewer.required=true;reason.placeholder='Evidence / rationale';reason.setAttribute('aria-label','Correction rationale');reason.required=true;form.append(field,choice,score,rubric,reviewer,reason,node('button','Save human judgment'));
    form.onsubmit=async event=>{event.preventDefault();try{current=await api(`/api/runs/${current.id}/correct`,{sourceId:source.id,field:field.value,...(Object.hasOwn(scoreRubrics,field.value)?{score:Number(score.value)}:{choice:choice.value}),reviewer:reviewer.value,reason:reason.value});render();openEvidence(current.sources.find(s=>s.id===source.id));}catch(e){error(e.message);}};root.append(form);
  }
  if(!el('evidence-dialog').open)el('evidence-dialog').showModal();
}
function render() {
  if(!current)return;el('message').textContent=`${current.status} · ${current.stage ?? 'stopped'} · ${current.sources.length} sources · ${current.error ?? ''}`;
  metrics();renderTiles();renderDetail();renderCategory();renderSummary();
  const controls=[];
  if(current.status==='running')controls.push(action('Cancel run',async()=>{current=await api(`/api/runs/${current.id}/cancel`,{});render();}));
  else if(current.status!=='complete')controls.push(action('Resume failed stages',async()=>{await api(`/api/runs/${current.id}/resume`,{});inspect(current,true);}));
  controls.push(action('Category summary',()=>summary(true)),action('Export run JSON',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'})),link=node('a');link.href=url;link.download=`${current.id}.json`;link.click();URL.revokeObjectURL(url);}));el('run-actions').replaceChildren(...controls);
}
el('workspace-open').onclick=()=>el('workspace').showModal();el('workspace-close').onclick=()=>el('workspace').close();el('evidence-close').onclick=()=>el('evidence-dialog').close();el('back').onclick=()=>summary(false);
el('follow').onclick=()=>{following=true;selected=current?.sources.findLast(s=>s.classification)?.id??current?.sources[0]?.id;render();};el('sort').onchange=render;el('filter').onchange=()=>{categoryFilter=null;render();};
async function submit(event, request) {event.preventDefault();event.submitter.disabled=true;try{inspect(await request(),true);await history();}catch(e){error(e.message);}finally{event.submitter.disabled=false;}}
el('search').onsubmit=event=>submit(event,async()=>{await api('/api/context',{context:el('context').value});return api('/api/runs',{query:el('query').value,numResults:Number(el('count').value)});});
el('import').onsubmit=event=>submit(event,()=>api('/api/import',{url:el('source-url').value,kind:el('source-kind').value,landingUrl:el('landing-url').value}));
el('upload').onsubmit=event=>submit(event,async()=>{const file=el('video-file').files[0],response=await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':file.type || 'video/mp4'},body:file}),result=await response.json();if(!response.ok)throw new Error(result.error);return result;});
try{const config=await api('/api/context');el('context').value=config.context;taxonomy=config.taxonomy;scoreRubrics=config.scoreRubrics;taxonomy.hook.forEach(value=>el('filter').add(new Option(pretty(value),value)));await history();}catch(e){error(e.message);}
// Display refresh only; never schedules a provider call.
function tick(){if(current?.status==='running')metrics();requestAnimationFrame(tick);}requestAnimationFrame(tick);
new ResizeObserver(()=>{if(current)renderTiles();}).observe(el('tiles'));
