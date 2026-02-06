import { clamp } from "./Util.js";

export const ELEVATOR_TYPE = {
  STANDARD: "standard",
  EXPRESS: "express",
  SERVICE: "service"
};

export class ElevatorSystem {
  constructor(tower){
    this.tower = tower;
    this.shafts = [];
    this.floorQueues = new Map();
    this.stats = {
      avgWait: 0,
      samples: 0,
      lastSampleAvg: 0,
    };
  }

  ensureFloorQueue(floor){
    const k = String(floor);
    if(!this.floorQueues.has(k)) this.floorQueues.set(k, []);
    return this.floorQueues.get(k);
  }

  addShaft({ x, type=ELEVATOR_TYPE.STANDARD, servedFloors=null }){
    const id = crypto.randomUUID();
    const sf = servedFloors ? new Set(servedFloors) : null;
    const shaft = {
      id,
      x,
      type,
      servedFloors: sf,
      car: this.createCar(type),
    };
    this.shafts.push(shaft);
    return shaft;
  }

  createCar(type){
    return {
      type,
      floor: 0,
      y: 0,
      dir: 0,
      state: "idle",
      dwell: 0,
      capacity: type === ELEVATOR_TYPE.SERVICE ? 10 : 14,
      riders: [],
      stops: [],
      broken: false,
      brokenTimer: 0,
      lastDecision: 0,
    };
  }

  shaftAtX(x){
    return this.shafts.find(s => s.x === x);
  }

  isServed(shaft, floor){
    if(shaft.servedFloors == null) return true;
    return shaft.servedFloors.has(floor);
  }

  requestRide(req){
    const candidates = this.shafts.filter(s => {
      if(!this.isServed(s, req.fromFloor) || !this.isServed(s, req.toFloor)) return false;
      if(s.car.broken) return false;
      if(s.type === "service") return req.kind === "service";
      return req.kind !== "service";
    });

    if(!candidates.length) return null;

    const best = candidates
      .map(s => ({ s, score: this.estimateWaitScore(s, req.fromFloor, req.dir) }))
      .sort((a,b) => a.score - b.score)[0].s;

    const q = this.ensureFloorQueue(req.fromFloor);
    q.push({ ...req, shaftId: best.id, waited: 0 });
    return best.id;
  }

  estimateWaitScore(shaft, fromFloor, dir){
    const car = shaft.car;
    const dist = Math.abs(car.floor - fromFloor);
    const q = this.ensureFloorQueue(fromFloor).filter(r => r.shaftId === shaft.id).length;
    const wrongDir = (car.dir !== 0 && Math.sign(fromFloor - car.floor) !== car.dir) ? 3 : 0;
    const busy = car.riders.length / car.capacity;
    return dist + q * 0.8 + wrongDir + busy * 2;
  }

  breakRandomElevator(rng){
    const candidates = this.shafts.filter(s => !s.car.broken);
    if(!candidates.length) return null;
    const s = candidates[Math.floor(rng() * candidates.length)];
    s.car.broken = true;
    s.car.brokenTimer = 180 + Math.floor(rng() * 240);
    s.car.state = "dwell";
    s.car.dwell = 10;
    return s;
  }

  update(dtMinutes, peopleIndex){
    for(const [k, q] of this.floorQueues.entries()){
      for(const r of q){
        r.waited += dtMinutes;
        this.stats.samples++;
        this.stats.avgWait += (clamp(r.waited, 0, 120) - this.stats.avgWait) / this.stats.samples;
      }
    }

    for(const shaft of this.shafts){
      const car = shaft.car;

      if(car.broken){
        car.brokenTimer -= dtMinutes;
        if(car.brokenTimer <= 0){
          car.broken = false;
          car.brokenTimer = 0;
          car.state = "idle";
          car.dir = 0;
          car.stops = [];
        }
        continue;
      }

      const pendingCalls = this.getPendingCallsForShaft(shaft.id);

      car.lastDecision += dtMinutes;
      const shouldReplan = car.lastDecision >= 1;

      if(shouldReplan && car.state !== "moving"){
        car.lastDecision = 0;
        this.planStops(shaft, pendingCalls, peopleIndex);
      }

      if(car.state === "idle"){
        if(car.stops.length){
          car.state = "moving";
          car.dir = Math.sign(car.stops[0] - car.floor) || 0;
        } else {
          car.dir = 0;
        }
      }

      if(car.state === "moving"){
        const speed = 0.06 * dtMinutes;
        if(car.stops.length === 0){
          car.state = "idle";
          car.dir = 0;
        } else {
          const target = car.stops[0];
          const dy = target - car.y;
          const step = clamp(dy, -speed, speed);
          car.y += step;

          const newFloor = Math.round(car.y);
          if(Math.abs(car.y - target) < 0.02){
            car.y = target;
            car.floor = target;
            car.state = "dwell";
            car.dwell = 0.5;
            this.handleStop(shaft, peopleIndex);
            car.stops.shift();
            car.dir = car.stops.length ? Math.sign(car.stops[0] - car.floor) : 0;
          } else {
            if(newFloor !== car.floor) car.floor = newFloor;
          }
        }
      } else if(car.state === "dwell"){
        car.dwell -= dtMinutes;
        if(car.dwell <= 0){
          car.state = car.stops.length ? "moving" : "idle";
        }
      }
    }

    this.stats.lastSampleAvg = this.stats.avgWait;
  }

  getPendingCallsForShaft(shaftId){
    const calls = [];
    for(const [k, q] of this.floorQueues.entries()){
      for(const r of q){
        if(r.shaftId === shaftId) calls.push(r);
      }
    }
    return calls;
  }

  planStops(shaft, calls, peopleIndex){
    const car = shaft.car;

    const pickupFloors = new Set(calls.map(c => c.fromFloor));
    const dropFloors = new Set();
    for(const pid of car.riders){
      const p = peopleIndex.get(pid);
      if(p && p.state === "riding" && p.toFloor != null) dropFloors.add(p.toFloor);
    }

    const possiblePickups = [...pickupFloors].filter(f => this.isServed(shaft, f));
    const possibleDrops = [...dropFloors].filter(f => this.isServed(shaft, f));

    const targets = (possibleDrops.length ? possibleDrops : possiblePickups);
    if(!targets.length){
      car.stops = [];
      return;
    }

    const cur = car.floor;
    const sortByDist = (a,b) => Math.abs(a-cur) - Math.abs(b-cur);

    let next = null;
    if(car.dir !== 0){
      const forward = targets.filter(f => (f - cur) * car.dir > 0).sort(sortByDist);
      if(forward.length) next = forward[0];
    }
    if(next == null) next = targets.sort(sortByDist)[0];

    const dir = Math.sign(next - cur) || 1;
    const all = [...new Set([...possiblePickups, ...possibleDrops])].sort((a,b)=>a-b);
    const inDir = dir > 0 ? all.filter(f=>f>=cur) : all.filter(f=>f<=cur).reverse();
    const opp = dir > 0 ? all.filter(f=>f<cur).reverse() : all.filter(f=>f>cur);

    car.stops = [...inDir, ...opp].slice(0, 8);
    car.dir = dir;
  }

  handleStop(shaft, peopleIndex){
    const car = shaft.car;
    const f = car.floor;

    const remaining = [];
    for(const pid of car.riders){
      const p = peopleIndex.get(pid);
      if(!p){ continue; }
      if(p.toFloor === f){
        p.state = "arrived";
        p.floor = f;
        p.waitedElev = 0;
        p.inElevator = null;
        p.toFloor = null;
      } else {
        remaining.push(pid);
      }
    }
    car.riders = remaining;

    const q = this.ensureFloorQueue(f);
    const here = q.filter(r => r.shaftId === shaft.id);
    if(!here.length) return;

    here.sort((a,b)=>b.waited - a.waited);

    const canTake = car.capacity - car.riders.length;
    let loaded = 0;

    for(const req of here){
      if(loaded >= canTake) break;

      const p = peopleIndex.get(req.personId);
      if(!p || p.state !== "waiting") continue;

      p.state = "riding";
      p.inElevator = shaft.id;
      p.toFloor = req.toFloor;
      p.waitedElev = req.waited;

      car.riders.push(p.id);
      loaded++;
    }

    const boardedIds = new Set(car.riders);
    const newQ = q.filter(r => !(r.shaftId === shaft.id && boardedIds.has(r.personId) && r.fromFloor === f));
    this.floorQueues.set(String(f), newQ);
  }

  getShaftById(id){
    return this.shafts.find(s => s.id === id) || null;
  }
}
