import type { IRoom, RoomType } from "@types/types.ts";

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
