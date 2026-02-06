import { chance, pick } from "./Util.js";
import { ROOM, RoomTypes } from "./RoomTypes.js";

export const PERSON = {
  RESIDENT: "Resident",
  WORKER: "Office Worker",
  SHOPPER: "Shopper",
  GUEST: "Hotel Guest",
  STAFF: "Service Staff",
};

export class PeopleSystem {
  constructor(tower, elevators, rng){
    this.tower = tower;
    this.elevators = elevators;
    this.rng = rng;

    this.people = new Map();
    this.nextSpawnTimer = 0;

    this.metrics = {
      population: 0,
      happiness: 60,
      avgElevWait: 0,
      complaintsToday: 0,
      noiseComplaintsToday: 0,
      vipSuccess: false,
      vipPending: false,
      vipScore: 0,
    };
  }

  allPeople(){ return [...this.people.values()]; }

  countByType(type){
    let n=0;
    for(const p of this.people.values()) if(p.kind === type) n++;
    return n;
  }

  computeCapacity(){
    let resCap=0, guestCap=0, workers=0;
    for(const r of this.tower.allRooms()){
      if(r.state !== "active") continue;
      const def = RoomTypes[r.type];
      if(r.type === ROOM.APARTMENT || r.type === ROOM.CONDO) resCap += (def.capacity||0);
      if(r.type === ROOM.HOTEL || r.type === ROOM.SUITE) guestCap += (def.capacity||0);
      if(r.type === ROOM.OFFICE) workers += (def.workers||0);
    }
    return { resCap, guestCap, workers };
  }

  spawnPerson(kind, floor, targetFloor, nowMin){
    const id = crypto.randomUUID();
    const p = {
      id,
      kind,
      floor,
      state: "idle",
      toFloor: targetFloor,
      inElevator: null,
      waitedElev: 0,
      mood: 60 + Math.floor(this.rng() * 20),
      bornAt: nowMin,
      despawnAt: null,
      homeFloor: null,
      workFloor: null,
      wants: null,
    };
    this.people.set(id, p);
    return p;
  }

  pickRoomFloor(typeKey){
    const candidates = this.tower.allRooms().filter(r => r.type === typeKey && r.state === "active");
    if(!candidates.length) return null;
    const r = candidates[Math.floor(this.rng() * candidates.length)];
    return r.floor;
  }

  pickAnyCommercialFloor(){
    const commercial = [ROOM.RETAIL, ROOM.FASTFOOD, ROOM.RESTAURANT, ROOM.THEATER, ROOM.PARTY];
    const candidates = this.tower.allRooms().filter(r => commercial.includes(r.type) && r.state === "active");
    if(!candidates.length) return null;
    const r = candidates[Math.floor(this.rng() * candidates.length)];
    return r.floor;
  }

  update(dtMinutes, nowMinutes, timeOfDayMin, towerStars){
    for(const p of this.people.values()){
      if(p.state === "gone") this.people.delete(p.id);
    }

    this.metrics.avgElevWait = this.elevators.stats.lastSampleAvg || 0;

    const cap = this.computeCapacity();
    const popCap = [0, 220, 520, 920, 1500, 2400][towerStars] || 220;

    const baseSpawn = 2.2 - Math.min(1.2, towerStars * 0.18);
    this.nextSpawnTimer -= dtMinutes;

    const totalPop = this.currentPopulationEstimate();
    this.metrics.population = totalPop;

    if(this.nextSpawnTimer <= 0 && totalPop < popCap){
      this.nextSpawnTimer = baseSpawn;

      const hour = Math.floor(timeOfDayMin / 60);

      const hasOffice = cap.workers > 0;
      const hasRes = cap.resCap > 0;
      const hasHotel = cap.guestCap > 0;

      let kind = PERSON.SHOPPER;

      if(hour >= 7 && hour <= 10 && hasOffice && chance(this.rng, 0.55)){
        kind = PERSON.WORKER;
      } else if(hour >= 17 && hour <= 20 && hasRes && chance(this.rng, 0.35)){
        kind = PERSON.RESIDENT;
      } else if(hour >= 11 && hour <= 22 && hasHotel && chance(this.rng, 0.20 + towerStars * 0.03)){
        kind = PERSON.GUEST;
      } else if(chance(this.rng, 0.06 + towerStars * 0.01)){
        kind = PERSON.STAFF;
      }

      let entry = 0;

      if(kind === PERSON.WORKER){
        const dest = this.pickRoomFloor(ROOM.OFFICE);
        if(dest != null) this.createTrip(kind, entry, dest, nowMinutes, { leaveAt: 18*60 + Math.floor(this.rng()*60) });
      } else if(kind === PERSON.RESIDENT){
        const dest = this.pickRoomFloor(chance(this.rng, 0.6) ? ROOM.APARTMENT : ROOM.CONDO) ?? this.pickRoomFloor(ROOM.APARTMENT);
        if(dest != null) this.createTrip(kind, entry, dest, nowMinutes, { leaveAt: 7*60 + Math.floor(this.rng()*90) });
      } else if(kind === PERSON.GUEST){
        const dest = this.pickRoomFloor(chance(this.rng, 0.75) ? ROOM.HOTEL : ROOM.SUITE) ?? this.pickRoomFloor(ROOM.HOTEL);
        if(dest != null) this.createTrip(kind, entry, dest, nowMinutes, { leaveAt: 10*60 + Math.floor(this.rng()*120) });
      } else if(kind === PERSON.STAFF){
        const dest = this.pickRoomFloor(pick(this.rng, [ROOM.JANITOR, ROOM.SECURITY, ROOM.MEDICAL])) ?? 0;
        this.createTrip(kind, entry, dest, nowMinutes, { leaveAt: 23*60 });
      } else {
        const dest = this.pickAnyCommercialFloor();
        if(dest != null) this.createTrip(kind, entry, dest, nowMinutes, { leaveAt: (hour + 1)*60 + Math.floor(this.rng()*60) });
      }
    }

    for(const p of this.people.values()){
      if(p.state === "idle"){
        if(p.toFloor != null && p.floor !== p.toFloor){
          this.callElevator(p);
        } else {
          p.state = "arrived";
        }
      } else if(p.state === "waiting"){
        p.mood -= dtMinutes * 0.07;
        if(p.mood < 0) p.mood = 0;
      } else if(p.state === "riding"){
        p.mood -= dtMinutes * 0.01;
      } else if(p.state === "arrived"){
        if(p.despawnAt != null && timeOfDayMin >= p.despawnAt){
          if(p.floor !== 0){
            p.toFloor = 0;
            this.callElevator(p);
          } else {
            p.state = "gone";
          }
        }
      }
    }

    this.updateHappiness(dtMinutes, timeOfDayMin);
  }

  createTrip(kind, fromFloor, toFloor, nowMin, { leaveAt }){
    const p = this.spawnPerson(kind, fromFloor, toFloor, nowMin);
    p.despawnAt = leaveAt;
    p.state = "idle";
    return p;
  }

  callElevator(p){
    p.state = "waiting";
    const kind = (p.kind === PERSON.STAFF) ? "service" : "public";
    const shaftId = this.elevators.requestRide({
      personId: p.id,
      fromFloor: p.floor,
      toFloor: p.toFloor,
      dir: Math.sign(p.toFloor - p.floor),
      kind
    });
    if(shaftId == null){
      const hasStairs = this.tower.countRooms(ROOM.STAIRS) > 0;
      if(hasStairs){
        const travel = Math.abs(p.toFloor - p.floor) * 0.4;
        p.state = "arrived";
        p.floor = p.toFloor;
        p.waitedElev += travel;
        p.toFloor = null;
      } else {
        p.state = "waiting";
      }
    }
  }

  currentPopulationEstimate(){
    return this.people.size;
  }

  updateHappiness(dtMinutes, timeOfDayMin){
    const avgWait = this.metrics.avgElevWait;

    const used = this.tower.floorsInUse();
    let noise = 0, clean = 0;
    for(const f of used){
      const m = this.tower.floorMetrics.get(f);
      noise += m.noise;
      clean += m.cleanliness;
    }
    const noiseAvg = used.length ? noise / used.length : 0;
    const cleanAvg = used.length ? clean / used.length : 1;

    const hour = Math.floor(timeOfDayMin / 60);
    const nightFactor = (hour >= 22 || hour <= 6) ? 1.6 : 1.0;

    let target = 70;
    target -= Math.max(0, Math.min(90, avgWait)) * 0.45;
    target -= Math.max(0, Math.min(30, noiseAvg * nightFactor)) * 0.9;
    target += Math.max(-20, Math.min(20, (cleanAvg - 0.6) * 70));

    target = Math.max(0, Math.min(100, target));
    const cur = this.metrics.happiness;
    const rate = 0.02 * dtMinutes;
    this.metrics.happiness = Math.max(0, Math.min(100, cur + (target - cur) * rate));
  }
}
