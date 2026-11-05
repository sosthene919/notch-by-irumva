export interface BusEvent<T = unknown> {
  type: string;
  priority: number;
  payload: T;
}

interface Queued extends BusEvent {
  seq: number;
}

type Handler = (event: BusEvent) => void;

/**
 * Bounded priority event bus (brief section 6).
 * - Delivery order: priority descending, then insertion order.
 * - Bounded: when the queue is full the oldest queued event is dropped
 *   (drop-oldest) and counted, so a burst can never grow memory unbounded.
 * - Handlers that publish re-entrantly are queued, not recursed.
 */
export class EventBus {
  readonly capacity: number;
  private queue: Queued[] = [];
  private handlers = new Map<string, Set<Handler>>();
  private seq = 0;
  private flushing = false;
  stats = { published: 0, dropped: 0, delivered: 0 };

  constructor(capacity = 256) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
    this.capacity = capacity;
  }

  on(type: string, handler: Handler): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => set.delete(handler);
  }

  get pending(): number { return this.queue.length; }

  publish(event: BusEvent): 'queued' | 'dropped-oldest' {
    this.stats.published++;
    let result: 'queued' | 'dropped-oldest' = 'queued';
    if (this.queue.length >= this.capacity) {
      this.queue.shift(); // drop oldest
      this.stats.dropped++;
      result = 'dropped-oldest';
    }
    this.queue.push({ ...event, seq: this.seq++ });
    if (!this.flushing) this.flush();
    return result;
  }

  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0).sort((a, b) => b.priority - a.priority || a.seq - b.seq);
        for (const event of batch) {
          this.stats.delivered++;
          for (const h of this.handlers.get(event.type) ?? []) h(event);
          for (const h of this.handlers.get('*') ?? []) h(event);
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
