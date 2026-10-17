export interface ConnectionInfo {
  /** Base URL of the on-device server, always loopback. */
  url: string;
  /** Basic-auth username ("opencode"). */
  username: string;
  /** Random per-launch password. Held in memory only; never written to disk or logs. */
  password: string;
  /** Server process state. */
  state: 'starting' | 'ready' | 'stopped' | 'failed';
  /** Last failure detail when state === 'failed'. */
  error?: string;
}

export interface EmbeddedServerPlugin {
  /**
   * Start the foreground service and the node server if not already running.
   * Resolves once /api/info answers 200 with the generated credentials.
   */
  start(): Promise<ConnectionInfo>;
  /** Stop the server and the foreground service. */
  stop(): Promise<{ state: string }>;
  /** Current state without changing anything. */
  status(): Promise<ConnectionInfo>;
  /** Fired on every state transition, including 'failed'. */
  addListener(
    eventName: 'state',
    listenerFunc: (info: ConnectionInfo) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
