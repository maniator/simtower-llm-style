/**
 * Game clock. Tracks elapsed in-game minutes and exposes day/time helpers.
 *
 * SimTower runs Monday..Sunday with distinct weekday/weekend behavior, a
 * morning rush, a lunch peak and an evening exodus. One in-game day is 24h.
 */
export class Clock {
  /** Total elapsed in-game minutes since the tower was founded. */
  minutes: number;

  constructor(minutes = 0) {
    // Start the world at Monday 07:00 so the first morning rush is imminent.
    this.minutes = minutes === 0 ? 7 * 60 : minutes;
  }

  /** Minute within the current day, 0..1439. */
  get minuteOfDay(): number {
    return ((this.minutes % 1440) + 1440) % 1440;
  }

  get hour(): number {
    return Math.floor(this.minuteOfDay / 60);
  }

  get minute(): number {
    return Math.floor(this.minuteOfDay % 60);
  }

  /** Days elapsed (0-indexed). */
  get day(): number {
    return Math.floor(this.minutes / 1440);
  }

  /** 0 = Monday .. 6 = Sunday. */
  get dayOfWeek(): number {
    return this.day % 7;
  }

  get isWeekend(): boolean {
    return this.dayOfWeek >= 5;
  }

  /** Quarter index 0..3 used for office rent collection. */
  get quarter(): number {
    return Math.floor((this.day % 360) / 90);
  }

  get dayName(): string {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][this.dayOfWeek];
  }

  /** Advance the clock by a number of minutes. */
  advance(min: number): void {
    this.minutes += min;
  }

  /** Formatted clock e.g. "Mon 07:00". */
  format(): string {
    const h = this.hour.toString().padStart(2, "0");
    const m = this.minute.toString().padStart(2, "0");
    return `${this.dayName} ${h}:${m}`;
  }

  /** True once per new day boundary crossing handled by Simulation. */
  isMorning(): boolean {
    return this.hour >= 7 && this.hour < 10;
  }

  isLunch(): boolean {
    return this.hour >= 11 && this.hour < 14;
  }

  isEvening(): boolean {
    return this.hour >= 17 && this.hour < 21;
  }

  isNight(): boolean {
    return this.hour >= 21 || this.hour < 6;
  }
}
