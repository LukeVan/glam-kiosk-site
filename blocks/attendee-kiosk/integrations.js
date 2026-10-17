export function send(frame, integration, message) {
  if (integration.enabled && frame?.contentWindow) {
    frame.contentWindow.postMessage(message, integration.origin);
  }
}

export function coworkerReady(event, source, integration) {
  return integration.enabled && !!source && event.source === source
    && event.origin === integration.origin
    && event.data !== null && typeof event.data === 'object'
    && !Array.isArray(event.data) && event.data.type === 'KIOSK_READY';
}

export function navigation(event, source, integration, stage) {
  if (!integration.enabled || !source || event.source !== source
    || event.origin !== integration.origin
    || !event.data || typeof event.data !== 'object'
    || event.data.type !== 'KIOSK_NAV') return null;
  if (!['story', 'continued'].includes(stage)) return null;
  if (event.data.target === 'view-graph-return') return 'pacing';
  if (event.data.target === 'view-select') return 'ads';
  if (['view-variations-max', 'view-processing-max'].includes(event.data.target)
    && stage === 'continued') return 'variations';
  return null;
}

export function storyBeat(event, source, integration, stage) {
  const beats = stage === 'story' ? ['home', 'overview', 'brief', 'performance', 'creative']
    : ['simulate', 'results'];
  if (!['story', 'continued'].includes(stage) || !integration.enabled || !source || event.source !== source
    || event.origin !== integration.origin || !event.data || typeof event.data !== 'object'
    || Array.isArray(event.data) || event.data.type !== 'KIOSK_STORY_BEAT'
    || !beats.includes(event.data.beat)) return null;
  return event.data.beat;
}

export function graphReturn(event, source, integration, state) {
  return integration.enabled && !!source && event.source === source
    && event.origin === integration.origin && event.data?.type === 'GLAM_GRAPH_RETURN'
    && event.data.sessionId === state.sessionId
    && event.data.portraitId === state.portraitId && state.stage === 'graph';
}
