import type {
  RoomType,
  FloorData,
  PlacementResult,
  GameEvent,
  PersonRole,
  PersonState,
  ElevatorType,
  EventType,
  IRoom,
} from "./types.js";

const BASE_TICK_MS: number = 220;
const MINUTES_PER_DAY: number = 1440;
const START_TIME: number = 7 * 60;

const EVENT_TYPES: readonly EventType[] = [
  "fire",
  "breakdown",
  "crime",
  "medical",
  "complaint",
  "vip",
] as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const formatMoney = (value: number): string =>
  `$${Math.round(value).toLocaleString("en-US")}`;

export class Room implements IRoom {
  public type: RoomType;
  public floorIndex: number;
  public startX: number;
  public endX: number;
  public buildRemaining: number;
  public active: boolean;
  public cleanliness: number;

  constructor(type: RoomType, floorIndex: number, startX: number) {
    this.type = type;
    this.floorIndex = floorIndex;
    this.startX = startX;
    this.endX = startX + type.width - 1;
    this.buildRemaining = type.buildTime;
    this.active = false;
    this.cleanliness = 100;
  }

  tickConstruction(): void {
    if (this.active) return;
    this.buildRemaining -= 1;
    if (this.buildRemaining <= 0) {
      this.active = true;
      this.buildRemaining = 0;
    }
  }
}

class Person {
  public role: PersonRole;
  public origin: number;
  public target: number;
  public elevatorType: ElevatorType;
  public waitTime: number;
  public state: PersonState;

  constructor(
    role: PersonRole,
    origin: number,
    target: number,
    elevatorType: ElevatorType,
  ) {
    this.role = role;
    this.origin = origin;
    this.target = target;
    this.elevatorType = elevatorType;
    this.waitTime = 0;
    this.state = "waiting";
  }
}

class ElevatorCar {
  public type: ElevatorType;
  public shaftX: number;
  public capacity: number;
  public passengers: Person[];
  public direction: number;
  public position: number;
  public baseSpeed: number;
  public speed: number;
  public stops: Set<number>;
  public doorTimer: number;
  public idle: boolean;

  constructor(type: ElevatorType, shaftX: number, capacity: number) {
    this.type = type;
    this.shaftX = shaftX;
    this.capacity = capacity;
    this.passengers = [];
    this.direction = 1;
    this.position = 0;
    this.baseSpeed = 0.2;
    this.speed = this.baseSpeed;
    this.stops = new Set<number>();
    this.doorTimer = 0;
    this.idle = true;
  }

  addStop(floorIndex: number): void {
    this.stops.add(floorIndex);
    this.idle = false;
  }

  isAvailable(): boolean {
    return this.passengers.length < this.capacity;
  }
}

export class Game {
  public roomTypes: Readonly<Record<string, RoomType>>;
  public width: number;
  public floors: Map<number, FloorData>;
  public minFloor: number;
  public maxFloor: number;
  public money: number;
  public population: number;
  public happiness: number;
  public rating: number;
  public day: number;
  public time: number;
  public speed: number;
  public paused: boolean;
  public accumulator: number;
  public people: Person[];
  public elevators: ElevatorCar[];
  public events: GameEvent[];
  public statusMessage: string;
  public waitSamples: number[];
  public vipPassed: boolean;
  public lastVipDay: number;

  constructor(roomTypes: Readonly<Record<string, RoomType>>) {
    this.roomTypes = roomTypes;
    this.width = 28;
    this.floors = new Map<number, FloorData>();
    this.minFloor = 0;
    this.maxFloor = 0;
    this.money = 180000;
    this.population = 0;
    this.happiness = 70;
    this.rating = 1;
    this.day = 1;
    this.time = START_TIME;
    this.speed = 1;
    this.paused = false;
    this.accumulator = 0;
    this.people = [];
    this.elevators = [];
    this.events = [];
    this.statusMessage = "";
    this.waitSamples = [];
    this.vipPassed = false;
    this.lastVipDay = 0;
    this.initTower();
  }

  private initTower(): void {
    this.ensureFloor(0);
    this.placeRoom("lobby", 0, 10, true);
    this.placeRoom("elevator_standard", 0, 16, true);
  }

  private ensureFloor(index: number): void {
    if (!this.floors.has(index)) {
      this.floors.set(index, {
        index,
        cells: Array(this.width).fill(null) as (Room | null)[],
        rooms: [],
        traffic: 0,
        noise: 0,
        cleanliness: 100,
        waitAverage: 0,
      });
      this.minFloor = Math.min(this.minFloor, index);
      this.maxFloor = Math.max(this.maxFloor, index);
    }
  }

  public getFloor(index: number): FloorData {
    this.ensureFloor(index);
    return this.floors.get(index)!;
  }

  public placeRoom(
    typeId: string,
    floorIndex: number,
    startX: number,
    skipCost: boolean = false,
  ): PlacementResult {
    const type = this.roomTypes[typeId];
    if (!type) return { ok: false, reason: "Unknown room." };
    if (!skipCost && this.money < type.cost) {
      return { ok: false, reason: "Not enough money." };
    }
    if (startX < 0 || startX + type.width > this.width) {
      return { ok: false, reason: "Out of bounds." };
    }
    if (type.unlock > this.rating) {
      return { ok: false, reason: `Unlock at ${type.unlock}-star rating.` };
    }
    if (type.rules?.groundOnly && floorIndex !== 0) {
      return { ok: false, reason: "Must be on ground floor." };
    }
    if (type.rules?.basementOnly && floorIndex >= 0) {
      return { ok: false, reason: "Must be in basement." };
    }
    if (
      type.rules?.minFloors &&
      this.maxFloor - this.minFloor + 1 < type.rules.minFloors
    ) {
      return { ok: false, reason: "Need a taller tower." };
    }
    if (type.category === "Residential" && floorIndex !== 0) {
      const belowFloor = this.floors.get(floorIndex - 1);
      if (!belowFloor || belowFloor.rooms.length === 0) {
        return { ok: false, reason: "Residences need support below." };
      }
    }
    const floor = this.getFloor(floorIndex);
    for (let x = startX; x < startX + type.width; x += 1) {
      if (floor.cells[x]) {
        return { ok: false, reason: "Space occupied." };
      }
    }
    const room = new Room(type, floorIndex, startX);
    floor.rooms.push(room);
    for (let x = startX; x < startX + type.width; x += 1) {
      floor.cells[x] = room;
    }
    if (!skipCost) {
      this.money -= type.cost;
    }
    if (type.shaft) {
      this.addElevator(type, startX);
    }
    return { ok: true, room };
  }

  public removeRoom(
    floorIndex: number,
    cellX: number,
  ): { ok: boolean; reason?: string; refund?: number } {
    const floor = this.getFloor(floorIndex);
    const room = floor.cells[cellX];
    if (!room) return { ok: false, reason: "No room here." };
    if (room.active)
      return { ok: false, reason: "Cannot remove completed buildings." };
    for (let x = room.startX; x <= room.endX; x += 1) {
      floor.cells[x] = null;
    }
    floor.rooms = floor.rooms.filter((r) => r !== room);
    const refund = Math.round(
      room.type.cost * 0.5 * (1 - room.buildRemaining / room.type.buildTime),
    );
    this.money += refund;
    return { ok: true, refund };
  }

  private addElevator(type: RoomType, shaftX: number): void {
    if (type.elevatorType === "stairs") return;
    const car = new ElevatorCar(
      type.elevatorType as ElevatorType,
      shaftX,
      type.capacity || 8,
    );
    car.position = 0;
    this.elevators.push(car);
  }

  public update(deltaMs: number): void {
    if (this.paused || this.speed === 0) return;
    this.accumulator += deltaMs * this.speed;
    while (this.accumulator >= BASE_TICK_MS) {
      this.stepMinute();
      this.accumulator -= BASE_TICK_MS;
    }
  }

  private stepMinute(): void {
    this.time += 1;
    if (this.time >= MINUTES_PER_DAY) {
      this.time = 0;
      this.day += 1;
      this.endOfDay();
    }

    for (const floor of this.floors.values()) {
      for (const room of floor.rooms) {
        room.tickConstruction();
      }
    }

    this.updatePeople();
    this.updateElevators();
    this.updateEvents();

    if (this.time % 60 === 0) {
      this.onHourChange();
    }
  }

  private onHourChange(): void {
    this.applyEconomy();
    this.spawnTraffic();
    this.updateHappiness();
    this.updateRating();
  }

  private applyEconomy(): void {
    let income = 0;
    let maintenance = 0;
    const janitorial = this.findRoomsByCategory(
      "Services",
      "janitorial",
    ).length;
    for (const floor of this.floors.values()) {
      for (const room of floor.rooms) {
        maintenance += room.type.maintenance;
        if (room.active) {
          const trafficFactor = 1 + floor.traffic / 30;
          income += room.type.revenue * trafficFactor;
        }
      }
      if (janitorial > 0) {
        for (const room of floor.rooms) {
          room.cleanliness = clamp(
            room.cleanliness + janitorial * 0.6,
            40,
            100,
          );
        }
      }
      floor.traffic = 0;
      floor.noise = 0;
    }
    this.money += income - maintenance;
  }

  private spawnTraffic(): void {
    const hour = Math.floor(this.time / 60);
    this.people = this.people.filter((person) => person.state !== "done");
    const offices = this.findRoomsByCategory("Commercial", "office");
    const retail = this.findRoomsByCategory("Commercial");
    const hotels = this.findRoomsByCategory("Hotel");
    const entertainment = this.findRoomsByCategory("Entertainment");
    const services = this.findRoomsByCategory("Services");

    if (hour >= 7 && hour <= 9) {
      for (const room of offices) {
        this.spawnPerson("worker", 0, room.floorIndex);
      }
    }

    if (hour >= 17 && hour <= 19) {
      for (const room of offices) {
        this.spawnPerson("worker", room.floorIndex, 0);
      }
    }

    if (hour >= 11 && hour <= 14) {
      for (const room of retail) {
        this.spawnPerson("shopper", 0, room.floorIndex);
      }
    }

    if (hour >= 18 && hour <= 22) {
      for (const room of entertainment) {
        this.spawnPerson("guest", 0, room.floorIndex);
      }
    }

    if (hour === 15) {
      for (const room of hotels) {
        this.spawnPerson("hotel", 0, room.floorIndex);
      }
    }

    if (hour === 11) {
      for (const room of hotels) {
        this.spawnPerson("hotel", room.floorIndex, 0);
      }
    }

    if (hour === 10 || hour === 16) {
      const staffElevator: ElevatorType = this.elevators.some(
        (car) => car.type === "service",
      )
        ? "service"
        : "standard";
      for (const room of services) {
        this.spawnPerson("staff", 0, room.floorIndex, staffElevator);
      }
      for (const room of hotels) {
        this.spawnPerson("staff", 0, room.floorIndex, staffElevator);
      }
    }

    const residents = this.findRoomsByCategory("Residential");
    if (hour === 8) {
      for (const room of residents) {
        this.spawnPerson("resident", room.floorIndex, 0);
      }
    }
    if (hour === 18) {
      for (const room of residents) {
        this.spawnPerson("resident", 0, room.floorIndex);
      }
    }

    this.populateFromRooms();
  }

  private populateFromRooms(): void {
    let count = 0;
    for (const floor of this.floors.values()) {
      for (const room of floor.rooms) {
        if (room.active && room.type.category === "Residential") {
          count += room.type.capacity;
        }
        if (room.active && room.type.category === "Hotel") {
          count += Math.round(room.type.capacity * 0.6);
        }
      }
    }
    this.population = Math.max(this.population, count);
  }

  private chooseElevatorType(
    origin: number,
    target: number,
    role: PersonRole,
  ): ElevatorType {
    if (
      role === "staff" &&
      this.elevators.some((car) => car.type === "service")
    ) {
      return "service";
    }
    if (this.elevators.some((car) => car.type === "express")) {
      if (this.isExpressStop(origin) && this.isExpressStop(target)) {
        return "express";
      }
    }
    return "standard";
  }

  private spawnPerson(
    role: PersonRole,
    origin: number,
    target: number,
    elevatorType: ElevatorType | null = null,
  ): void {
    if (origin === target) return;
    const chosen =
      elevatorType || this.chooseElevatorType(origin, target, role);
    const person = new Person(role, origin, target, chosen);
    this.people.push(person);
    const floor = this.getFloor(origin);
    floor.traffic += 1;
  }

  private findRoomsByCategory(
    category: string,
    idFilter: string | null = null,
  ): Room[] {
    const rooms: Room[] = [];
    for (const floor of this.floors.values()) {
      for (const room of floor.rooms) {
        if (!room.active) continue;
        if (room.type.category === category) {
          if (!idFilter || room.type.id === idFilter) {
            rooms.push(room);
          }
        }
      }
    }
    return rooms;
  }

  private updatePeople(): void {
    for (const person of this.people) {
      if (person.state === "waiting") {
        person.waitTime += 1;
        const floor = this.getFloor(person.origin);
        floor.traffic += 1;
        if (person.waitTime > 60) {
          this.happiness = clamp(this.happiness - 1, 0, 100);
        }
      }
    }
  }

  private updateElevators(): void {
    for (const car of this.elevators) {
      if (car.doorTimer > 0) {
        car.doorTimer -= 1;
        if (car.doorTimer <= 0 && car.stops.size === 0) {
          car.idle = true;
        }
        continue;
      }

      if (car.stops.size === 0) {
        this.assignIdleElevator(car);
      }

      if (car.stops.size > 0) {
        const target = this.nextStop(car);
        if (target === null) {
          car.stops.clear();
          car.idle = true;
        } else {
          const delta = target - car.position;
          car.direction = delta >= 0 ? 1 : -1;
          car.position += car.speed * car.direction;
          if (Math.abs(target - car.position) < 0.05) {
            car.position = target;
            car.stops.delete(target);
            this.handleElevatorStop(car, target);
          }
        }
      }
    }
  }

  private assignIdleElevator(car: ElevatorCar): void {
    const pending = this.people.filter(
      (person) =>
        person.state === "waiting" && this.isElevatorTypeMatch(car, person),
    );
    if (pending.length === 0) return;
    const nearest = pending.reduce<{ person: Person; distance: number } | null>(
      (best, person) => {
        const distance = Math.abs(person.origin - car.position);
        if (!best || distance < best.distance) {
          return { person, distance };
        }
        return best;
      },
      null,
    );
    if (nearest) {
      car.addStop(nearest.person.origin);
    }
  }

  private nextStop(car: ElevatorCar): number | null {
    if (car.stops.size === 0) return null;
    const stops = Array.from(car.stops).sort((a, b) => a - b);
    if (car.direction >= 0) {
      return stops.find((stop) => stop >= car.position) ?? stops[0];
    }
    return (
      stops
        .slice()
        .reverse()
        .find((stop) => stop <= car.position) ?? stops[0]
    );
  }

  private handleElevatorStop(car: ElevatorCar, floorIndex: number): void {
    const floor = this.getFloor(floorIndex);
    const exiting = car.passengers.filter((p) => p.target === floorIndex);
    for (const person of exiting) {
      person.state = "done";
      person.waitTime = 0;
    }
    car.passengers = car.passengers.filter((p) => p.target !== floorIndex);

    const waiting = this.people.filter(
      (p) =>
        p.state === "waiting" &&
        p.origin === floorIndex &&
        this.isElevatorTypeMatch(car, p),
    );
    for (const person of waiting) {
      if (!car.isAvailable()) break;
      person.state = "riding";
      car.passengers.push(person);
      car.addStop(person.target);
      this.waitSamples.push(person.waitTime);
      person.waitTime = 0;
    }

    if (car.passengers.length === 0 && car.stops.size === 0) {
      car.idle = true;
    }
    car.doorTimer = 4;
    floor.traffic += waiting.length;
  }

  private isExpressStop(floorIndex: number): boolean {
    return Math.abs(floorIndex) % 5 === 0;
  }

  private isElevatorTypeMatch(car: ElevatorCar, person: Person): boolean {
    if (car.type === "service") return person.role === "staff";
    if (car.type === "express") {
      const expressAllowed =
        this.isExpressStop(person.origin) && this.isExpressStop(person.target);
      return (
        expressAllowed &&
        (person.elevatorType === "express" || person.role === "vip")
      );
    }
    return person.elevatorType === "standard" || person.role !== "staff";
  }

  private updateEvents(): void {
    if (this.events.length === 0 && this.time % 90 === 0) {
      this.scheduleEvent();
    }

    for (const car of this.elevators) {
      car.speed = car.baseSpeed;
    }

    const security = this.findRoomsByCategory("Services", "security").length;
    const medical = this.findRoomsByCategory("Services", "medical").length;
    const janitorial = this.findRoomsByCategory(
      "Services",
      "janitorial",
    ).length;

    for (const event of this.events) {
      let responseBoost = 0;
      if (event.type === "crime" && security > 0) responseBoost = 2;
      if (event.type === "medical" && medical > 0) responseBoost = 2;
      if (event.type === "fire" && janitorial > 0) responseBoost = 1;

      event.remaining -= 1 + responseBoost;

      if (event.type === "breakdown" && event.elevatorIndex !== null) {
        const car = this.elevators[event.elevatorIndex];
        if (car) {
          car.speed = car.baseSpeed * 0.35;
          car.doorTimer = Math.max(car.doorTimer, 3);
        }
      }
      if (event.type === "fire") {
        const floor = this.getFloor(event.floorIndex);
        for (const room of floor.rooms) {
          room.cleanliness = clamp(room.cleanliness - 0.4, 30, 100);
        }
      }
      if (event.type === "crime") {
        this.happiness = clamp(this.happiness - 0.2, 0, 100);
      }
      if (event.type === "complaint") {
        this.happiness = clamp(this.happiness - 0.1, 0, 100);
      }

      if (event.remaining <= 0 && event.type === "vip") {
        this.evaluateVip(event);
      }
    }
    this.events = this.events.filter((event) => event.remaining > 0);
  }

  private scheduleEvent(): void {
    const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
    if (type === "vip" && (this.rating < 3 || this.day === this.lastVipDay))
      return;
    if (type === "breakdown" && this.elevators.length === 0) return;
    const floorIndex = this.randomFloor();
    const duration = type === "vip" ? 120 : 90 + Math.floor(Math.random() * 60);
    const elevatorIndex =
      type === "breakdown"
        ? Math.floor(Math.random() * this.elevators.length)
        : null;
    this.events.push({ type, floorIndex, remaining: duration, elevatorIndex });
    if (type === "vip") {
      this.lastVipDay = this.day;
    }
  }

  private evaluateVip(_event: GameEvent): void {
    const waitAvg = this.averageWait();
    const success = this.happiness >= 70 && waitAvg <= 12;
    this.vipPassed = success;
    this.statusMessage = success
      ? "VIP impressed: rating boost ready."
      : "VIP disappointed: improve service and wait times.";
  }

  private updateHappiness(): void {
    let noise = 0;
    let cleanliness = 0;
    let roomCount = 0;
    for (const floor of this.floors.values()) {
      for (const room of floor.rooms) {
        if (!room.active) continue;
        noise += room.type.noise;
        cleanliness += room.cleanliness;
        roomCount += 1;
      }
    }
    const avgNoise = roomCount > 0 ? noise / roomCount : 0;
    const avgClean = roomCount > 0 ? cleanliness / roomCount : 100;
    const waitAvg = this.averageWait();
    const eventPenalty = this.events.length * 3;

    const base =
      78 + avgClean * 0.1 - avgNoise * 2 - waitAvg * 1.2 - eventPenalty;
    this.happiness = clamp(base, 0, 100);
  }

  public averageWait(): number {
    if (this.waitSamples.length === 0) return 0;
    const sum = this.waitSamples.reduce((acc, value) => acc + value, 0);
    this.waitSamples = this.waitSamples.slice(-40);
    return Math.round(sum / this.waitSamples.length);
  }

  private updateRating(): void {
    const pop = this.population;
    const wait = this.averageWait();
    const noise = this.events.length;
    const happy = this.happiness;
    let rating = 1;

    if (pop >= 60) rating = 2;
    if (pop >= 140 && wait <= 18) rating = 3;
    if (pop >= 240 && wait <= 14 && noise <= 2) rating = 4;
    if (pop >= 320 && wait <= 10 && happy >= 80 && this.vipPassed) rating = 5;

    this.rating = rating;
  }

  private endOfDay(): void {
    for (const floor of this.floors.values()) {
      for (const room of floor.rooms) {
        room.cleanliness = clamp(room.cleanliness - 3, 40, 100);
      }
    }
  }

  private randomFloor(): number {
    const floorIndices = Array.from(this.floors.keys());
    return floorIndices[Math.floor(Math.random() * floorIndices.length)];
  }

  public getTimeLabel(): string {
    const hour = Math.floor(this.time / 60);
    const minute = this.time % 60;
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = ((hour + 11) % 12) + 1;
    const displayMinute = String(minute).padStart(2, "0");
    return `Day ${this.day} - ${displayHour}:${displayMinute} ${suffix}`;
  }

  public formatMoney(): string {
    return formatMoney(this.money);
  }
}
