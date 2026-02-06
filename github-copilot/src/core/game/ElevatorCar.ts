import type { ElevatorType } from "@types/types";
import { Person } from "./Person.ts";

export class ElevatorCar {
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
