/** Serialize writes per conversation, coalescing streaming snapshots without reordering. */
export class SessionCache {
  private latest = new Map<string, unknown>();
  private running = new Map<string, Promise<void>>();
  private fingerprints = new Map<string, string>();
  constructor(private write: (key: string, value: any) => Thenable<void>, private failed: (key: string) => void) {}
  save(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (this.fingerprints.get(key) === serialized) return this.running.get(key) || Promise.resolve();
    this.fingerprints.set(key, serialized);
    this.latest.set(key, JSON.parse(serialized));
    const current = this.running.get(key); if (current) return current;
    const task = Promise.resolve().then(async () => {
      while (this.latest.has(key)) {
        const snapshot = this.latest.get(key); this.latest.delete(key);
        try { await this.write(key, snapshot); }
        catch (error) { this.fingerprints.delete(key); this.failed(key); throw error; }
      }
    }).finally(() => this.running.delete(key));
    this.running.set(key, task); return task;
  }
  async flush() { await Promise.all([...this.running.values()]); }
}
