const nodes = [[24, 8], [38, 16], [38, 32], [24, 40], [10, 32], [10, 16]];
const fillOrder = [2, 3, 4, 5, 0];
const phases = [0, -.35, -.7, -.15, -.55, -.9];

export function brandMark(size = 36) {
  const style = (i) => `--draw:cs-draw${i};--pop:cs-pop${i};--equalizer:cs-eq${i};--fill-delay:${fillOrder.indexOf(i) * .36 - 3.6}s;--voice-delay:${phases[i] * 1.6}s`;
  return `<svg class="coursay-mark${size <= 32 ? ' brand-small' : ''}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><g>${nodes.map(([x, y], i) => `<path class="brand-spoke${i === 1 ? ' brand-current-spoke' : ''}" d="M24 24 ${x} ${y}" pathLength="1" style="${style(i)}"/>`).join('')}<circle class="brand-hub" cx="24" cy="24" r="3.5"/>${nodes.map(([x, y], i) => i === 1 ? '' : `<circle class="brand-node" cx="${x}" cy="${y}" r="2.5" style="${style(i)}"/>`).join('')}<circle class="brand-current" cx="38" cy="16" r="5" style="${style(1)}"/></g></svg>`;
}

export function brandWordmark(size = 36) {
  return `<a class="wordmark" href="#welcome" aria-label="Coursay home"><span class="brand-symbol" aria-hidden="true">${brandMark(size)}</span><span class="brand-name">coursay</span></a>`;
}

let pending = 0;
let voice = 'stopped';
let launching = false;
let refresh = () => {};

export function beginBrandLoading() {
  pending += 1;
  refresh();
  return () => { pending -= 1; refresh(); };
}

export function setBrandVoice(status) {
  voice = status;
  refresh();
}

export function startBrandMotion() {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const icon = document.querySelector('link[rel="icon"]');
  const staticIcon = icon.getAttribute('href');
  const source = document.createElement('span');
  source.className = 'brand-favicon-source';
  source.setAttribute('aria-hidden', 'true');
  source.innerHTML = brandMark(16);
  document.body.append(source);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const context = canvas.getContext('2d');
  let interval;
  let blurred = !document.hasFocus();
  const motionAllowed = () => !reduced.matches && !forced.matches && root.dataset.reduce !== 'true' && root.dataset.input !== 'keyboard';
  const restoreIcon = () => {
    clearInterval(interval);
    interval = undefined;
    icon.setAttribute('href', staticIcon);
    icon.type = 'image/svg+xml';
  };
  const drawIcon = () => {
    context.clearRect(0, 0, 16, 16);
    context.save();
    context.scale(1 / 3, 1 / 3);
    context.globalAlpha = Number(getComputedStyle(source.querySelector('g')).opacity);
    context.lineCap = 'round';
    source.querySelectorAll('path, circle').forEach((element, i) => {
      const style = getComputedStyle(element);
      context.beginPath();
      if (element.tagName === 'path') {
        const [x, y] = nodes[i];
        const length = 1 - parseFloat(style.strokeDashoffset);
        context.moveTo(24, 24);
        context.lineTo(24 + (x - 24) * length, 24 + (y - 24) * length);
      } else {
        context.arc(parseFloat(style.cx), parseFloat(style.cy), parseFloat(style.r), 0, Math.PI * 2);
        context.fillStyle = style.fill;
        context.fill();
      }
      if (style.stroke !== 'none') {
        context.strokeStyle = style.stroke;
        context.lineWidth = parseFloat(style.strokeWidth);
        context.stroke();
      }
    });
    context.restore();
    icon.type = 'image/png';
    icon.href = canvas.toDataURL();
  };
  launching = motionAllowed();
  refresh = () => {
    if (!motionAllowed()) launching = false;
    const activeVoice = ['listening', 'thinking', 'speaking'].includes(voice);
    const busy = pending > 0 || ['connecting', 'reconnecting'].includes(voice);
    const motion = !motionAllowed() ? 'static' : launching ? 'launch' : activeVoice ? 'voice' : busy ? 'loading' : 'static';
    root.dataset.brandMotion = motion;
    if (motion === 'static' || blurred || document.hidden) restoreIcon();
    else if (!interval) {
      drawIcon();
      // The supplied motion sheet specifies approximately 12 favicon frames per second.
      interval = setInterval(drawIcon, 1000 / 12);
    }
  };
  new MutationObserver(refresh).observe(root, { attributes: true, attributeFilter: ['data-reduce', 'data-input', 'data-theme'] });
  reduced.addEventListener('change', refresh);
  forced.addEventListener('change', refresh);
  window.addEventListener('blur', () => { blurred = true; refresh(); });
  window.addEventListener('focus', () => { blurred = false; refresh(); });
  document.addEventListener('visibilitychange', refresh);
  refresh();
  // Complete the reference's single 3.2-second launch even if route markup changes.
  setTimeout(() => { launching = false; refresh(); }, 3200);
}
