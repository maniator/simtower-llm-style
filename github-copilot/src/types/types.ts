/**
 * Core type definitions for SimTower game
 */

export interface RoomType {
  id: string;
  name: string;
  category: RoomCategory;
  width: number;
  cost: number;
  maintenance: number;
  revenue: number;
  noise: number;
  traffic: number;
  happiness: number;
  buildTime: number;
  capacity: number;
  unlock: number;
  rules?: RoomRules;
  shaft?: boolean;
  elevatorType?: ElevatorType;
  staffOnly?: boolean;
}

export interface RoomRules {
  groundOnly?: boolean;
  basementOnly?: boolean;
  minFloors?: number;
}

export type RoomCategory =
  | "Infrastructure"
  | "Residential"
  | "Commercial"
  | "Hotel"
  | "Entertainment"
  | "Services";

export type ElevatorType = "stairs" | "standard" | "express" | "service";

export type PersonRole =
  | "worker"
  | "shopper"
  | "guest"
  | "hotel"
  | "resident"
  | "staff"
  | "vip";

export type PersonState = "waiting" | "riding" | "done";

export type EventType =
  | "fire"
  | "breakdown"
  | "crime"
  | "medical"
  | "complaint"
  | "vip";

export interface IRoom {
  type: RoomType;
  floorIndex: number;
  startX: number;
  endX: number;
  buildRemaining: number;
  active: boolean;
  cleanliness: number;
  tickConstruction(): void;
}

export interface FloorData {
  index: number;
  cells: (IRoom | null)[];
  rooms: IRoom[];
  traffic: number;
  noise: number;
  cleanliness: number;
  waitAverage: number;
}

export interface PlacementResult {
  ok: boolean;
  reason?: string;
  room?: IRoom;
  refund?: number;
}

export interface GameEvent {
  type: EventType;
  floorIndex: number;
  remaining: number;
  elevatorIndex: number | null;
}

export interface CellPosition {
  cellX: number;
  floorIndex: number;
}

export interface Camera {
  y: number;
}

