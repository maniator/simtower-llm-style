import { RoomTypes, ROOM } from "./RoomTypes.js";

export class Tower {
  constructor({ floorsMin=-6, floorsMax=30, width=24 }){
    this.floorsMin = floorsMin;
    this.floorsMax = floorsMax;
    this.width = width;

    this.rooms = new Map();
    for(let f=this.floorsMin; f<=this.floorsMax; f++){
      this.rooms.set(f, []);
    }

    this.floorMetrics = new Map();
    for(let f=this.floorsMin; f<=this.floorsMax; f++){
      this.floorMetrics.set(f, {
        noise: 0,
        congestion: 0,
        cleanliness: 1.0,
        queues: 0
      });
    }

    this.construction = [];
  }

  allRooms(){
    const out = [];
    for(const arr of this.rooms.values()) out.push(...arr);
    return out;
  }

  roomAtCell(floor, x){
    const arr = this.rooms.get(floor) || [];
    return arr.find(r => x >= r.x && x < r.x + r.w);
  }

  isCellFree(floor, x){
    return !this.roomAtCell(floor, x) && x >= 0 && x < this.width;
  }

  hasRoomType(type){
    for(const r of this.allRooms()) if(r.type === type) return true;
    return false;
  }

  countRooms(type){
    let n=0;
    for(const r of this.allRooms()) if(r.type === type) n++;
    return n;
  }

  canPlace(typeKey, floor, x, stars){
    const def = RoomTypes[typeKey];
    if(!def) return { ok:false, reason:"Unknown type." };
    if(stars < def.unlockStars) return { ok:false, reason:`Locked until ${def.unlockStars}★.` };

    const rules = def.rules || {};
    if(rules.groundOnly && floor !== 0) return { ok:false, reason:"Must be on ground floor." };
    if(rules.basementOnly && floor >= 0) return { ok:false, reason:"Must be in a basement floor." };
    if(rules.unique && this.hasRoomType(typeKey)) return { ok:false, reason:"Only one allowed." };

    const w = def.size.w;
    if(x < 0 || x + w > this.width) return { ok:false, reason:"Does not fit." };

    for(let i=0;i<w;i++){
      if(!this.isCellFree(floor, x+i)) return { ok:false, reason:"Space occupied." };
    }

    if(typeKey !== ROOM.LOBBY && !this.hasRoomType(ROOM.LOBBY)){
      return { ok:false, reason:"Build a Lobby first." };
    }

    return { ok:true, reason:"" };
  }

  placeRoom(typeKey, floor, x, nowMinutes){
    const def = RoomTypes[typeKey];
    const room = {
      id: crypto.randomUUID(),
      type: typeKey,
      floor,
      x,
      w: def.size.w,
      state: "building",
      buildStarted: nowMinutes,
      buildTimeMin: Math.max(30, Math.floor(def.buildCost / 300)),
      dirty: 0,
      lastRevenue: 0,
      lastTraffic: 0,
    };

    this.rooms.get(floor).push(room);
    this.construction.push({ roomId: room.id, remainingMin: room.buildTimeMin });
    return room;
  }

  tickConstruction(dtMinutes){
    for(const c of this.construction){
      c.remainingMin -= dtMinutes;
    }
    const done = this.construction.filter(c => c.remainingMin <= 0);
    this.construction = this.construction.filter(c => c.remainingMin > 0);
    for(const c of done){
      const room = this.getRoomById(c.roomId);
      if(room) room.state = "active";
    }
    return done.map(d => d.roomId);
  }

  getRoomById(id){
    for(const r of this.allRooms()) if(r.id === id) return r;
    return null;
  }

  computePerFloorStaticMetrics(){
    for(let f=this.floorsMin; f<=this.floorsMax; f++){
      const arr = this.rooms.get(f);
      const m = this.floorMetrics.get(f);
      let noise = 0;
      for(const r of arr){
        const def = RoomTypes[r.type];
        if(r.state === "active") noise += def.noise;
      }
      m.noise = noise;
    }
  }

  floorsInUse(){
    const used = [];
    for(let f=this.floorsMin; f<=this.floorsMax; f++){
      const arr = this.rooms.get(f);
      if(arr && arr.length) used.push(f);
    }
    return used;
  }
}
