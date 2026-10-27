// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// models.js: AI roster, @mention parsing, and demo replies.
// NOTE: askModel() is a local stub. The backend integration point is this
// single function: keep its signature and swap the body for a real call.

export const AI_MODELS = [
  { handle: 'planner', name: 'Planner', desc: 'Itineraries, options, next steps' },
  { handle: 'summarizer', name: 'Summarizer', desc: 'Recaps the thread so far' },
  { handle: 'decider', name: 'Decider', desc: 'Turns opinions into a decision' },
];

export function modelByHandle(handle) {
  return AI_MODELS.find((m) => m.handle === String(handle).toLowerCase()) || null;
}

/** Find @handles in text that match known models, in order, deduplicated. */
export function findMentions(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text).matchAll(/@([A-Za-z0-9_]+)/g)) {
    const model = modelByHandle(m[1]);
    if (model && !seen.has(model.handle)) {
      seen.add(model.handle);
      out.push(model);
    }
  }
  return out;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask a model. `history` is recent message objects (oldest first).
 * Returns the reply text. Currently a deterministic local stub.
 */
export async function askModel(model, question, history) {
  await delay(700 + Math.random() * 600);
  const humans = history.filter((m) => m.kind !== 'ai').slice(-12);
  switch (model.handle) {
    case 'summarizer':
      return summarize(humans);
    case 'decider':
      return decide(question, humans);
    case 'planner':
    default:
      return plan(question, humans);
  }
}

function summarize(humans) {
  if (humans.length === 0) return 'Nothing to recap yet — the thread is just getting started.';
  const speakers = [...new Set(humans.map((m) => m.author))];
  const last = humans.slice(-3).map((m) => `• ${m.author}: ${m.text}`).join('\n');
  return `Recap (${humans.length} messages from ${speakers.join(', ')}):\n${last}\n\nOpen questions and decisions are still with the group — @decider can help settle one.`;
}

function decide(question, humans) {
  const opinions = humans.slice(-6).map((m) => `• ${m.author} leans: "${truncate(m.text, 90)}"`).join('\n') ||
    '• no opinions yet';
  return `Here's my read on "${truncate(question, 120) || 'the open question'}":\n${opinions}\n\nProposal: go with the option that has the most support, and time-box it — if nobody objects in 24h, it's decided. Want me to list pros/cons for the top two options?`;
}

function plan(question, humans) {
  const topic = truncate(question.replace(/@\w+/g, '').trim(), 120) || 'your plan';
  const headcount = new Set(humans.map((m) => m.author)).size;
  return `Planning help for "${topic}" (${headcount} ${headcount === 1 ? 'voice' : 'voices'} in so far):\n` +
    `1. Lock the date and headcount first — everything else depends on it.\n` +
    `2. Shortlist 2–3 options with one cost estimate each.\n` +
    `3. @decider can call the final pick; I'll turn it into a checklist.\n\nTell me dates + budget and I'll draft the day-by-day.`;
}

function truncate(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
