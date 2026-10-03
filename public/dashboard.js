// Draws the admin dashboard charts with Chart.js.
// The numbers come from the JSON block the server put in the page (see routes/admin.js).
(function () {
  const dataTag = document.getElementById('dashboard-data');
  if (!dataTag || !window.Chart) return; // CDN blocked: the tables below still show everything
  const data = JSON.parse(dataTag.textContent);

  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const accent = color('--accent');
  const negative = color('--error-text');
  const positive = color('--available');
  const muted = color('--muted');

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = muted;
  Chart.defaults.maintainAspectRatio = false;

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' });
  const moneyTooltip = { callbacks: { label: (ctx) => `${ctx.dataset.label || ''} ${money.format(ctx.parsed.y ?? ctx.parsed.x)}`.trim() } };

  // Revenue by month: gross and refunds as bars, net as a line on top.
  new Chart(document.getElementById('revenueChart'), {
    data: {
      labels: data.months,
      datasets: [
        { type: 'line', label: 'Net', data: data.net, borderColor: accent, backgroundColor: accent, tension: 0.25, pointRadius: 2, order: 0 },
        { type: 'bar', label: 'Gross', data: data.gross, backgroundColor: positive, order: 1 },
        { type: 'bar', label: 'Refunds', data: data.refunds, backgroundColor: negative, order: 2 },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: moneyTooltip },
      scales: { y: { ticks: { callback: (v) => compactMoney.format(v) } } },
    },
  });

  // Revenue by city: horizontal bars, biggest first.
  new Chart(document.getElementById('cityChart'), {
    type: 'bar',
    data: { labels: data.cities, datasets: [{ label: 'Revenue', data: data.cityRevenue, backgroundColor: accent }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: moneyTooltip },
      scales: { x: { ticks: { callback: (v) => compactMoney.format(v) } } },
    },
  });

  // Sell-through histogram: number of past events per 10% bucket.
  new Chart(document.getElementById('sellThroughChart'), {
    type: 'bar',
    data: { labels: data.sellThroughRanges, datasets: [{ label: 'Events', data: data.sellThroughEvents, backgroundColor: positive }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Seats sold' } },
        y: { title: { display: true, text: 'Events' }, ticks: { precision: 0 } },
      },
    },
  });
})();
