const MUTE_KEY = "flybike.muted.v1";

export class GameAudio {
  private context?: AudioContext;
  private muted = localStorage.getItem(MUTE_KEY) === "true";

  isMuted(): boolean {
    return this.muted;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, String(this.muted));
    return this.muted;
  }

  play(kind: "score" | "crash" | "start"): void {
    if (this.muted) return;
    this.context ??= new AudioContext();
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    const frequencies = { score: 660, crash: 100, start: 440 };
    oscillator.type = kind === "crash" ? "sawtooth" : "square";
    oscillator.frequency.setValueAtTime(frequencies[kind], now);
    if (kind === "start") oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  }
}
