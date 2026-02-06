import { chance, pick, clamp } from "./Util.js";
import { ROOM } from "./RoomTypes.js";

export const EVENT = {
  FIRE: "Fire",
  ELEVATOR_BREAK: "Elevator Breakdown",
  CRIME: "Crime Incident",
  MEDICAL: "Medical Emergency",
  COMPLAINT: "Tenant Complaint",
  VIP: "VIP Visit",
};

export class EventManager {
  constructor(tower, elevators, people, rng, logFn){
    this.tower = tower;
    this.elevators = elevators;
    this.people = people;
    this.rng = rng;
    this.log = logFn;

    this.active = [];
    this.vip = {
      scheduled: false,
      arrivalMin: null,
      evaluationMin: null,
      done: false,
    };
  }

  serviceCoverageScore(typeKey){
    const n = this.tower.countRooms(typeKey);
    return clamp(n / 3, 0, 1);
  }

  scheduleVipIfEligible(stars, nowDay){
    if(stars < 3) return;
    if(this.vip.done) return;
    if(this.vip.scheduled) return;

    if(nowDay >= 2 && chance(this.rng, 0.18)){
      this.vip.scheduled = true;
      this.vip.arrivalMin = (nowDay + 1) * 24 * 60 + (11*60 + Math.floor(this.rng()*120));
      this.vip.evaluationMin = this.vip.arrivalMin + (3*60);
      this.log(`A VIP visit is rumored for tomorrow.`, "good");
      this.people.metrics.vipPending = true;
    }
  }

  update(dtMinutes, nowMinutes, dayIndex, timeOfDayMin, stars){
    for(const e of this.active){
      e.timer -= dtMinutes;
    }
    const resolved = this.active.filter(e => e.timer <= 0);
    this.active = this.active.filter(e => e.timer > 0);
    for(const e of resolved){
      this.log(`${e.type} resolved.`, "good");
    }

    if(this.vip.scheduled && !this.vip.done){
      if(nowMinutes >= this.vip.arrivalMin && nowMinutes < this.vip.arrivalMin + 2){
        this.spawnVipEvent();
      }
      if(nowMinutes >= this.vip.evaluationMin && nowMinutes < this.vip.evaluationMin + 2){
        this.evaluateVip(stars);
        this.vip.done = true;
        this.people.metrics.vipPending = false;
      }
    }

    const pop = this.people.metrics.population;
    const unhappy = clamp((60 - this.people.metrics.happiness) / 60, 0, 1);

    const baseP = clamp(pop / 900, 0, 1) * 0.03;
    const eventRoll = dtMinutes * (0.002 + baseP + unhappy * 0.004);

    if(chance(this.rng, eventRoll)){
      const type = this.pickEventType(unhappy, stars);
      this.trigger(type, stars);
    }
  }

  pickEventType(unhappy, stars){
    const choices = [EVENT.COMPLAINT, EVENT.MEDICAL, EVENT.CRIME, EVENT.FIRE, EVENT.ELEVATOR_BREAK];
    const weights = {
      [EVENT.COMPLAINT]: 1.6 + unhappy * 1.4,
      [EVENT.MEDICAL]: 1.0,
      [EVENT.CRIME]: 0.9 + unhappy * 1.2,
      [EVENT.FIRE]: 0.6 + unhappy * 0.6,
      [EVENT.ELEVATOR_BREAK]: 0.7 + stars * 0.15,
    };
    const total = choices.reduce((s,c)=>s+weights[c],0);
    let r = this.rng() * total;
    for(const c of choices){
      r -= weights[c];
      if(r <= 0) return c;
    }
    return EVENT.COMPLAINT;
  }

  randomUsedFloor(){
    const used = this.tower.floorsInUse().filter(f => f !== 0);
    if(!used.length) return 0;
    return used[Math.floor(this.rng() * used.length)];
  }

  trigger(type, stars){
    const floor = this.randomUsedFloor();
    const severity = 1 + Math.floor(this.rng() * 3);

    if(type === EVENT.ELEVATOR_BREAK){
      const s = this.elevators.breakRandomElevator(this.rng);
      if(s){
        this.log(`Elevator issue reported (shaft at x=${s.x}).`, "bad");
        this.people.metrics.happiness = clamp(this.people.metrics.happiness - 4, 0, 100);
      }
      return;
    }

    if(type === EVENT.CRIME){
      const sec = this.serviceCoverageScore(ROOM.SECURITY);
      const mitigated = chance(this.rng, sec * 0.75);
      if(mitigated){
        this.log(`Security handled a suspicious situation.`, "good");
        this.people.metrics.happiness = clamp(this.people.metrics.happiness + 1, 0, 100);
      } else {
        this.active.push({ type, floor, timer: 60 + severity*30, severity });
        this.log(`Crime incident on floor ${floor}.`, "bad");
        this.people.metrics.happiness = clamp(this.people.metrics.happiness - (3 + severity), 0, 100);
      }
      return;
    }

    if(type === EVENT.MEDICAL){
      const med = this.serviceCoverageScore(ROOM.MEDICAL);
      const helped = chance(this.rng, 0.25 + med * 0.6);
      if(helped){
        this.log(`Medical staff responded quickly.`, "good");
        this.people.metrics.happiness = clamp(this.people.metrics.happiness + 1, 0, 100);
      } else {
        this.active.push({ type, floor, timer: 45 + severity*25, severity });
        this.log(`Medical emergency on floor ${floor}.`, "bad");
        this.people.metrics.happiness = clamp(this.people.metrics.happiness - (2 + severity), 0, 100);
      }
      return;
    }

    if(type === EVENT.FIRE){
      const jan = this.serviceCoverageScore(ROOM.JANITOR);
      const contained = chance(this.rng, 0.2 + jan * 0.6);
      if(contained){
        this.log(`Small fire contained quickly.`, "good");
        this.people.metrics.happiness = clamp(this.people.metrics.happiness - 1, 0, 100);
      } else {
        this.active.push({ type, floor, timer: 120 + severity*60, severity });
        this.log(`Fire on floor ${floor}!`, "bad");
        this.people.metrics.happiness = clamp(this.people.metrics.happiness - (6 + severity*2), 0, 100);

        const arr = this.tower.rooms.get(floor) || [];
        const activeRooms = arr.filter(r => r.state === "active");
        if(activeRooms.length){
          const r = pick(this.rng, activeRooms);
          r.state = "broken";
        }
      }
      return;
    }

    if(type === EVENT.COMPLAINT){
      const noise = this.tower.floorMetrics.get(floor)?.noise ?? 0;
      const more = Math.min(4, Math.floor(noise / 4));
      this.active.push({ type, floor, timer: 30 + severity*20, severity });
      this.log(`Complaint filed (floor ${floor}).`, "bad");
      this.people.metrics.complaintsToday++;
      if(noise >= 6){
        this.people.metrics.noiseComplaintsToday++;
      }
      this.people.metrics.happiness = clamp(this.people.metrics.happiness - (1 + severity + more), 0, 100);
      return;
    }
  }

  spawnVipEvent(){
    this.active.push({ type: EVENT.VIP, floor: 0, timer: 180, severity: 1 });
    this.log(`A VIP arrived and is touring the tower...`, "good");
  }

  evaluateVip(stars){
    const happy = this.people.metrics.happiness;
    const wait = this.people.metrics.avgElevWait;
    const complaints = this.people.metrics.complaintsToday;
    const noiseCompl = this.people.metrics.noiseComplaintsToday;

    const services = (this.tower.countRooms(ROOM.SECURITY) > 0 ? 1 : 0)
      + (this.tower.countRooms(ROOM.MEDICAL) > 0 ? 1 : 0)
      + (this.tower.countRooms(ROOM.JANITOR) > 0 ? 1 : 0);

    let score = 0;
    score += (happy - 50) * 1.2;
    score -= Math.max(0, wait - 10) * 1.6;
    score -= complaints * 3;
    score -= noiseCompl * 4;
    score += services * 6;
    score += (stars >= 4 ? 6 : 0);

    this.people.metrics.vipScore = score;
    const success = score >= 18;
    this.people.metrics.vipSuccess = success;

    if(success){
      this.log(`VIP evaluation: favorable.`, "good");
      this.people.metrics.happiness = clamp(this.people.metrics.happiness + 6, 0, 100);
    } else {
      this.log(`VIP evaluation: unimpressed.`, "bad");
      this.people.metrics.happiness = clamp(this.people.metrics.happiness - 6, 0, 100);
    }
  }
}
