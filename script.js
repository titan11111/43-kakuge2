// ===== main.js =====
const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const hp1El = document.getElementById('hp1');
const hp2El = document.getElementById('hp2');
const announceEl = document.getElementById('announce');
const roundEl = document.getElementById('round');

const W = cvs.width, H = cvs.height;
const GRAV = 0.9, FRICTION = 0.82;
const GROUND_Y = H * 0.60;
const PLANES = [0, 48];
let round = 1, state = 'intro';

// 画像（任意）: hero_sprites.png / rival_sprites.png があれば使用
const heroSheet = new Image(); heroSheet.src = 'hero_sprites.png';
const rivalSheet = new Image(); rivalSheet.src = 'rival_sprites.png';

// スプライト定義（1枚横並び）
const atlasDefault = {
  idle:{y:0,w:64,h:96,frames:4,fps:6},
  walk:{y:96,w:64,h:96,frames:6,fps:10},
  jump:{y:192,w:64,h:96,frames:1,fps:1},
  atk:{y:288,w:96,h:96,frames:4,fps:12},
  hit:{y:384,w:64,h:96,frames:2,fps:10},
  guard:{y:480,w:64,h:96,frames:2,fps:8},
  down:{y:576,w:96,h:64,frames:2,fps:6},
};

function showAnn(text, t=90){
  announceEl.textContent = text;
  announceEl.style.opacity = 1;
  setTimeout(()=>announceEl.style.opacity=0, t*16);
}

// 入力
class Input {
  constructor(map){ this.map=map; this.keys=new Set(); this.buffer=[]; }
  onKey(down, code){
    const k=this.map[code]; if(!k) return;
    if(down){ this.keys.add(k); this.buffer.unshift({k, t:performance.now()}); this.buffer=this.buffer.slice(0,12);}
    else this.keys.delete(k);
  }
  pressed(k){ return this.keys.has(k); }
  chord(...ks){ return ks.every(k=>this.keys.has(k)); }
  checkQCF(facingRight){
    const seq = facingRight ? ['right','down'] : ['left','down'];
    let i=0, last=Infinity;
    for(const e of this.buffer){
      if(e.k===seq[i] && e.t <= last+150){ i++; last=e.t; if(i===seq.length) return true; }
    }
    return false;
  }
}
const map1 = { KeyA:'left', KeyD:'right', KeyW:'up', KeyS:'down', KeyF:'lp', KeyG:'hp', KeyR:'plane' };
const map2 = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down', KeyK:'lp', KeyL:'hp', KeyP:'plane' };
const in1 = new Input(map1), in2 = new Input(map2);
addEventListener('keydown', e=>{ in1.onKey(true,e.code); in2.onKey(true,e.code); });
addEventListener('keyup',   e=>{ in1.onKey(false,e.code); in2.onKey(false,e.code); });

// ユーティリティ
function rectsOverlap(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

// キャラクター基底
class Character {
  constructor(opts){
    Object.assign(this, {
      x:W*0.5, y:GROUND_Y, vx:0, vy:0,
      plane:0, facing:1, grounded:true, crouch:false,
      hp:100, stun:0, dead:false, guardTimer:0, guarding:false,
      attack:null, switchLock:false, homingLock:false, clinch:0,
      color:'#4ad', name:'Fighter',
      speed:3.6, jumpV:-15, body:{w:48,h:86, pad:6},
      atlas: atlasDefault, sheet:null,
      specials:{
        lunge: ()=>this.startAttack('lunge'),
        antiAir: ()=>this.startAttack('antiAir'),
      }
    }, opts||{});
    this.anim = {state:'idle', t:0, i:0, fps:null};
  }

  rect(){ return {x:this.x-this.body.w/2, y:this.y-this.body.h, w:this.body.w, h:this.body.h}; }
  getHurtbox(){ const r=this.rect(); return {x:r.x+this.body.pad, y:r.y+PLANES[this.plane], w:r.w-this.body.pad*2, h:r.h}; }

  getHitbox(){
    if(!this.attack || !this.attack.hit) return null;
    const a=this.attack.hit;
    const y = this.rect().y + a.dy + PLANES[this.plane];
    const x = this.x + a.dx - (a.w/2);
    return {x, y, w:a.w, h:a.h, dmg:a.dmg, stun:a.stun, knock:a.knock, prio:a.prio};
  }

  updateGuard(input, other){
    const holdBack = (this.facing===1 && input.pressed('left')) || (this.facing===-1 && input.pressed('right'));
    this.guarding = this.grounded && this.plane===other.plane && holdBack;
    this.guardTimer = this.guarding ? 3 : Math.max(0, this.guardTimer-1);
  }

  takeHit(info, wasBlocked=false){
    if(this.dead) return;
    let dmg = info.dmg, kb = info.knock, stun = info.stun;
    if(wasBlocked){
      dmg = Math.max(2, Math.floor(dmg*0.2)); // 削り
      kb = Math.floor(kb*0.3);
      stun = Math.max(6, Math.floor(stun*0.6));
      this.guardTimer = 6;
      this.setAnim('guard');
    }else{
      this.setAnim('hit');
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.vx += kb * (info.from.x < this.x ? 1 : -1);
    this.vy -= 2;
    this.stun = Math.max(this.stun, stun);
    if(this.hp<=0){ this.dead=true; this.setAnim('down'); showAnn('K.O.', 180); }
  }

  startAttack(kind){
    if(this.dead || this.attack) return;
    if(kind==='lp'){
      this.attack={t:14, hit:{w:30,h:16,dx:this.facing*36,dy:-50,dmg:6,stun:8,knock:6,prio:1}};
      this.setAnim('atk', 12);
    }else if(kind==='hp'){
      this.attack={t:20, hit:{w:36,h:22,dx:this.facing*42,dy:-48,dmg:12,stun:12,knock:10,prio:2}};
      this.setAnim('atk', 16);
    }else if(kind==='lunge'){ // 突進
      this.attack={t:22, hit:{w:28,h:22,dx:this.facing*52,dy:-46,dmg:9,stun:12,knock:12,prio:2}};
      this.vx += this.facing*7;
      this.setAnim('atk', 18);
      showAnn('RUSH', 35);
    }else if(kind==='antiAir'){ // 対空
      this.attack={t:18, hit:{w:26,h:32,dx:this.facing*20,dy:-70,dmg:11,stun:14,knock:8,prio:3}};
      this.vy = -16;
      this.setAnim('atk', 14);
      showAnn('RISE', 35);
    }else if(kind==='projectile'){ // 飛び道具
      projectiles.push(new Projectile(this, this.facing));
      this.attack={t:12, hit:null};
      this.setAnim('atk', 10);
      showAnn('SPECIAL', 35);
    }
    this.stun = 6;
  }

  tryHoming(input, other){
    if(this.homingLock || this.attack || this.dead) return;
    if(input.chord('lp','hp') && this.plane !== other.plane){
      this.homingLock = true;
      this.plane = other.plane;
      this.vx = this.facing*8;
      this.attack = {t:16, hit:{w:24,h:18,dx:this.facing*34,dy:-52,dmg:7,stun:8,knock:6,prio:2}};
      this.setAnim('atk', 14);
      showAnn('HOMING', 35);
      setTimeout(()=>this.homingLock=false, 350);
    }
  }

  setAnim(state, forceFps){
    if(this.anim.state!==state){ this.anim={state,t:0,i:0,fps:forceFps||null}; }
  }

  handleClinch(other){
    const hbA = this.getHurtbox(), hbB = other.getHurtbox();
    if(this.plane===other.plane && rectsOverlap(hbA, hbB) && !this.attack && !other.attack){
      this.clinch = 8; other.clinch = 8;
      const sep = (this.facing===1)?-1:1;
      this.x += 2*sep; other.x -= 2*sep;
    }else{
      this.clinch = Math.max(0, this.clinch-1);
    }
  }

  update(input, other){
    if(this.dead) return;
    this.facing = this.x < other.x ? 1 : -1;
    this.updateGuard(input, other);

    if(this.stun>0){ this.stun--; this.advanceAnim(); return; }

    const speed = this.crouch ? this.speed*0.55 : this.speed;
    if(input.pressed('left'))  this.vx += -speed;
    if(input.pressed('right')) this.vx +=  speed;

    this.crouch = input.pressed('down') && this.grounded;
    if(input.pressed('up') && this.grounded){ this.vy = this.jumpV; this.grounded=false; }

    if(input.pressed('plane') && !this.switchLock){
      this.plane = (this.plane+1)&1;
      this.switchLock = true; setTimeout(()=>this.switchLock=false, 220);
      showAnn(this.plane===0?'FRONT':'BACK', 45);
    }

    this.tryHoming(input, other);

    if(!this.attack){
      const qcf = input.checkQCF(this.facing===1);
      if(qcf && input.pressed('lp')) this.startAttack('projectile');
      else{
        if(input.pressed('lp')) this.startAttack('lp');
        if(input.pressed('hp')) this.startAttack('hp');
      }
      if(input.pressed('hp') && input.pressed('down')) this.specials.antiAir();
      if(input.pressed('hp') && ((this.facing===1 && input.pressed('right')) || (this.facing===-1 && input.pressed('left')))) this.specials.lunge();
    }

    this.vy += GRAV;
    this.x += this.vx; this.y += this.vy;
    this.vx *= FRICTION;

    if(this.y >= GROUND_Y){ this.y = GROUND_Y; this.vy = 0; this.grounded=true; }
    this.x = Math.max(40, Math.min(W-40, this.x));

    this.handleClinch(other);

    if(this.attack){ this.attack.t--; if(this.attack.t<=0) this.attack=null; }

    this.advanceAnim(input);
  }

  advanceAnim(){
    let st='idle';
    if(this.dead) st='down';
    else if(this.stun>0) st='hit';
    else if(this.guarding || this.guardTimer>0) st='guard';
    else if(this.attack) st='atk';
    else if(!this.grounded) st='jump';
    else if(Math.abs(this.vx)>0.6) st='walk';

    this.setAnim(st, this.anim.fps);
    const def = this.atlas[st] || atlasDefault.idle;
    const fps = this.anim.fps || def.fps;
    this.anim.t += 1;
    if(this.anim.t >= 60/fps){ this.anim.t=0; this.anim.i=(this.anim.i+1)%def.frames; }
  }

  draw(){
    const pOffset = PLANES[this.plane];
    const shadowY = GROUND_Y + 8 + pOffset;
    // 影
    ctx.globalAlpha = .25;
    ctx.beginPath(); ctx.ellipse(this.x, shadowY, 28, 10, 0, 0, Math.PI*2); ctx.fillStyle='#000'; ctx.fill();
    ctx.globalAlpha = 1;

    const st = this.anim.state;
    const def = this.atlas[st] || atlasDefault.idle;
    const sx = def.w * this.anim.i;
    const sy = def.y, sw = def.w, sh = def.h;

    const scale = 1.0;
    const dw = sw*scale, dh = sh*scale;
    const dx = Math.round(this.x - (this.facing===1 ? dw*0.55 : dw*0.45));
    const dy = Math.round(this.rect().y + pOffset - (sh - this.body.h));

    const sheet = this.sheet;
    if(sheet && sheet.complete && sheet.naturalWidth){
      ctx.save();
      if(this.facing===-1){
        ctx.translate(dx+dw, dy);
        ctx.scale(-1,1);
        ctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, dw, dh);
      }else{
        ctx.drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh);
      }
      ctx.restore();
      // 攻撃可視化（デバッグしたい時はコメント解除）
      // if(this.attack && this.attack.hit){ const h=this.getHitbox(); ctx.globalAlpha=.35; ctx.fillStyle='#f5d90a'; ctx.fillRect(h.x, h.y, h.w, h.h); ctx.globalAlpha=1; }
    }else{
      // フォールバック矩形
      const r=this.rect();
      ctx.fillStyle=this.color;
      ctx.fillRect(r.x, r.y+pOffset, r.w, r.h);
      ctx.fillStyle='#fff';
      ctx.fillRect(this.x + (this.facing===1?10:-14), r.y+pOffset+16, 4, 4);
      if(this.attack && this.attack.hit){
        const h=this.getHitbox(); ctx.globalAlpha=.6; ctx.fillStyle='#f5d90a'; ctx.fillRect(h.x, h.y, h.w, h.h); ctx.globalAlpha=1;
      }
    }
  }
}

// 飛び道具
class Projectile {
  constructor(owner, dir){
    this.owner=owner; this.dir=dir; this.x=owner.x + dir*30; this.y=GROUND_Y-18; this.v=6*dir; this.w=22; this.h=14;
    this.plane = owner.plane; this.alive=true;
  }
  update(){ this.x += this.v; if(this.x<-40||this.x>W+40) this.alive=false; }
  draw(){ const p=PLANES[this.plane]; ctx.fillStyle='#f5d90a'; ctx.fillRect(this.x-this.w/2, this.y-this.h+p, this.w, this.h); }
  hitInfo(){ return {dmg:10, stun:10, knock:8, from:this.owner}; }
}
const projectiles = [];

// キャラ差分
class Hero extends Character{
  constructor(x){
    super({x, color:'#4ad', name:'Hero', sheet: heroSheet,
      speed:3.8, jumpV:-15.5, body:{w:46,h:84,pad:6},
      specials:{
        lunge: ()=>{ this.startAttack('lunge'); this.vx+=this.facing*1; },
        antiAir: ()=>this.startAttack('antiAir'),
      }
    });
  }
}
class Rival extends Character{
  constructor(x){
    super({x, color:'#d44', name:'Rival', sheet: rivalSheet,
      speed:3.2, jumpV:-16.5, body:{w:50,h:88,pad:8},
      specials:{
        lunge: ()=>this.startAttack('lunge'),
        antiAir: ()=>{ this.startAttack('antiAir'); this.attack.hit.dmg+=2; },
      }
    });
  }
}

// セットアップ
const p1 = new Hero(W*0.3);
const p2 = new Rival(W*0.7);

function resetRound(){
  for(const p of [p1,p2]){
    p.y=GROUND_Y; p.vx=p.vy=0; p.plane=0; p.stun=0; p.attack=null; p.dead=false; p.guarding=false; p.guardTimer=0; p.homingLock=false;
  }
  projectiles.length=0;
  showAnn('READY?', 60);
  setTimeout(()=>showAnn('FIGHT!', 60), 1000);
  state='fight';
}
showAnn('ROUND 1', 60);
setTimeout(resetRound, 900);

// ステージ描画
function drawStage(){
  ctx.clearRect(0,0,W,H);
  for(const p of PLANES){
    ctx.globalAlpha=.25;
    ctx.fillStyle='#ddd';
    for(let x=40;x<W;x+=80){ ctx.fillRect(x, GROUND_Y+p, 40, 4); }
    ctx.globalAlpha=1;
  }
  for(let i=0;i<18;i++){
    const x = 40 + i*(W-80)/17, h = 16 + (i%5)*4;
    ctx.globalAlpha=.12; ctx.fillStyle='#000';
    ctx.fillRect(x, GROUND_Y-120, 10, h);
  }
}

// メインループ
function update(){
  drawStage();

  if(state==='fight'){
    p1.update(in1, p2);
    p2.update(in2, p1);

    function resolveAttack(attacker, defender){
      if(attacker.attack && attacker.attack.hit && attacker.plane===defender.plane){
        const h = attacker.getHitbox(), hurt = defender.getHurtbox();
        if(h && rectsOverlap(h, hurt)){
          const blocked = defender.guarding;
          defender.takeHit({...h, from:attacker}, blocked);
          attacker.attack=null;
        }
      }
    }
    resolveAttack(p1,p2);
    resolveAttack(p2,p1);

    for(const pr of projectiles){
      pr.update(); pr.draw();
      if(!pr.alive) continue;
      const target = (pr.owner===p1)?p2:p1;
      if(pr.plane===target.plane){
        const box={x:pr.x-pr.w/2,y:pr.y-pr.h+PLANES[pr.plane],w:pr.w,h:pr.h};
        if(rectsOverlap(box, target.getHurtbox())){
          const blocked = target.guarding;
          const info = pr.hitInfo();
          if(blocked){ info.dmg = Math.max(2, Math.floor(info.dmg*0.2)); info.knock = Math.floor(info.knock*0.3); info.stun = Math.max(6, Math.floor(info.stun*0.6)); }
          target.takeHit({...info, from:pr.owner}, blocked);
          pr.alive=false;
        }
      }
    }
    for(let i=projectiles.length-1;i>=0;i--) if(!projectiles[i].alive) projectiles.splice(i,1);

    hp1El.style.width = `${p1.hp}%`;
    hp2El.style.width = `${p2.hp}%`;

    if(p1.dead || p2.dead){
      state='over';
      setTimeout(()=>{
        round++; roundEl.textContent=`ROUND ${round}`;
        p1.hp=100; p2.hp=100;
        resetRound();
      }, 2200);
    }
  }

  [p1,p2].sort((a,b)=>a.plane-b.plane || a.y-b.y).forEach(p=>p.draw());
  requestAnimationFrame(update);
}
update();
