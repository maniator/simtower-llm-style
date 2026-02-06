import { fmtMoney, clamp, starString, hhmm } from "./Util.js";
import { Tower } from "./Tower.js";
import { ElevatorSystem, ELEVATOR_TYPE } from "./ElevatorSystem.js";
import { PeopleSystem } from "./People.js";
import { EventManager } from "./Events.js";
import { ROOM, RoomTypes } from "./RoomTypes.js";

export class Sim {
  constructor({ rng, logFn }){
    this.rng = rng;
    this.log = logFn;

    this.tower = new Tower({ floorsMin: -6, floorsMax: 34, width: 24 });
    this.elevators = new ElevatorSystem(this.tower);
    this.people = new PeopleSystem(this.tower, this.elevators, rng);
    this.events = new EventManager(this.tower, this.elevators, this.people, rng, logFn);

    this.money = 45000;
    this.day = 0;
    this.timeOfDay = 8 * 60;
    this.speed = 1;
    this.stars = 1;

    this.lastDailyTick = 0;
    this.absMinutes = this.day * 1440 + this.timeOfDay;

    this.bootstrap();
  }

  bootstrap(){
    this.tryBuild(ROOM.LOBBY, 0, 7);
    this.tryBuild(ROOM.ELEVATOR_SHAFT, 0, 4);
    this.tryBuild(ROOM.ELEVATOR_SHAFT, 0, 19);
    this.tryBuild(ROOM.STAIRS, 0, 2);

    this.syncShaftsFromRooms();

    this.tryBuild(ROOM.APARTMENT, 2, 2);
    this.tryBuild(ROOM.APARTMENT, 3, 2);
    this.tryBuild(ROOM.RETAIL, 1, 2);
    this.tryBuild(ROOM.FASTFOOD, 1, 10);
  }

  setSpeed(s){ this.speed = s; }

  syncShaftsFromRooms(){
    const groundShaftCells = (this.tower.rooms.get(0) || []).filter(r => r.type === ROOM.ELEVATOR_SHAFT);
    for(const cell of groundShaftCells){
      if(this.elevators.shaftAtX(cell.x)) continue;
      const idx = this.elevators.shafts.length;
      const type = idx === 0 ? ELEVATOR_TYPE.STANDARD : ELEVATOR_TYPE.STANDARD;
      this.elevators.addShaft({ x: cell.x, type });
    }
  }

  getTimeString(){ return hhmm(this.timeOfDay); }
  canAfford(cost){ return this.money >= cost; }

  tryBuild(typeKey, floor, x){
    const def = RoomTypes[typeKey];
    const can = this.tower.canPlace(typeKey, floor, x, this.stars);
    if(!can.ok) return { ok:false, reason: can.reason };
    if(!this.canAfford(def.buildCost)) return { ok:false, reason:"Not enough money." };

    this.money -= def.buildCost;
    const room = this.tower.placeRoom(typeKey, floor, x, this.absMinutes);

    if(typeKey === ROOM.ELEVATOR_SHAFT && floor === 0){
      this.syncShaftsFromRooms();
    }

    this.log(`Construction started: ${typeKey} (floor ${floor}).`, "good");
    return { ok:true, room };
  }

  tick(dtRealSeconds){
    if(this.speed === 0) return;

    const minutesPerSecond = 1.0;
    const dtMinutes = dtRealSeconds * minutesPerSecond * (this.speed === 3 ? 4 : 1);

    this.timeOfDay += dtMinutes;
    while(this.timeOfDay >= 1440){
      this.timeOfDay -= 1440;
      this.day++;
      this.onNewDay();
    }

    this.absMinutes = this.day * 1440 + this.timeOfDay;

    this.tower.tickConstruction(dtMinutes);
    this.tower.computePerFloorStaticMetrics();

    this.updateCleanliness(dtMinutes);

    const peopleIndex = this.people.people;
    this.elevators.update(dtMinutes, peopleIndex);
    this.people.update(dtMinutes, this.absMinutes, this.timeOfDay, this.stars);

    this.updateCongestion(dtMinutes);

    this.events.scheduleVipIfEligible(this.stars, this.day);
    this.events.update(dtMinutes, this.absMinutes, this.day, this.timeOfDay, this.stars);

    this.updateEconomy(dtMinutes);
    this.updateStars(dtMinutes);
  }

  onNewDay(){
    this.people.metrics.complaintsToday = 0;
    this.people.metrics.noiseComplaintsToday = 0;

    const hotelRooms = this.tower.allRooms().filter(r => (r.type === ROOM.HOTEL || r.type === ROOM.SUITE) && r.state === "active");
    const jan = this.tower.countRooms(ROOM.JANITOR);
    for(const r of hotelRooms){
      r.dirty = clamp(r.dirty + 0.35, 0, 1);
      if(jan > 0){
        r.dirty = clamp(r.dirty - 0.5 * clamp(jan/2,0,1), 0, 1);
      }
      if(r.dirty > 0.75 && jan === 0){
        this.people.metrics.happiness = clamp(this.people.metrics.happiness - 2, 0, 100);
      }
    }

    this.log(`Day ${this.day} begins.`, "good");
  }

  updateCleanliness(dtMinutes){
    const used = this.tower.floorsInUse();
    const janCount = this.tower.countRooms(ROOM.JANITOR);
    const janBoost = clamp(janCount / 3, 0, 1);

    for(const f of used){
      const m = this.tower.floorMetrics.get(f);
      const decay = 0.0009 * (1 + m.congestion * 0.06);
      m.cleanliness = clamp(m.cleanliness - decay * dtMinutes, 0, 1);
      if(janBoost > 0){
        m.cleanliness = clamp(m.cleanliness + 0.0016 * janBoost * dtMinutes, 0, 1);
      }
    }
  }

  updateCongestion(dtMinutes){
    for(let f=this.tower.floorsMin; f<=this.tower.floorsMax; f++){
      const m = this.tower.floorMetrics.get(f);
      m.congestion = 0;
      m.queues = 0;
    }

    for(const p of this.people.people.values()){
      const m = this.tower.floorMetrics.get(p.floor);
      if(!m) continue;
      m.congestion += 1;
    }

    for(const [k, q] of this.elevators.floorQueues.entries()){
      const f = Number(k);
      const m = this.tower.floorMetrics.get(f);
      if(m) m.queues += q.length;
    }
  }

  updateEconomy(dtMinutes){
    const minsPerDay = 1440;

    let maintPerMin = 0;
    for(const r of this.tower.allRooms()){
      if(r.state !== "active") continue;
      const def = RoomTypes[r.type];
      maintPerMin += def.maintPerDay / minsPerDay;
    }
    this.money -= maintPerMin * dtMinutes;

    const happy = this.people.metrics.happiness;
    const ratingFactor = 0.75 + this.stars * 0.12;
    const happyFactor = 0.6 + happy / 150;

    const hour = Math.floor(this.timeOfDay / 60);
    const isWork = hour >= 8 && hour <= 17;
    const isEven = hour >= 18 && hour <= 22;

    let revenuePerMin = 0;

    for(const r of this.tower.allRooms()){
      if(r.state !== "active") continue;
      const def = RoomTypes[r.type];

      const fm = this.tower.floorMetrics.get(r.floor);
      const traffic = def.traffic * (1 + clamp((fm?.congestion ?? 0)/50, 0, 2));

      let base = 0;
      if(def.category === "Commercial"){
        base = traffic * (isWork ? 1.1 : 0.9) * (isEven ? 1.1 : 1.0);
      } else if(def.category === "Entertainment"){
        base = traffic * (isEven ? 1.5 : 0.6);
      } else if(def.category === "Hotel"){
        base = traffic * 0.6;
        base *= (1 - (r.dirty || 0) * 0.6);
      } else if(def.category === "Residential"){
        const noise = fm?.noise ?? 0;
        const nightPenalty = (hour >= 22 || hour <= 6) ? clamp(noise / 16, 0, 0.35) : 0;
        base = 1.6 * (1 - nightPenalty);
      } else {
        base = 0.4;
      }

      const scale = clamp(def.buildCost / 12000, 0.6, 2.8);

      const income = base * scale * ratingFactor * happyFactor * 0.9;
      revenuePerMin += income / 8;
      r.lastRevenue = income;
      r.lastTraffic = traffic;
    }

    this.money += revenuePerMin * dtMinutes;

    if(this.money < -5000){
      this.money = -5000;
    }
  }

  updateStars(dtMinutes){
    this.lastDailyTick += dtMinutes;
    if(this.lastDailyTick < 30) return;
    this.lastDailyTick = 0;

    const pop = this.people.metrics.population;
    const happy = this.people.metrics.happiness;
    const avgWait = this.people.metrics.avgElevWait;
    const noiseCompl = this.people.metrics.noiseComplaintsToday;

    const elevScore = clamp(1 - (Math.max(0, avgWait - 8) / 40), 0, 1);

    let queueSum = 0;
    for(const [k,q] of this.elevators.floorQueues.entries()) queueSum += q.length;
    const trafficScore = clamp(1 - queueSum / 140, 0, 1);

    const noiseScore = clamp(1 - noiseCompl / 6, 0, 1);
    const happyScore = clamp((happy - 40) / 60, 0, 1);

    const vipOk = this.people.metrics.vipSuccess;

    let targetStars = 1;
    if(pop >= 180 && elevScore >= 0.45) targetStars = 2;
    if(pop >= 420 && elevScore >= 0.62 && happyScore >= 0.35) targetStars = 3;
    if(pop >= 820 && elevScore >= 0.70 && noiseScore >= 0.65 && trafficScore >= 0.60) targetStars = 4;
    if(pop >= 1400 && elevScore >= 0.82 && happyScore >= 0.72 && vipOk) targetStars = 5;

    if(targetStars !== this.stars){
      this.stars = targetStars;
      this.onStarChanged();
    }
  }

  onStarChanged(){
    this.log(`Tower rating changed: ${this.stars}★`, "good");

    if(this.stars >= 3 && this.elevators.shafts.length >= 2){
      const shaft = this.elevators.shafts[1];
      if(shaft.type !== "express"){
        shaft.type = "express";
        shaft.car.type = "express";

        const served = new Set([0]);
        for(let f=this.tower.floorsMin; f<=this.tower.floorsMax; f++){
          if(f % 3 === 0) served.add(f);
        }
        shaft.servedFloors = served;

        this.log(`An elevator has been upgraded to express service.`, "good");
      }
    }

    if(this.stars >= 4){
      if(this.elevators.shafts.length >= 3){
        const shaft = this.elevators.shafts[2];
        if(shaft.type !== "service"){
          shaft.type = "service";
          shaft.car.type = "service";
          this.log(`A service elevator is now configured for staff.`, "good");
        }
      }
    }
  }

  getHud(){
    return {
      money: fmtMoney(this.money),
      pop: this.people.metrics.population,
      happy: Math.round(this.people.metrics.happiness),
      stars: starString(this.stars),
      time: this.getTimeString(),
      avgWait: this.people.metrics.avgElevWait,
      vipPending: this.people.metrics.vipPending,
      vipScore: this.people.metrics.vipScore,
      vipSuccess: this.people.metrics.vipSuccess,
    };
  }
}
