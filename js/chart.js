// Minimal dependency-free canvas chart plotting cents-deviation over successive attempts.

export function renderProgressChart(canvas, history) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600;
  const cssHeight = canvas.clientHeight || 260;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { top: 16, right: 16, bottom: 28, left: 44 };
  const w = cssWidth - padding.left - padding.right;
  const h = cssHeight - padding.top - padding.bottom;

  if (!history || history.length === 0) {
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No attempts logged yet', cssWidth / 2, cssHeight / 2);
    return;
  }

  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  const maxAbs = Math.max(50, ...sorted.map((d) => Math.abs(d.centsDiff)));
  const yMax = Math.ceil(maxAbs / 10) * 10;
  const yMin = -yMax;

  const xFor = (i) =>
    padding.left + (sorted.length === 1 ? w / 2 : (i / (sorted.length - 1)) * w);
  const yFor = (cents) =>
    padding.top + h - ((cents - yMin) / (yMax - yMin)) * h;

  // Gridlines + y-axis labels
  ctx.strokeStyle = '#e0e0e0';
  ctx.fillStyle = '#888';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const steps = 4;
  for (let s = -steps; s <= steps; s++) {
    const val = (yMax / steps) * s;
    const y = yFor(val);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + w, y);
    ctx.lineWidth = val === 0 ? 1.5 : 1;
    ctx.strokeStyle = val === 0 ? '#999' : '#e8e8e8';
    ctx.stroke();
    ctx.fillText(String(Math.round(val)), padding.left - 8, y);
  }

  // Connecting line
  ctx.beginPath();
  sorted.forEach((d, i) => {
    const x = xFor(i);
    const y = yFor(d.centsDiff);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#6b7fd7';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Points
  sorted.forEach((d, i) => {
    const x = xFor(i);
    const y = yFor(d.centsDiff);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = d.centsDiff > 0 ? '#d76b6b' : d.centsDiff < 0 ? '#6b8fd7' : '#6bd79a';
    ctx.fill();
  });

  // X axis labels (first / last attempt dates)
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const firstDate = new Date(sorted[0].timestamp);
  const lastDate = new Date(sorted[sorted.length - 1].timestamp);
  ctx.fillText(formatDate(firstDate), padding.left, cssHeight - 8);
  ctx.textAlign = 'right';
  ctx.fillText(formatDate(lastDate), padding.left + w, cssHeight - 8);
}

function formatDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
