export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function lerp(a, b, t){ return a + (b - a) * t; }

export function fmtMoney(n){
  const sign = n < 0 ? "-" : "";
  n = Math.abs(Math.floor(n));
  return sign + "$" + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function mulberry32(seed){
  let t = seed >>> 0;
  return function(){
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr){
  return arr[Math.floor(rng() * arr.length)];
}

export function chance(rng, p){
  return rng() < p;
}

export function starString(stars){
  const full = "★★★★★".slice(0, stars);
  const empty = "☆☆☆☆☆".slice(0, 5 - stars);
  return full + empty;
}

export function hhmm(minutes){
  const m = Math.floor(minutes % 60);
  const h = Math.floor((minutes / 60) % 24);
  return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0");
}
