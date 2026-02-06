import type {
  ElevatorType,
  PersonRole,
  PersonState,
} from "@types/types.ts";

export class Person {
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
