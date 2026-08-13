export type ChatDesignFixtureDirection = 'ltr' | 'rtl';
export type ChatDesignFixtureScreen = 'inbox' | 'inbox-empty' | 'requests' | 'thread' | 'thread-request';

export type ChatDesignFixtureState = {
  direction: ChatDesignFixtureDirection;
  id: string;
  locale: string;
  screen: ChatDesignFixtureScreen;
};

export type ChatDesignFixtureCatalog = {
  notice: string;
  states: ChatDesignFixtureState[];
  version: string;
};

/** Parses disposable fixture metadata only; it never supplies authorization data. */
export function mapChatDesignFixtureCatalog(value: unknown): ChatDesignFixtureCatalog | undefined {
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.notice !== 'string' || !Array.isArray(value.states)) return undefined;
  const states = value.states.map(mapState).filter(isPresent);
  if (states.length !== value.states.length || states.length === 0) return undefined;
  return { notice: value.notice, states, version: value.version };
}

function mapState(value: unknown): ChatDesignFixtureState | undefined {
  if (!isRecord(value)) return undefined;
  const direction = value.direction;
  const screen = value.screen;
  if (direction !== 'ltr' && direction !== 'rtl') return undefined;
  if (!['inbox', 'inbox-empty', 'requests', 'thread', 'thread-request'].includes(String(screen))) return undefined;
  if (typeof value.id !== 'string' || typeof value.locale !== 'string') return undefined;
  return { direction, id: value.id, locale: value.locale, screen: screen as ChatDesignFixtureScreen };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
