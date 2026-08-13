type ChatOutcome = 'failure' | 'success';
type ChatAttributes = Record<string, unknown>;

type TelemetryAdapter = {
  breadcrumb: (message: string, data: ChatAttributes) => void;
  start: (name: string, attributes: ChatAttributes) => { finish: (outcome: ChatOutcome, errorCode?: string) => void };
};

const noOpAdapter: TelemetryAdapter = {
  breadcrumb: () => undefined,
  start: () => ({ finish: () => undefined }),
};

let adapter = noOpAdapter;

export function setPersonalChatTelemetryAdapter(next: TelemetryAdapter) {
  adapter = next;
}

export function startPersonalChatOperation(name: string, attributes: ChatAttributes = {}) {
  return adapter.start(name, attributes);
}

export function recordPersonalChatBreadcrumb(message: string, data: ChatAttributes = {}) {
  adapter.breadcrumb(message, data);
}
