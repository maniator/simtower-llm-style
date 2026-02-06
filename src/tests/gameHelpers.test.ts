import { describe, it, expect } from "vitest";
import { Person } from "@core/game/Person.ts";
import { ElevatorCar } from "@core/game/ElevatorCar.ts";

describe("Person", () => {
  it("should initialize with default state", () => {
    const person = new Person("worker", 1, 5, "standard");

    expect(person.role).toBe("worker");
    expect(person.origin).toBe(1);
    expect(person.target).toBe(5);
    expect(person.elevatorType).toBe("standard");
    expect(person.waitTime).toBe(0);
    expect(person.state).toBe("waiting");
  });
});

describe("ElevatorCar", () => {
  it("should add stops and track availability", () => {
    const car = new ElevatorCar("standard", 2, 2);

    expect(car.isAvailable()).toBe(true);
    car.addStop(3);
    expect(car.idle).toBe(false);
    expect(car.stops.has(3)).toBe(true);

    car.passengers.push(new Person("worker", 0, 3, "standard"));
    car.passengers.push(new Person("worker", 0, 4, "standard"));
    expect(car.isAvailable()).toBe(false);
  });
});

