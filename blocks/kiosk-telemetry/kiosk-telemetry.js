import { SETTINGS_KEY } from '../../scripts/kiosk-settings.js';
import { telemetryCredentials, telemetryPreferences } from '../../scripts/kiosk-telemetry-config.js';
import {
  filterJourneys, summarizeJourneys, readTelemetryReport, journeyCSV, eventDay,
} from '../../scripts/kiosk-telemetry-report.js';

const METRICS = {
  selectedToFinish: 'Portrait selected → Finish',
  selectedToPostcard: 'Portrait selected → usable postcard',
  finalLoading: 'Finish → usable postcard',
  graphInterstitial: 'Graph interstitial → ads (cumulative)',
  graphReturn: 'Observed Graph round trips (cumulative proxy)',
  graphHidden: 'Hidden interstitial time (cumulative proxy)',
};
const BRANDS = {
  lorealprofessionnel: 'L’Oréal Professionnel',
  lorealparis: 'L’Oréal Paris',
  yslbeauty: 'YSL Beauty',
  larocheposay: 'La Roche-Posay',
  unknown: 'Unknown / no final choice',
};

function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function table(headings, rows, caption) {
  const wrap = node('div', '', 'telemetry-table-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', caption);
  const element = node('table');
  element.append(node('caption', caption));
  const head = node('thead');
  const header = node('tr');
  headings.forEach((value) => {
    const th = node('th', value);
    th.scope = 'col';
    header.append(th);
  });
  head.append(header);
  const body = node('tbody');
  rows.forEach((values) => {
    const row = node('tr');
    values.forEach((value) => row.append(node('td', String(value))));
    body.append(row);
  });
  element.append(head, body);
  wrap.append(element);
  return wrap;
}

function card(title, description, className = '') {
  const element = node('section', '', `telemetry-card ${className}`.trim());
  element.append(node('h2', title), node('p', description, 'telemetry-description'));
  return element;
}

function bars(items, { percent = false } = {}) {
  const list = node('ul', '', 'telemetry-bars');
  const max = Math.max(1, ...items.map((item) => item.value ?? 0));
  items.forEach((item) => {
    const row = node('li');
    const label = node('div', '', 'telemetry-bar-label');
    label.append(node('span', item.label), node('strong', item.display));
    const track = node('div', '', 'telemetry-bar-track');
    track.setAttribute('aria-hidden', 'true');
    if (item.value === null) {
      track.dataset.missing = 'true';
    } else {
      const fill = node('div', '', 'telemetry-bar-fill');
      fill.style.width = `${(item.value / (percent ? 100 : max)) * 100}%`;
      if (item.brand) fill.dataset.brand = item.brand;
      track.append(fill);
    }
    row.append(label, track);
    list.append(row);
  });
  return list;
}

function metricCard(label, value, detail, featured = false) {
  const element = node('section', '', `telemetry-kpi${featured ? ' telemetry-kpi-featured' : ''}`);
  element.append(
    node('h2', label),
    node('p', value, 'telemetry-kpi-value'),
    node('p', detail, 'telemetry-description'),
  );
  return element;
}

function detailTable(title, headings, rows) {
  const details = node('details', '', 'telemetry-detail');
  details.append(node('summary', title), table(headings, rows, title));
  return details;
}

export default function decorate(block) {
  const header = node('div', '', 'telemetry-header');
  const identity = node('div');
  identity.append(
    node('p', 'ADOBE MAX / BOOTH INSIGHTS', 'telemetry-eyebrow'),
    node('h1', 'MAX staff journey telemetry'),
    node('p', 'A clearer picture of every attendee journey.', 'telemetry-subtitle'),
  );
  const tools = node('div', '', 'telemetry-tools');
  const settings = node('a', 'Booth settings / update telemetry access');
  settings.href = '/drafts/kiosk-settings.html';
  tools.append(node('span', 'Private data · Manual refresh', 'telemetry-badge'), settings);
  header.append(identity, tools);
  const intro = node('p', 'Private Azure data requires valid access saved in this browser on this origin. Graph visibility measures tab-switch proxies, not Firefly activity. Final brand choice is not confirmation of physical printing.', 'telemetry-privacy');
  block.replaceChildren(header, intro);
  const form = node('form', '', 'telemetry-filters');
  const filterHeading = node('div', '', 'telemetry-section-heading');
  filterHeading.append(
    node('h2', 'Report filters'),
    node('span', 'Defaults to completed, non-test journeys', 'telemetry-description'),
  );
  const fields = node('div', '', 'telemetry-filter-grid');
  form.append(filterHeading, fields);
  const input = (label, type = 'text') => {
    const field = node('label', label);
    const control = node('input');
    control.type = type;
    field.append(control);
    if (type === 'checkbox') field.className = 'telemetry-checkbox';
    fields.append(field);
    return control;
  };
  const start = input('Journey start from (UTC)', 'datetime-local');
  const end = input('Journey start through (UTC)', 'datetime-local');
  const zone = input('Display / event-day timezone (IANA)');
  zone.value = 'UTC';
  const day = input('Event day (in display timezone; optional)', 'date');
  const station = input('Station ID (optional, e.g. MAX-01)');
  const tests = input('Include setup/test journeys', 'checkbox');
  const outcomeLabel = node('label', 'Outcome');
  const outcome = node('select');
  [['completed', 'Completed (default)'], ['reset', 'Reset'], ['interrupted', 'Interrupted'], ['active', 'Active'], ['', 'All outcomes']]
    .forEach(([value, label]) => outcome.append(new Option(label, value)));
  outcomeLabel.append(outcome);
  fields.append(outcomeLabel);
  const refresh = node('button', 'Refresh report from Azure');
  refresh.type = 'button';
  const apply = node('button', 'Apply filters');
  apply.type = 'submit';
  const csv = node('button', 'Export filtered CSV');
  csv.type = 'button';
  csv.disabled = true;
  refresh.className = 'telemetry-primary';
  const actions = node('div', '', 'telemetry-actions');
  actions.append(refresh, apply, csv);
  form.append(actions);
  const status = node('p', 'No report loaded. Choose filters, then refresh.', 'telemetry-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const scope = node('div', '', 'telemetry-scope');
  const results = node('div');
  results.className = 'kiosk-telemetry-results';
  const empty = (title, description) => {
    const panel = node('div', '', 'telemetry-empty');
    const glyph = node('div', '', 'telemetry-empty-chart');
    glyph.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 4; index += 1) glyph.append(node('span'));
    panel.append(glyph, node('h2', title), node('p', description));
    results.replaceChildren(panel);
  };
  empty('Your event, at a glance', 'Refresh to load your private report. Journey timings, brand preferences and station activity will appear here.');
  block.append(form, status, scope, results);
  let settingsValue;
  let source;
  let filtered = [];
  let applied;
  let fetchedAt;
  const filters = () => {
    new Intl.DateTimeFormat('en', { timeZone: zone.value.trim() }).format();
    const from = start.value ? new Date(`${start.value}Z`).toISOString() : '';
    const until = end.value ? new Date(`${end.value}Z`).toISOString() : '';
    if (from && until && from > until) throw new Error('Start must be before end.');
    if (station.value && !/^MAX-(?:0[1-9]|[1-9][0-9])$/.test(station.value.trim())) {
      throw new Error('Use a station ID such as MAX-01.');
    }
    return {
      eventId: settingsValue.eventId,
      timeZone: zone.value.trim(),
      start: from,
      end: until,
      day: day.value,
      station: station.value.trim(),
      includeTests: tests.checked,
      outcome: outcome.value,
    };
  };
  const seconds = (value) => (value === null ? 'Not observed' : `${(value / 1000).toFixed(1)} s`);
  const render = () => {
    applied = filters();
    filtered = filterJourneys(source.snapshots, applied);
    const summary = summarizeJourneys(filtered);
    status.dataset.state = source.incomplete ? 'warning' : 'success';
    status.textContent = `${source.incomplete ? 'INCOMPLETE / CAPPED SNAPSHOT — not event-wide statistics.' : 'Complete fetched snapshot.'} Event: ${applied.eventId}. Timezone: ${applied.timeZone}. Journey start window UTC: ${applied.start || 'unbounded'} → ${applied.end || 'unbounded'}. Event day: ${applied.day || 'all'}. Station: ${applied.station || 'all'}. Tests: ${applied.includeTests ? 'included' : 'excluded'}. Outcome: ${applied.outcome || 'all'}. ${filtered.length} journeys; ${source.snapshots.length}/${source.candidates} candidate journeys read; ${source.listed} snapshot blobs listed. Reloaded/cross-document or anomalous timings are excluded from duration samples, not counted as zero.`;
    scope.replaceChildren(
      node('span', applied.eventId, 'telemetry-event'),
      node('span', applied.timeZone),
      node('span', applied.outcome || 'All outcomes'),
      node('span', applied.includeTests ? 'Tests included' : 'Tests excluded'),
      node('span', `Fetched ${new Intl.DateTimeFormat('en', {
        timeZone: applied.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(fetchedAt)}`),
    );
    const groups = [
      ['Selected window', filtered],
      ...[...new Set(filtered.map((item) => item.stationId))].sort()
        .map((id) => [id, filtered.filter((item) => item.stationId === id)]),
      ...[...new Set(filtered.map((item) => eventDay(item.startedAt, applied.timeZone)))].sort()
        .map((date) => [`Day ${date}`, filtered
          .filter((item) => eventDay(item.startedAt, applied.timeZone) === date)]),
    ];
    const metrics = groups.flatMap(([label, items]) => (
      Object.entries(summarizeJourneys(items).metrics)
        .map(([metric, values]) => [label, METRICS[metric], values.count,
          seconds(values.median), seconds(values.mean), seconds(values.p90)])
    ));
    const dates = new Intl.DateTimeFormat('en', { timeZone: applied.timeZone, dateStyle: 'medium', timeStyle: 'medium' });
    const display = (value) => (value ? dates.format(new Date(value)) : 'Not observed');
    const stations = new Set(filtered.map((item) => item.stationId)).size;
    const kpis = node('div', '', 'telemetry-kpis');
    kpis.append(
      metricCard('Journeys in view', String(summary.count), `${applied.outcome || 'All outcomes'} · latest revision per journey`, true),
      metricCard('Median journey', seconds(summary.metrics.selectedToPostcard.median), `${summary.metrics.selectedToPostcard.count} observed · portrait to usable postcard`),
      metricCard('Median final loading', seconds(summary.metrics.finalLoading.median), `${summary.metrics.finalLoading.count} observed · Finish to usable postcard`),
      metricCard('Stations represented', String(stations), 'Distinct stations in the filtered snapshot'),
    );
    const charts = node('div', '', 'telemetry-charts');
    const brandCard = card('The brand leaderboard', 'Final ad choice · one vote per latest filtered journey', 'telemetry-brands');
    const brandLayout = node('div', '', 'telemetry-brand-layout');
    const donut = node('div', '', 'telemetry-donut');
    donut.setAttribute('aria-hidden', 'true');
    let position = 0;
    const stops = summary.brands.map((brand) => {
      const startAt = position;
      position += brand.percent;
      return `var(--telemetry-${brand.brand}) ${startAt}% ${position}%`;
    });
    donut.style.background = summary.count ? `conic-gradient(${stops.join(',')})` : 'var(--telemetry-track)';
    const total = node('div', '', 'telemetry-donut-total');
    total.append(node('strong', String(summary.count)), node('span', 'journeys'));
    donut.append(total);
    brandLayout.append(donut, bars(summary.brands.map((brand) => ({
      label: BRANDS[brand.brand],
      value: brand.percent,
      display: `${brand.count} · ${brand.percent.toFixed(1)}%`,
      brand: brand.brand,
    })), { percent: true }));
    brandCard.append(
      brandLayout,
      node('p', 'Unknown choices are included in percentages. Selection is not physical print success.', 'telemetry-footnote'),
      detailTable(
        'Brand ranking data',
        ['Rank', 'Brand', 'Journeys', 'Percent'],
        summary.brands.map((brand, index) => [
          index + 1, BRANDS[brand.brand], brand.count, `${brand.percent.toFixed(1)}%`,
        ]),
      ),
    );
    const timingCard = card('Where the time goes', 'Median durations · independent measurements, not additive stages');
    timingCard.append(bars(Object.entries(summary.metrics).map(([key, values]) => ({
      label: METRICS[key],
      value: values.median,
      display: `${seconds(values.median)} · n=${values.count}`,
    }))), node('p', 'Graph metrics are cumulative visibility proxies. Missing observations are never plotted as zero. Reloaded or anomalous timings are excluded.', 'telemetry-footnote'));
    const stationCard = card('Across the booth', 'Journey volume by station · current filters');
    stationCard.append(bars(groups.slice(1).filter(([label]) => label.startsWith('MAX-'))
      .map(([label, items]) => ({ label, value: items.length, display: String(items.length) }))));
    const dayCard = card('Event rhythm', `Journey volume by day · ${applied.timeZone}`);
    dayCard.append(bars(groups.slice(1).filter(([label]) => label.startsWith('Day '))
      .map(([label, items]) => ({
        label: label.slice(4), value: items.length, display: String(items.length),
      }))));
    [stationCard, dayCard].forEach((panel) => {
      if (!filtered.length) panel.append(node('p', 'No journeys match these filters.', 'telemetry-footnote'));
    });
    charts.append(brandCard, timingCard, stationCard, dayCard);
    results.replaceChildren(
      kpis,
      charts,
      detailTable(
        'Duration details · window, station and day',
        ['Scope', 'Metric', 'Observed count', 'Median', 'Mean', 'p90'],
        metrics,
      ),
      detailTable(
        'Journey milestones · display timezone',
        ['Station', 'Test', 'Outcome', 'Selected', 'Finish', 'Postcard usable', 'Graph proxy', 'Observed returns', 'Timing'],
        filtered.map((item) => [item.stationId, item.isTest, item.outcome, display(item.startedAt),
          display(item.milestones.finishClicked), display(item.milestones.postcardUsable),
          item.graph.status, item.graph.returnCount, item.timingQuality]),
      ),
    );
    csv.disabled = false;
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try { if (source) render(); } catch {
      status.dataset.state = 'error';
      status.textContent = 'Invalid filter or timezone. Check UTC start/end and IANA timezone. Charts still show the last applied filters.';
      csv.disabled = true;
    }
  });
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    csv.disabled = true;
    results.replaceChildren();
    scope.replaceChildren();
    source = null;
    results.setAttribute('aria-busy', 'true');
    try {
      settingsValue = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      const credentials = telemetryCredentials(settingsValue);
      if (credentials.status !== 'ready') throw new Error('Telemetry access is not configured, invalid or expired. Update it in booth settings.');
      filters();
      status.dataset.state = 'loading';
      status.textContent = 'Reading a bounded snapshot from private telemetry storage…';
      empty('Gathering your event insights', 'Loading a bounded snapshot. You can continue using the kiosks; this report never polls automatically.');
      source = await readTelemetryReport(credentials, settingsValue.eventId);
      fetchedAt = new Date();
      render();
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.message === 'Telemetry access is not configured, invalid or expired. Update it in booth settings.'
        ? error.message : 'Report could not load. Check event, filters, telemetry access and CORS in booth settings.';
      empty('Report unavailable', 'Check your saved telemetry access in booth settings, then refresh again. No attendee experience is affected.');
    } finally {
      refresh.disabled = false;
      results.setAttribute('aria-busy', 'false');
    }
  });
  csv.addEventListener('click', () => {
    if (!source || !applied) return;
    const metadata = JSON.stringify({ ...applied, incomplete: source.incomplete });
    const content = `Report scope,"${metadata.replaceAll('"', '""')}"\r\n${journeyCSV(filtered)}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = node('a');
    link.href = url;
    link.download = 'max-journey-report.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  try {
    const prefs = telemetryPreferences(localStorage);
    if (prefs) zone.value = prefs.timeZone;
  } catch { status.textContent = 'Saved telemetry timezone is invalid. Enter an IANA timezone before refreshing.'; }
}
