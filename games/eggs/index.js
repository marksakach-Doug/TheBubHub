export const meta = {
  id: 'eggs',
  title: 'Eggs',
  players: { min: 2, max: 8 },
  color: '#d6a05c',
  fill: true,
  icon: '🥚',
  desc: 'Bounce and splat around a chicken coop, growing bigger with beans while you knock rivals off the edge.',
  soloable: true
};

export function init(ctx) {
  return {
    inputs: {},
    hostState: null,
    players: ctx.atTable.map(p => ({ id: p.id, name: p.name, bot: false })),
    matchId: Math.random().toString(36).slice(2)
  };
}

export function reduce(state, action, ctx) {
  if (action.type === 'JOIN') {
    if (!state.players.find(p => p.id === action.player.id)) {
      return { ...state, players: [...state.players, { ...action.player, bot: false }] };
    }
    return state;
  }
  if (action.type === 'INPUT') {
    return {
      ...state,
      inputs: { ...state.inputs, [ctx.from.id]: action.inp }
    };
  }
  if (action.type === 'SYNC' && ctx.from.host) {
    return { ...state, hostState: action.hostState };
  }
  if (action.type === 'MATCH_ID' && ctx.from.host) {
    return { ...state, matchId: action.matchId };
  }
  return state;
}

export function project(state, playerId) {
  return state;
}

export function roundId(state) {
  return state.matchId || 'match';
}

export function summarize(state, nameOf) {
  if (!state.hostState || !state.hostState.matchOver || !state.hostState.roundWinner) return null;
  // roundWinner is `{id, name}` — it has no idx, and one client crashed reading
  // one. Guard the id so a malformed winner records nothing rather than writing
  // "undefined won a match of Eggs!" onto the shared sheet.
  const id = state.hostState.roundWinner.id;
  if (!id) return null;
  let who = null;
  try { who = nameOf(id); } catch (e) { who = null; }
  if (!who) return null;
  return `${who} won a match of Eggs!`;
}

// `players` holds objects, not ids, so the hub's prunePlayerState() (which does
// players.indexOf(goneId)) can never find a leaver. Without this, a departed
// player keeps a seat in the lobby and leaks their input forever.
export function prune(state, goneId) {
  if (!state || !Array.isArray(state.players)) return state;
  if (!state.players.some(function (p) { return p && p.id === goneId; })) return state;
  const next = { ...state, players: state.players.filter(function (p) { return p && p.id !== goneId; }) };
  if (next.inputs && next.inputs[goneId] !== undefined) {
    const inputs = { ...next.inputs };
    delete inputs[goneId];
    next.inputs = inputs;
  }
  return next;
}

export function mount(root, api) {
  root.innerHTML = `
    <style>
    :host { display: block; width: 100%; height: 100%; background: #0d0a06; overflow: hidden; touch-action: none; }
    .wrap { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
    canvas { display: block; background: #1c160e; outline: none; max-width: 100%; max-height: 100%; object-fit: contain; }
    </style>
    <div class="wrap"><canvas width="1400" height="900" tabindex="0"></canvas></div>
  `;

  const cv = root.querySelector('canvas');
  const ctx = cv.getContext('2d');

  const W=1400, H=900, GRAV0=1700;
  let GRAV=GRAV0, JV=1, MOVE_MAX=300, ACC_G=1400, ACC_A=700, GFRIC=0.85, FRIC=0.4,
      DMG_KB=60, PU_GAP=16, PU_MAX=1, SPAWN_TIER=0, timeScale=1, DMG_CAP=400;

  const COLORS=[
   {name:'white',shell:'#f8fafc',spot:'#cbd5e1'},
   {name:'brown',shell:'#a16207',spot:'#713f12'},
   {name:'baby blue',shell:'#bae6fd',spot:'#38bdf8'},
   {name:'easter',shell:'#f0abfc',spot:'#4ade80'},
   {name:'mint',shell:'#a7f3d0',spot:'#059669'},
   {name:'crimson',shell:'#fecaca',spot:'#dc2626'},
   {name:'lavender',shell:'#e9d5ff',spot:'#9333ea'},
   {name:'slate',shell:'#94a3b8',spot:'#334155'}
  ];
  function colorOf(i){return COLORS[i%COLORS.length];}
  function rnd(a,b){return a+Math.random()*(b-a);}

  const MUTS=[
   {id:'moon',name:'MOON COOP',desc:'Low gravity. Everybody floats.'},
   {id:'ice',name:'ICE RINK',desc:'The perches are slippery.'},
   {id:'turbo',name:'TURBO',desc:'The whole coop runs 25% faster.'},
   {id:'glass',name:'GLASS EGGS',desc:'Damage causes extreme fragility.'},
   {id:'flood',name:'POWER FLOOD',desc:'Power-ups keep dropping in.'},
   {id:'giant',name:'SUPERSIZE',desc:'Everyone starts BIG.'}
  ];

  let plats=[], eggs=[], decals=[], parts=[], bombs=[], pus=[];
  let levelName='world', scene='lobby', mode='stocks', roundT=0, puCD=5, puIdx=0, nest=null, mut=null;
  let mover={x:100,y:H-170,w:150,h:16,dx:0,dy:0,sp:45,by:''}, moverD=0, moverSpeed=45, mdriver='';
  let board=null, peg=null;
  let matchOver=false, roundWinner=null, overtime=false, hurryShown=false, lastCount=0;
  let ban=null, lastMutId='', COUNT=2.6, roundNo=0, roundsNeed=3, sceneT=0;
  
  let cfg = { mode: 0, rounds: 1, chaos: 1, cpu: 0 };
  const ROWS = ['mode', 'match', 'chaos', 'cpu', 'start'];

  // Three round types. STOCKS is three lives each; SPLAT RACE is ninety seconds
  // and most smashes wins; KING OF THE NEST is a moving nest that only counts
  // while one egg is sitting in it alone. Nest was a real mode in the standalone
  // build and arrived here as a dead drawNest() — nest was in the state, never
  // created, so nothing rendered and nothing scored.
  const MODES = [
   { id: 'stocks', name: 'STOCKS', desc: 'Three lives each. Last egg standing takes the round.' },
   { id: 'timed', name: 'SPLAT RACE', desc: '90 seconds on the clock. Most smashes wins the round.' },
   { id: 'nest', name: 'KING OF THE NEST', desc: 'Hold the glowing nest alone. First to 25 seconds wins.' }
  ];
  const NEST_WIN = 25, NEST_MOVE_EVERY = 20;
  
  const NOINP = {ax:0, jump:false, brake:false, up:false, dash:false, item:false};

  function applyMut(m){
   GRAV=GRAV0;JV=1;MOVE_MAX=300;ACC_G=1400;ACC_A=700;GFRIC=0.85;FRIC=0.4;DMG_KB=60;PU_GAP=16;PU_MAX=1;SPAWN_TIER=0;timeScale=1;
   if(!m)return;
   if(m.id==='moon'){GRAV=GRAV0*0.55;JV=0.78;}
   else if(m.id==='ice'){GFRIC=0.987;ACC_G=520;ACC_A=420;FRIC=0.05;}
   else if(m.id==='turbo'){timeScale=1.25;}
   else if(m.id==='glass'){DMG_KB=28;} // Kept for reference but knockback scaling is disabled
   else if(m.id==='flood'){PU_GAP=5;PU_MAX=3;}
   else if(m.id==='giant'){SPAWN_TIER=1;}
  }

  function newWorld(){
   plats=[];
   plats.push({x:W/2,y:H-16,w:W,h:64});
   plats.push({x:W/2,y:-40,w:W*2,h:60}); // Invisible ceiling to prevent hiding off screen
   var y=260; // Spawn height explicitly lowered
   plats.push({x:W/2,y:170,w:450,h:18}); // Top middle platform, much wider and lower than before
   while(y<H-160){
    var cx=rnd(160,W-160), w=rnd(250,420), tilt=rnd(-0.1,0.1); // Flatter and wider platforms
    plats.push({x:cx,y:y,w:w,h:16,a:tilt});
    if(Math.random()<0.4) plats.push({x:rnd(130,W-130),y:y-60,w:rnd(180,260),h:14,a:rnd(-0.1,0.1)});
    y+=rnd(90,120); // Closer gaps so no platform is unreachable
   }
   levelName='world '+Math.floor(Math.random()*9000+1000);
   pus=[]; bombs=[]; puCD=5; puIdx=(Math.random()*4)|0;
   moverD=0; moverSpeed=45; mdriver='';
   var mp0=sampleMover(0); mover.x=mp0.x; mover.y=mp0.y; mover.dx=0; mover.dy=0; mover.sp=45; mover.by='';
   peg={x:rnd(150,W-150)};
   board={x:(peg.x<W/2?W-150:150),y:H-63,w:90,h:10,vx:0,vy:0,ground:true,rider:-1,stuck:0,flip:0,air:0};
   decals=[]; parts=[];
   buildCoop();
  }

  function spawnEgg(idx, r){
   return{idx:idx, id:r.id, name:r.name, bot:!!r.bot, x:W/2, y:60, vx:0, vy:0, r:17, ground:false, dead:0, deadT:0,
    inv:0, starT:0, bigTier:0, dmg:0, legs:0, struggle:0, cracks:0, splats:0, kills:0, face:1,
    holding:-1, heldBy:-1, holdT:0, throwCD:0, thrownT:0, thrownById:null,
    jumps:0, prevJump:false, jumpBuf:0, riding:false, sq:0, onMover:false, lastInp:null, jumpHold:0, noBoard:0,
    stocks:3, pts:0, nestPts:0, wins:0, dashT:0, dashCD:0, prevDash:false, prevItem:false, bombs:0, bombCD:0, shoveT:0,
    inp:NOINP, diedAt:0, ai:null};
  }
  
  const TIER_R=[17,26,36,46], TIER_NAME=['','BIG','HUGE','TITAN'];
  function syncSize(g){g.r=TIER_R[g.bigTier||0]||17;}
  
  function releaseHold(g){
   if(g.holding>=0){var v=eggs[g.holding];if(v&&v.heldBy===g.idx){v.heldBy=-1;v.vx=g.vx;v.vy=g.vy;v.struggle=0;}g.holding=-1;g.holdT=0;}
   if(g.heldBy>=0){var h=eggs[g.heldBy];if(h&&h.holding===g.idx){h.holding=-1;h.holdT=0;}g.heldBy=-1;}
   g.struggle=0;
  }
  function dismount(g){g.riding=false;if(board&&board.rider===g.idx)board.rider=-1;}
  function respawn(g,quiet,sx){
   releaseHold(g);dismount(g);
   g.x=(sx!=null)?sx:rnd(160,W-160);g.y=50;g.vx=rnd(-80,80);g.vy=0;g.dead=0;g.inv=1.5;g.starT=0;
   g.bigTier=SPAWN_TIER;syncSize(g);g.dmg=0;g.legs=0;g.struggle=0;g.holding=-1;g.heldBy=-1;g.holdT=0;g.thrownT=0;g.thrownById=null;
   g.jumps=0;g.prevJump=false;g.jumpBuf=0;g.sq=0;g.jumpHold=0;g.noBoard=0;
   g.dashT=0;g.dashCD=0;g.bombs=0;g.bombCD=0;g.shoveT=0;g.prevDash=false;g.prevItem=false;
   if(!quiet)burst(g.x,g.y,10,60,220,.5,3,['#fff','#fde68a'],0);
  }

  function circleRect(x,y,r,p){
   var a=p.a||0,c=Math.cos(a),s=Math.sin(a);
   var dx=x-p.x,dy=y-p.y;
   var lx=dx*c+dy*s, ly=-dx*s+dy*c;
   var hw=p.w/2,hh=p.h/2;
   var cx=Math.max(-hw,Math.min(lx,hw)),cy=Math.max(-hh,Math.min(ly,hh));
   var ddx=lx-cx,ddy=ly-cy,d=Math.hypot(ddx,ddy);
   if(d>=r)return null;
   var nx,ny;
   if(d>0.01){nx=ddx/d;ny=ddy/d;}else{nx=0;ny=-1;}
   return{nx:nx*c-ny*s,ny:nx*s+ny*c,pen:r-d};
  }

  function hitRect(g,p,inp){
   var h=circleRect(g.x,g.y,g.r,p);
   if(!h)return false;
   g.x+=h.nx*h.pen;g.y+=h.ny*h.pen;
   var vn=g.vx*h.nx+g.vy*h.ny;
   if(vn<0){
    var tier=g.bigTier||0;
    // FRAGILITY OVERHAUL: Damage lowers threshold exponentially instead of knockback multiplier
    var lethal=950-180*tier - (g.dmg * 3.5);
    var side=800-150*tier - (g.dmg * 3.5);
    if(g.thrownT>0){lethal-=400;side-=300;}
    var attackerId=(g.thrownT>0&&g.thrownById)?g.thrownById:null;
    var kill=!attackerId&&(g.inv>0||g.starT>0)?false:true;
    if(h.ny<-0.5){
     g.ground=true;g.jumps=0;
     if(vn<-lethal&&kill){hurt(g,attackerId||undefined,'SPLAT!',26);return true;}
     else if(vn<-650){g.cracks++;g.sq=1;addDmg(g,5);burst(g.x,g.y,6,40,160,.4,2,['#fff'],0);}
     g.vy*=-0.35; // REMOVED knockMul multiplier so they don't bounce out of bounds arbitrarily
     g.vx*=GFRIC;
     if(g.jumpBuf>0){g.jumpBuf=0;g.vy=-660*JV*(1-0.12*tier);g.vx+=inp.ax*120;g.ground=false;g.jumps=1;}
    }else{
     g.vx-=1.7*vn*h.nx;g.vy-=1.7*vn*h.ny;
     if(Math.abs(vn)>side&&kill){hurt(g,attackerId||undefined,'SPLAT!',26);return true;}
    }
   }else if(h.ny<-0.5){
    g.ground=true;g.jumps=0;
    if(g.jumpBuf>0){g.jumpBuf=0;g.vy=-660*JV;g.vx+=inp.ax*120;g.ground=false;g.jumps=1;}
   }
   return false;
  }
  
  function collidePlats(g,inp){
   for(var i=0;i<plats.length;i++){if(hitRect(g,plats[i],inp))return;}
   if(mover)hitRect(g,mover,inp);
  }
  function boardGround(){
   var pts=[board.x-board.w/2+8,board.x,board.x+board.w/2-8],best=null;
   for(var k=0;k<3;k++)for(var i=0;i<plats.length;i++){
    var h=circleRect(pts[k],board.y+board.h/2,6,plats[i]);
    if(h&&(!best||h.pen>best.pen))best=h;
   }
   return best;
  }
  
  function stepBoard(dt){
   if(!board)return;
   if(board.rider>=0&&(!eggs[board.rider]||!eggs[board.rider].riding))board.rider=-1;
   if(board.stuck>0){
    board.stuck-=dt;board.vx=0;board.vy=0;
    if(board.stuck<=0&&board.rider<0){
     board.x=peg&&peg.x<W/2?W-150:150;
     board.y=H-63;board.flip=0;board.air=0;board.ground=true;
    }
    return;
   }
   var ridden=board.rider>=0;
   if(!ridden){board.vx=0;}
   board.x+=board.vx*dt;
   board.vy=Math.min(board.vy+GRAV*dt,1500);
   board.y+=board.vy*dt;
   if(board.x<80){board.x=80;board.vx=Math.abs(board.vx);}
   if(board.x>W-80){board.x=W-80;board.vx=-Math.abs(board.vx);}
   board.ground=false;
   var h=boardGround();
   if(h){
    board.x+=h.nx*h.pen;board.y+=h.ny*h.pen;
    if(h.ny<-0.5){board.vy=0;board.ground=true;board.flip=0;board.air=0;}
    else{var vd=board.vx*h.nx+board.vy*h.ny;if(vd<0){board.vx-=vd*h.nx;board.vy-=vd*h.ny;}}
   }else{board.air+=dt;}
   if(!board.ground)board.flip=Math.min(board.air,0.75)/0.75*Math.PI*2;
   if(ridden&&peg&&board.y>H-110&&Math.abs(board.x-peg.x)<24){
    var bv=board.vx;
    board.stuck=2;board.vx=0;board.vy=0;
    var ri=board.rider,rider=ri>=0?eggs[ri]:null;
    if(rider&&!rider.dead){
     rider.riding=false;board.rider=-1;
     rider.vx=bv*1.5+(rider.x>=peg.x?380:-380);rider.vy=-720;
     rider.inv=0;rider.thrownT=1.2;rider.thrownById=null;rider.jumps=1;
     popText(rider.x,rider.y-30,'WIPEOUT!');
     burst(rider.x,rider.y,14,80,320,.6,3,['#fff','#d6a05c','#e0432f'],0);
    }else{
     popText(board.x,board.y-30,'CLUNK!');
     burst(board.x,board.y,8,40,160,.4,2,['#d6a05c','#fff'],0);
    }
   }
  }

  function collideEgg(g,dt){
   var jm=(1-0.12*(g.bigTier||0))*JV;
   var inp=g.inp||NOINP;
   if(g.heldBy>=0){
    if(!g.dead){
     if(inp.jump&&!g.prevJump){g.struggle+=0.34;burst(g.x,g.y,3,20,90,.3,2,['#fff'],0);}
     if(g.struggle>=1){
      var hh=eggs[g.heldBy];
      releaseHold(g);
      g.vy=-420;g.vx=(g.face||1)*160;g.jumps=1;
      if(hh)hh.throwCD=Math.max(hh.throwCD,2.5);
      popText(g.x,g.y-30,'WIGGLE FREE!');
      burst(g.x,g.y,12,60,240,.5,3,['#fff','#bae6fd'],0);
     }
    }
    g.prevJump=!!inp.jump;g.prevDash=!!inp.dash;g.prevItem=!!inp.item;
    return;
   }
   if(inp.ax!==0)g.face=inp.ax>0?1:-1;
   if(inp.jump&&!g.prevJump)g.jumpBuf=0.15;
   g.prevJump=!!inp.jump;
   g.lastInp=inp;
   if(inp.dash&&!g.prevDash&&g.dashCD<=0&&!g.riding)doDash(g,inp);
   g.prevDash=!!inp.dash;
   if(inp.item&&!g.prevItem&&g.bombs>0&&g.bombCD<=0)throwBomb(g);
   g.prevItem=!!inp.item;
   if(g.riding&&board){
    if(inp.ax!==0)g.face=inp.ax>0?1:-1;
    board.vx+=inp.ax*(board.ground?900:360)*dt;
    board.vx=Math.max(-260,Math.min(260,board.vx));
    if(inp.jump)g.jumpHold=(g.jumpHold||0)+dt;else g.jumpHold=0;
    if(g.jumpHold>0.45){
     g.jumpHold=0;g.jumpBuf=0;g.noBoard=0.6;
     g.riding=false;board.rider=-1;g.vy=-300;g.vx=board.vx;g.jumps=1;
     return;
    }
    if(inp.brake){
     g.riding=false;board.rider=-1;g.vy=-300;g.vx=board.vx;g.jumps=1;
     return;
    }
    if(g.ground){
     if(g.jumpBuf>0){
      g.jumpBuf=0;
      g.vy=-780*jm;g.vx=board.vx+inp.ax*60;g.jumps=1;g.sq=-0.5;g.ground=false;
      board.vy=-780*jm;board.ground=false;
      burst(g.x,g.y+g.r,8,40,160,.4,2.5,['#fff','#d6a05c'],0);
     }else{
      g.x=board.x;
      g.y=board.y-5-g.r;g.vy=0;g.vx=board.vx;g.ground=true;g.jumps=0;
      return;
     }
    }
    g.vy=Math.min(g.vy+GRAV*dt,1500);
    g.x=board.x;g.y+=g.vy*dt;g.vx=board.vx;
    g.ground=false;collidePlats(g,inp);
    if(g.dead)return;
    if(g.vy>=0&&Math.abs((g.y+g.r)-(board.y-5))<12&&Math.abs(g.x-board.x)<board.w/2+6){
     g.y=board.y-5-g.r;g.vy=0;g.vx=board.vx;g.ground=true;g.jumps=0;
    }else if(g.ground){
     g.riding=false;if(board.rider===g.idx)board.rider=-1;
    }
    return;
   }
   var ACC=g.ground?ACC_G:ACC_A,MAX=MOVE_MAX;
   if(inp.ax<0&&g.vx>-MAX)g.vx-=ACC*dt;
   if(inp.ax>0&&g.vx<MAX)g.vx+=ACC*dt;
   if(inp.brake)g.vx*=Math.exp(-6*dt);
   g.vx*=Math.exp(-FRIC*dt);
   var travel=(Math.abs(g.vx)+Math.abs(g.vy))*dt;
   var steps=Math.min(8,Math.max(1,Math.ceil(travel/8))),h=dt/steps;
   for(var s=0;s<steps&&!g.dead;s++){
    g.vy=Math.min(g.vy+GRAV*h*(g.dashT>0?0.15:1),1500);
    g.x+=g.vx*h;g.y+=g.vy*h;
    g.ground=false;
    collidePlats(g,inp);
    if(!g.dead&&g.jumpBuf>0&&!g.ground&&g.jumps<2){
     g.jumpBuf=0;g.jumps=2;g.vy=-580*jm;g.vx+=inp.ax*80;
     burst(g.x,g.y+14,8,40,160,.4,2.5,['#fff','#bae6fd'],0);
    }
   }
   if(g.dead)return;
   if(g.ground&&mover&&Math.abs(g.x-mover.x)<mover.w/2+g.r*0.5&&Math.abs((g.y+g.r)-mover.y)<12){
    g.x+=mover.dx;g.y+=mover.dy;g.onMover=true;
   }
   if(!g.riding&&!g.dead&&board&&g.noBoard<=0&&g.vy>=0&&
      Math.abs((g.y+g.r)-(board.y-5))<12&&Math.abs(g.x-board.x)<board.w/2+6){
    g.riding=true;board.rider=g.idx;
    g.y=board.y-5-g.r;g.vy=0;g.vx=board.vx;g.ground=true;g.jumps=0;
    if(g.legs>0)g.legs=0;
    releaseHold(g);
    burst(g.x,g.y+g.r,6,30,120,.35,2,['#fff','#d6a05c'],0);
   }
   if(g.dead)return;
   if(g.x<20){g.x=20;g.vx=Math.abs(g.vx)*0.5;}
   if(g.x>W-20){g.x=W-20;g.vx=-Math.abs(g.vx)*0.5;}
   if(g.y>H+60){g.inv=0;g.starT=0;splat(g,'ABYSS!',null,true);}
  }

  function doDash(g,inp){
   var dir=inp.ax!==0?(inp.ax>0?1:-1):(g.face||1);
   g.face=dir;g.dashCD=0.9;g.dashT=0.2;
   g.vx=dir*580;g.vy=g.ground?-110:Math.min(g.vy,-60);g.ground=false;
   g.sq=-0.3;
   burst(g.x-dir*g.r,g.y,8,30,140,.3,2.5,['#fff','#bae6fd'],0);
  }
  
  function throwBomb(g){
   g.bombs--;g.bombCD=0.4;
   var dir=g.face||1;
   bombs.push({x:g.x+dir*(g.r+8),y:g.y-6,vx:g.vx*0.5+dir*430,vy:-340,t:0,byId:g.id,r:9});
  }
  
  function stepBombs(dt){
   for(var i=bombs.length-1;i>=0;i--){
    var b=bombs[i],j;
    b.t+=dt;b.vy=Math.min(b.vy+GRAV*dt,1400);b.x+=b.vx*dt;b.y+=b.vy*dt;
    for(j=0;j<plats.length;j++){
     var h=circleRect(b.x,b.y,b.r,plats[j]);
     if(h){b.x+=h.nx*h.pen;b.y+=h.ny*h.pen;var vn=b.vx*h.nx+b.vy*h.ny;if(vn<0){b.vx-=1.5*vn*h.nx;b.vy-=1.5*vn*h.ny;b.vx*=0.85;}}
    }
    var hm=circleRect(b.x,b.y,b.r,mover);
    if(hm){b.x+=hm.nx*hm.pen;b.y+=hm.ny*hm.pen;var vm=b.vx*hm.nx+b.vy*hm.ny;if(vm<0){b.vx-=1.5*vm*hm.nx;b.vy-=1.5*vm*hm.ny;}}
    if(b.x<10||b.x>W-10){b.vx*=-0.7;b.x=Math.max(10,Math.min(W-10,b.x));}
    var boom=b.t>1.7||b.y>H+40;
    if(!boom){
     for(j=0;j<eggs.length;j++){
      var e=eggs[j];if(e.dead)continue;
      if(e.id===b.byId&&b.t<0.45)continue;
      if(Math.hypot(e.x-b.x,e.y-b.y)<e.r+b.r+2){boom=true;break;}
     }
    }
    if(boom){explode(b);bombs.splice(i,1);}
   }
  }
  
  function explode(b){
   burst(b.x,b.y,34,120,520,.7,5,['#ffd23f','#ff7a1a','#fff','#555'],0);
   popText(b.x,b.y-20,'BOOM!');
   var R=130;
   eggs.forEach(function(e){
    if(e.dead)return;
    var dx=e.x-b.x,dy=e.y-b.y,d=Math.hypot(dx,dy);
    if(d>R||e.starT>0)return;
    releaseHold(e);dismount(e);
    var f=0.5+0.5*(1-d/R),nx=d>1?dx/d:0,ny=d>1?dy/d:-1;
    var heavy=1/(1+0.5*(e.bigTier||0));
    addDmg(e,14);
    e.vx=e.vx*0.3+nx*520*heavy*f;e.vy=Math.min(e.vy,0)+ny*520*heavy*f-200; // No knockMul multiplier
    e.thrownT=1.0;e.thrownById=(e.id===b.byId)?null:b.byId;e.shoveT=0;e.jumps=1;e.ground=false;e.inv=0;
   });
  }

  function shove(a,b){
   var dir=Math.abs(a.vx)>60?(a.vx>0?1:-1):(a.face||1);
   var heavy=1/(1+0.5*(b.bigTier||0));
   releaseHold(b);dismount(b);
   addDmg(b,12);
   b.vx=dir*380*heavy+a.vx*0.3;b.vy=-(240*heavy)-60; // No knockMul multiplier
   b.thrownT=0.9;b.thrownById=a.id;b.shoveT=0.3;b.sq=-0.4;b.jumps=Math.min(b.jumps,1);b.inv=0;b.ground=false;
   a.vx*=-0.2;a.dashT=0;
   popText(b.x,b.y-30,'BONK!');
   burst((a.x+b.x)/2,(a.y+b.y)/2,10,60,260,.4,3,['#fff','#fde68a'],0);
  }

  function eggVsEgg(a,b){
   if(a.dead||b.dead)return;
   if(a.heldBy>=0||b.heldBy>=0)return;
   var dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r-4;
   if(d>=min||d===0)return;dx/=d;dy/=d;
   var push=(min-d)/2;a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push;
   var rel=Math.abs((a.vx-b.vx)*dx+(a.vy-b.vy)*dy)+Math.abs(a.vy)+Math.abs(b.vy);
   var aStar=a.starT>0, bStar=b.starT>0;
   var aBig=a.bigTier>0, bBig=b.bigTier>0;
   if(aStar&&!bStar){splat(b,'STAR SMASH!',a.id);return;}
   if(bStar&&!aStar){splat(a,'STAR SMASH!',b.id);return;}
   if(aStar&&bStar){burst((a.x+b.x)/2,(a.y+b.y)/2,16,100,300,.6,3,['#ffd23f','#fff'],0);return;}
   if(a.legs>0&&!a.riding&&a.holding<0&&b.heldBy<0&&b.legs<=0&&a.throwCD<=0&&b.thrownT<=0){grab(a,b);return;}
   if(b.legs>0&&!b.riding&&b.holding<0&&a.heldBy<0&&a.legs<=0&&b.throwCD<=0&&a.thrownT<=0){grab(b,a);return;}
   if(aBig&&!bBig&&!bStar){splat(b,'SQUASHED!',a.id);return;}
   if(bBig&&!aBig&&!aStar){splat(a,'SQUASHED!',b.id);return;}
   if(aBig&&bBig){burst((a.x+b.x)/2,(a.y+b.y)/2,12,60,220,.5,3,['#d6a05c','#fff'],0);}
   
   var aD=a.dashT>0,bD=b.dashT>0;
   if(aD&&bD){
    var cs=a.x<b.x?-1:1;
    a.vx=cs*380;b.vx=-cs*380;a.vy=-200;b.vy=-200;a.dashT=0;b.dashT=0;
    popText((a.x+b.x)/2,(a.y+b.y)/2-24,'CLANG!');
    burst((a.x+b.x)/2,(a.y+b.y)/2,14,80,300,.5,3,['#ffd23f','#fff'],0);
    return;
   }
   if(aD){shove(a,b);return;}
   if(bD){shove(b,a);return;}

   var aSpd=Math.hypot(a.vx,a.vy),bSpd=Math.hypot(b.vx,b.vy);
   if(a.thrownT>0&&aSpd>350&&!(a.thrownById===b.id&&a.shoveT>0)){hurt(b,a.thrownById||a.id,'THROWN!',30);a.thrownT=0;a.thrownById=null;return;}
   if(b.thrownT>0&&bSpd>350&&!(b.thrownById===a.id&&b.shoveT>0)){hurt(a,b.thrownById||b.id,'THROWN!',30);b.thrownT=0;b.thrownById=null;return;}
   if(a.thrownT>0&&b.thrownT>0){burst((a.x+b.x)/2,(a.y+b.y)/2,16,100,300,.6,3,['#fff','#fca5a5'],0);a.thrownT=0;b.thrownT=0;return;}
   if(rel>700){
    // Calculate vulnerability offset based on damage
    var aVuln = Math.hypot(a.vx,a.vy)*(aBig?1+0.6*(a.bigTier||0):1) - (a.dmg * 3);
    var bVuln = Math.hypot(b.vx,b.vy)*(bBig?1+0.6*(b.bigTier||0):1) - (b.dmg * 3);
    if(Math.abs(aVuln-bVuln)<120){hurt(a,null,'MID-AIR SPLAT!',22);hurt(b,null,'MID-AIR SPLAT!',22);}
    else if(aVuln>bVuln)hurt(b,a.thrownById||a.id,'CRUNCHED!',24);else hurt(a,b.thrownById||b.id,'CRUNCHED!',24);
   }else{
    var rv=(a.vx-b.vx)*dx+(a.vy-b.vy)*dy;
    if(rv>0){a.vx-=dx*rv*0.6;a.vy-=dy*rv*0.6;b.vx+=dx*rv*0.6;b.vy+=dy*rv*0.6;}
    if(rel>380){addDmg(a,Math.round(rel/120));addDmg(b,Math.round(rel/120));}
   }
  }
  
  function grab(h,v){
   dismount(v);
   v.heldBy=h.idx;h.holding=v.idx;h.holdT=0;
   v.vx=h.vx;v.vy=h.vy;v.thrownT=0;v.thrownById=null;
   popText(h.x,h.y-44,'LIFT!');
   burst(h.x,h.y-20,8,40,160,.4,2,['#fff','#fca5a5'],0);
  }

  function splat(g,text,byId,force){
   if(g.dead)return;
   if(byId===g.id)byId=null;
   if(!force&&(g.inv>0&&!byId||g.starT>0&&!byId))return;
   releaseHold(g);dismount(g);
   g.dead=1;g.deadT=0;g.splats++;g.thrownT=0;g.dashT=0;g.bombs=0;
   decals.push({x:Math.round(g.x),y:Math.round(Math.min(H-8,g.y+8)),r:1,t:0,seed:Math.random(),sc:Math.min(2.4,(g.r||17)/17)});
   if(decals.length>30)decals.splice(0,decals.length-30);
   burst(g.x,g.y,26,80,380,.8,4,['#ffffff','#fef3c7','#fde68a'],1);
   burst(g.x,g.y,12,30,160,1,6,['#fbbf24','#f59e0b'],0);
   popText(g.x,g.y-24,text||'SPLAT!');
   var byEgg = byId ? eggs.find(e => e.id === byId) : null;
   if(byEgg){byEgg.kills++;addFeed(byEgg.name+' smashed '+g.name);}
   else addFeed(g.name+' cracked up');
   if(scene==='play'){
    if(mode==='stocks'){g.stocks=Math.max(0,g.stocks-1);g.diedAt=roundT;}
    else if(mode==='timed'){if(byEgg)byEgg.pts++;else g.pts=Math.max(0,g.pts-1);}
   }
  }
  function knockMul(g){return 1+(g.dmg||0)/DMG_KB;}
  function addDmg(g,amount){g.dmg=Math.max(0,Math.min(DMG_CAP,(g.dmg||0)+amount));}
  
  function shrinkEgg(g){
   g.bigTier=Math.max(0,(g.bigTier||0)-1);syncSize(g);
   g.inv=Math.max(g.inv,1.4);
   g.sq=-0.35;
   var km=knockMul(g);
   g.vy=Math.min(g.vy,-260*km*0.5);g.vx+=rnd(-160,160);
   var was=g.bigTier+1;
   popText(g.x,g.y-(g.r||17)-12,
    (was&&g.bigTier>0)?((TIER_NAME[was]||'BIG')+' → '+(TIER_NAME[g.bigTier]||'')+'!'):'SHRUNK!');
   burst(g.x,g.y,18,60,260,.5,3,['#fff','#d6a05c'],0);
   return true;
  }
  function hurt(g,byId,text,power){
   if(g.dead)return false;
   if(!byId&&(g.inv>0||g.starT>0))return false;
   addDmg(g,power==null?18:power);
   if(g.bigTier>0)return shrinkEgg(g);
   splat(g,text,byId);
   return false;
  }
  function popText(x,y,t){parts.push({k:'t',x:x,y:y,t:0,tx:t});}
  function burst(x,y,n,v0,v1,l,sz,cols,g){
   for(var k=0;k<n;k++){var a=Math.random()*6.283,v=v0+Math.random()*(v1-v0);
    if(parts.length<100)parts.push({k:'p',x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,l:l*(0.6+Math.random()*0.8),m:l,s:sz*(0.6+Math.random()*0.8),c:cols[k%cols.length]});}
  }

  const PU_ORDER=['star','bean','leg','bomb'];
  function pickSpot(){
   for(var tries=0;tries<8;tries++){
    var p=plats[(Math.random()*plats.length)|0];
    if(!p)continue;
    var hw=Math.max(30,p.w/2-30);
    var x=Math.max(40,Math.min(W-40,p.x+rnd(-hw,hw)));
    var y=p.y-p.h/2+(x-p.x)*Math.tan(p.a||0)-26;
    if(y<110||y>H-40)continue;
    return{x:Math.round(x),y:Math.round(y)};
   }
   return{x:Math.round(rnd(200,W-200)),y:H-90};
  }
  function puTick(rdt){
   puCD-=rdt;
   if(pus.length<PU_MAX&&puCD<=0){
    var kind=PU_MAX>1?PU_ORDER[(Math.random()*PU_ORDER.length)|0]:PU_ORDER[puIdx%PU_ORDER.length];
    puIdx++;
    var s=pickSpot();
    pus.push({k:kind,x:s.x,y:s.y,t:0,age:0});
    popText(s.x,s.y-20,kind==='star'?'STAR!':(kind==='bean'?'BEAN!':(kind==='leg'?'LEGS!':'BOMBS!')));
    puCD=PU_GAP;
   }
   pus.forEach(function(p){
    p.age+=rdt;
    if(p.age>45){var s2=pickSpot();p.x=s2.x;p.y=s2.y;p.age=0;popText(p.x,p.y-20,'MOVED!');}
   });
  }
  function applyPU(g,p){
   if(p.k==='star'){
    g.starT=10;addFeed(g.name+' grabbed the STAR');
    burst(g.x,g.y,30,100,400,1,4,['#ffd23f','#fff','#f472b6'],0);
   }else if(p.k==='bean'){
    g.bigTier=Math.min(3,(g.bigTier||0)+1);syncSize(g);
    addFeed(g.name+' ate the BEAN');
    burst(g.x,g.y,24,60,320,1,4,['#d6a05c','#a16207','#fff'],0);
    popText(g.x,g.y-34,TIER_NAME[g.bigTier]+'!');
   }else if(p.k==='bomb'){
    g.bombs=3;addFeed(g.name+' grabbed BOMBS');
    burst(g.x,g.y,24,60,320,1,4,['#555','#ffd23f','#fff'],0);
    popText(g.x,g.y-34,'BOMBS x3');
   }else{
    g.legs=20;addFeed(g.name+' grew LEGS');
    burst(g.x,g.y,24,60,320,1,4,['#fca5a5','#fff','#78350f'],0);
    popText(g.x,g.y-34,'LEGS!');
   }
  }

  function step(dt,rdt){
   var playing=(scene==='play'),i,j;
   if(playing)puTick(rdt);
   pus.forEach(function(p){p.t+=dt;});
   var mtarget=45;mdriver='';
   for(var mri=0;mri<eggs.length;mri++){var mre=eggs[mri];
    if(mre.onMover&&!mre.dead&&mre.lastInp){
     var mli=mre.lastInp;
     mtarget=(mli.up?160:(mli.brake?-120:45));mdriver=mre.name||'';break;}}
   moverSpeed+=(mtarget-moverSpeed)*Math.min(1,3*dt);
   moverD=(moverD+moverSpeed*dt)%moverPerim;
   mover.sp=Math.round(moverSpeed);mover.by=mdriver;
   var _mp=sampleMover(moverD);
   mover.dx=_mp.x-mover.x;mover.dy=_mp.y-mover.y;mover.x=_mp.x;mover.y=_mp.y;
   stepBoard(dt);
   stepBombs(dt);
   if(playing&&mode==='stocks'&&roundT>75){
    eggs.forEach(function(e){if(!e.dead)addDmg(e,2.5*rdt);});
   }
   eggs.forEach(function(g){
    g.onMover=false;
    if(g.inv>0)g.inv-=dt;
    if(g.starT>0)g.starT-=dt;
    if(g.legs>0)g.legs-=dt;
    if(g.struggle>0&&g.heldBy<0)g.struggle=Math.max(0,g.struggle-0.5*dt);
    syncSize(g);
    if(g.sq>0)g.sq=Math.max(0,g.sq-dt*4);
    if(g.sq<0)g.sq=Math.min(0,g.sq+dt*4);
    if(g.throwCD>0)g.throwCD-=dt;
    if(g.thrownT>0)g.thrownT-=dt;
    if(g.shoveT>0)g.shoveT-=dt;
    if(g.dashT>0)g.dashT-=dt;
    if(g.dashCD>0)g.dashCD-=dt;
    if(g.bombCD>0)g.bombCD-=dt;
    if(g.jumpBuf>0)g.jumpBuf-=dt;
    if(g.noBoard>0)g.noBoard-=dt;
    if(g.dead){
     g.deadT+=dt;
     if(g.deadT>1.3&&scene==='play'&&(mode!=='stocks'||g.stocks>0))respawn(g);
     return;
    }
    collideEgg(g,dt);
    for(var pi=pus.length-1;pi>=0&&!g.dead;pi--){
     var pu=pus[pi];
     if(Math.hypot(g.x-pu.x,g.y-pu.y)<30){
      applyPU(g,pu);pus.splice(pi,1);puCD=Math.max(puCD,PU_GAP);break;
     }
    }
   });
   for(i=0;i<eggs.length;i++)for(j=i+1;j<eggs.length;j++)eggVsEgg(eggs[i],eggs[j]);
   eggs.forEach(function(h){
    if(h.holding<0||h.dead)return;
    var v=eggs[h.holding];
    if(!v||v.heldBy!==h.idx||v.dead){h.holding=-1;h.holdT=0;return;}
    if(h.legs<=0){releaseHold(h);return;}
    if(v.struggle>=1){
     releaseHold(v);
     v.vy=-420;v.vx=(v.face||1)*160;v.jumps=1;
     popText(v.x,v.y-30,'WIGGLE FREE!');
     burst(v.x,v.y,12,60,240,.5,3,['#fff','#bae6fd'],0);
     return;
    }
    h.holdT+=dt;
    v.x=h.x;v.y=h.y-h.r-26;v.vx=h.vx;v.vy=h.vy;
    if(h.holdT>0.9){
     var dir=h.vx>60?1:(h.vx<-60?-1:(h.face||1));
     var heavy=1/(1+0.5*(v.bigTier||0));
     v.heldBy=-1;h.holding=-1;h.holdT=0;h.throwCD=1.2;
     v.vx=h.vx+dir*620*heavy;v.vy=-560*heavy;v.inv=0;v.thrownT=1.4;v.thrownById=h.id;v.jumps=1;
     popText(v.x,v.y-26,'THROW!');
     burst(v.x,v.y,10,80,260,.5,3,['#fff','#fca5a5'],0);
    }
   });
   for(var k=parts.length-1;k>=0;k--){var p=parts[k];
    if(p.k==='p'){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=900*dt;p.l-=dt;if(p.l<=0)parts.splice(k,1);}
    else{p.t+=dt;if(p.t>1.1)parts.splice(k,1);}}
   decals.forEach(function(d){d.t+=dt;});
  }

  function pickMut(){
   var pool=MUTS.filter(function(m){return m.id!==lastMutId;});
   return pool[(Math.random()*pool.length)|0];
  }
  function startRound(){
   roundNo++;
   mut=null;
   if(cfg.chaos && Math.random()<0.8)mut=pickMut();
   lastMutId=mut?mut.id:'';
   applyMut(mut);
   newWorld();
   nest=null;
   if(mode==='nest'){nest={x:0,y:0,r:82,moveT:0,holder:-1,contested:false};moveNest();}
   eggs.forEach(function(g,i){
    g.stocks=3;g.pts=0;g.nestPts=0;g.diedAt=0;
    respawn(g,true,W*(i+1)/(eggs.length+1));
    g.inv=COUNT+1.5;
   });
   feed=[];scene='countdown';sceneT=0;roundT=0;overtime=false;hurryShown=false;lastCount=0;matchOver=false;roundWinner=null;
   var md=MODES.filter(function(m){return m.id===mode;})[0]||MODES[0];
   var sub=(mut?mut.name+' — '+mut.desc:md.desc);
   ban={text:(roundsNeed>1?'ROUND '+roundNo:md.name),sub:sub,t:0,dur:COUNT,col:'#ffd23f'};
  }

  // Park the nest on some real platform, not in mid-air, and every twenty
  // seconds somewhere new so nobody can camp it.
  function moveNest(){
   if(!nest)return;
   var c=plats.filter(function(p){return p.w<W-1&&p.y>210&&p.y<H-230;});
   var p=c.length?c[(Math.random()*c.length)|0]:{x:W/2,y:H/2};
   nest.x=Math.round(p.x);nest.y=Math.round(p.y-62);nest.moveT=0;
   if(scene==='play')popText(nest.x,nest.y-70,'NEST MOVED!');
  }
  // Highest scorer, or null on a tie — a tie must not hand anybody the round.
  function leader(key){
   var best=null,tie=false;
   eggs.forEach(function(e){
    if(!best||e[key]>best[key]){best=e;tie=false;}
    else if(e[key]===best[key])tie=true;
   });
   return tie?null:best;
  }

  function endRound(w){
   scene='roundEnd';sceneT=0;
   roundWinner = w ? { id: w.id, name: w.name } : null;
   if(w)w.wins++;
   matchOver=!!(w&&w.wins>=roundsNeed);
   ban={text:w?(w.name+(matchOver?' wins it all!':' takes the round!')):'Draw!',
     sub:eggs.map(function(e){return e.name+' '+e.wins;}).join('   '),t:0,dur:3.4,col:w?colorOf(w.idx).shell:'#f0e6d2'};
  }
  function checkRound(){
   if(scene!=='play')return;
   if(mode==='nest'){
    // First to 25 seconds alone in the nest takes it. A tie at the top means
    // nobody has earned it, so the round runs on until the clock.
    var top=leader('nestPts');
    if(top&&top.nestPts>=NEST_WIN){endRound(top);return;}
   }
   if(mode!=='stocks'){
    var limit=(mode==='timed')?90:150;
    if(roundT>=limit){
     var L=leader(mode==='timed'?'pts':'nestPts');
     if(L)endRound(L);else overtime=true;
    }
    return;
   }
   var alive=eggs.filter(function(g){return g.stocks>0;});
   if(alive.length<=1){
    var w=alive[0]||null;
    if(!w){
     var last=eggs.slice().sort(function(a,b){return b.diedAt-a.diedAt;});
     if(last.length&&(last.length<2||last[0].diedAt>last[1].diedAt))w=last[0];
    }
    endRound(w);
   }
  }

  function sceneTick(rdt){
   sceneT+=rdt;
   if(ban)ban.t+=rdt;
   if(scene==='countdown'){
    var n=Math.ceil(COUNT-sceneT);
    if(n!==lastCount){lastCount=n;}
    if(sceneT>=COUNT){scene='play';sceneT=0;roundT=0;ban={text:'GO!',sub:'',t:0,dur:0.9,col:'#86efac'};
     eggs.forEach(function(g){g.inv=Math.max(g.inv,1);});}
   }else if(scene==='play'){
    roundT+=rdt;
    if(mode==='stocks'&&roundT>75&&!hurryShown){hurryShown=true;ban={text:'HURRY UP!',sub:'Damage is climbing for everyone',t:0,dur:2.2,col:'#f87171'};}
    // King of the nest: the nest counts only while exactly one egg is in it.
    if(mode==='nest'&&nest){
     nest.moveT+=rdt;
     if(nest.moveT>NEST_MOVE_EVERY)moveNest();
     var ins=eggs.filter(function(e){return !e.dead&&Math.hypot(e.x-nest.x,e.y-nest.y)<nest.r+e.r*0.4;});
     nest.holder=ins.length===1?ins[0].idx:-1;
     nest.contested=ins.length>1;
     if(ins.length===1)ins[0].nestPts+=rdt;
    }
   }else if(scene==='roundEnd'){
    if(sceneT>3.4){
     if(matchOver){scene='matchEnd';sceneT=0;}
     else startRound();
    }
   }
  }

  function botInput(g,dt){
   var B=g.ai||(g.ai={jt:0,seed:Math.random()*10,lazy:0.5+Math.random()*0.5});
   var inp={ax:0,jump:false,brake:false,up:false,dash:false,item:false};
   B.jt-=dt;
   if(g.heldBy>=0){inp.jump=Math.floor(performance.now()/70)%2===0;return inp;}
   var tgt=null,bd=1e9,i;
   for(i=0;i<eggs.length;i++){var e=eggs[i];if(e===g||e.dead)continue;var d=Math.hypot(e.x-g.x,e.y-g.y);if(d<bd){bd=d;tgt=e;}}
   var goal=tgt?{x:tgt.x,y:tgt.y}:{x:W/2,y:H-100};
   // In nest mode the job is to sit in the nest, not to hunt. Go there unless
   // somebody is already in it, in which case go bonk them out.
   if(mode==='nest'&&nest){
    var enemyIn=tgt&&Math.hypot(tgt.x-nest.x,tgt.y-nest.y)<nest.r+10;
    if(!enemyIn)goal={x:nest.x,y:nest.y};
   }
   var pb=null,pd=420;
   pus.forEach(function(p){var d=Math.hypot(p.x-g.x,p.y-g.y);if(d<pd){pd=d;pb=p;}});
   if(pb)goal={x:pb.x,y:pb.y};
   var dx=goal.x-g.x,dy=goal.y-g.y;
   if(Math.abs(dx)>16)inp.ax=dx>0?1:-1;
   var wantJump=false;
   if(dy<-45&&B.jt<=0)wantJump=true;
   else if(B.jt<=0&&Math.random()<0.006)wantJump=true;
   if(wantJump&&!g.prevJump&&(g.ground||g.jumps<2)){inp.jump=true;B.jt=0.34+Math.random()*0.2;}
   if(tgt&&g.dashCD<=0&&bd<200&&Math.abs(tgt.y-g.y)<55&&Math.random()<0.09*B.lazy&&((tgt.x>g.x)?1:-1)===(g.face||1)){inp.dash=true;inp.ax=(tgt.x>g.x)?1:-1;}
   if(g.bombs>0&&tgt&&bd>130&&bd<460&&Math.random()<0.025)inp.item=true;
   if(g.onMover&&dy<-100)inp.up=true;
   return inp;
  }

  // --- RENDERING ---
  function rrect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function txt(s,x,y,sz,col,al,wt,stroke){
   ctx.font=(wt||800)+' '+sz+'px system-ui,sans-serif';
   ctx.textAlign=al||'left';ctx.textBaseline='alphabetic';
   if(stroke){ctx.lineJoin='round';ctx.lineWidth=stroke.w;ctx.strokeStyle=stroke.c;ctx.strokeText(s,x,y);}
   ctx.fillStyle=col;ctx.fillText(s,x,y);
  }
  function fitTxt(s,x,y,maxW,sz,col,al,wt){
   ctx.font=(wt||800)+' '+sz+'px system-ui,sans-serif';
   while(ctx.measureText(s).width>maxW&&sz>10){sz-=1;ctx.font=(wt||800)+' '+sz+'px system-ui,sans-serif';}
   txt(s,x,y,sz,col,al,wt);
  }

  var MOVER_PTS=[[100,H-170],[100,150],[W-100,150],[W-100,H-170]];
  var moverPerim=(function(){var L=0;for(var i=0;i<MOVER_PTS.length;i++){
   var a=MOVER_PTS[i],b=MOVER_PTS[(i+1)%MOVER_PTS.length];
   L+=Math.hypot(b[0]-a[0],b[1]-a[1]);}return L;})();
  function sampleMover(d){
   d=((d%moverPerim)+moverPerim)%moverPerim;
   for(var i=0;i<MOVER_PTS.length;i++){
    var a=MOVER_PTS[i],b=MOVER_PTS[(i+1)%MOVER_PTS.length];
    var L=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(d<=L)return{x:a[0]+(b[0]-a[0])*(d/L),y:a[1]+(b[1]-a[1])*(d/L)};
    d-=L;
   }
   return{x:MOVER_PTS[0][0],y:MOVER_PTS[0][1]};
  }

  let feed=[];
  function addFeed(s){feed.push({t:0,text:s});if(feed.length>5)feed.shift();}

  var coopCv=null;
  var BULB_X=Math.round(W*0.72),BULB_Y=190;
  function hashStr(s){var h=2166136261;s=String(s||'coop');for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function coopRnd(seed){var a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  
  function buildCoop(){
   var R=coopRnd(hashStr(levelName));
   coopCv=document.createElement('canvas');coopCv.width=W;coopCv.height=H;
   var c=coopCv.getContext('2d');
   var tones=['#3a2a1c','#42301f','#38281a','#453322','#3d2c1e'];
   var ph=64,ri=0;
   for(var y=0;y<H;y+=ph,ri++){
    c.fillStyle=tones[(((R()*tones.length)|0)+ri)%tones.length];c.fillRect(0,y,W,ph-2);
    c.fillStyle='rgba(0,0,0,.35)';c.fillRect(0,y+ph-2,W,2);
    c.strokeStyle='rgba(0,0,0,.25)';c.lineWidth=1;
    for(var gi=0;gi<5;gi++){var gy=y+6+R()*(ph-14);
     c.beginPath();c.moveTo(0,gy);
     for(var gx=0;gx<=W;gx+=160)c.lineTo(gx,gy+Math.sin(gx*0.01+R()*6)*2);
     c.stroke();}
   }
   var ftop=H-56;
   var fg=c.createLinearGradient(0,ftop,0,H);
   fg.addColorStop(0,'#8a6c3c');fg.addColorStop(0.3,'#6e552e');fg.addColorStop(1,'#3d2f1a');
   c.fillStyle=fg;c.fillRect(0,ftop,W,H-ftop);
  }
  function drawBulb(){
   var t=performance.now()/1000;
   var sway=Math.sin(t*0.7)*10;
   var bx=BULB_X+sway,by=BULB_Y;
   var g=ctx.createRadialGradient(bx,by,10,bx,by,330);
   g.addColorStop(0,'rgba(255,190,90,.20)');g.addColorStop(1,'rgba(255,190,90,0)');
   ctx.fillStyle=g;ctx.fillRect(bx-330,by-330,660,660);
   ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=3;
   ctx.beginPath();ctx.moveTo(BULB_X,0);ctx.lineTo(bx,by);ctx.stroke();
   ctx.fillStyle='#ffd98a';
   ctx.beginPath();ctx.arc(bx,by,11,0,7);ctx.fill();
   var sy=by+72;
   ctx.save();ctx.translate(bx,sy);ctx.rotate(Math.sin(t*0.7+0.4)*0.03);
   ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=2;
   ctx.beginPath();ctx.moveTo(-60,-36);ctx.lineTo(-60,-6);ctx.moveTo(60,-36);ctx.lineTo(60,-6);ctx.stroke();
   ctx.fillStyle='#6e5233';ctx.strokeStyle='#241a10';ctx.lineWidth=2;
   ctx.beginPath();ctx.rect(-100,-17,200,34);ctx.fill();ctx.stroke();
   ctx.fillStyle='#f0e6d2';ctx.font='700 15px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
   ctx.fillText(levelName||'',0,1);
   ctx.restore();ctx.textBaseline='alphabetic';
  }

  function fillShell(idx){
   var C=colorOf(idx);
   ctx.beginPath();
   ctx.moveTo(0,-20); ctx.bezierCurveTo(11,-20,17,-8,17,4); ctx.bezierCurveTo(17,14,9,20,0,20);
   ctx.bezierCurveTo(-9,20,-17,14,-17,4); ctx.bezierCurveTo(-17,-8,-11,-20,0,-20); ctx.closePath();
   ctx.fillStyle=C.shell;ctx.fill();
   ctx.lineWidth=2;ctx.strokeStyle='rgba(0,0,0,.35)';ctx.stroke();
   ctx.fillStyle='rgba(255,255,255,.75)';ctx.beginPath();ctx.ellipse(-6,-6,3.4,5.4,-0.4,0,7);ctx.fill();
  }
  function drawEggIcon(x,y,s,idx,alpha){
   ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.globalAlpha=alpha==null?1:alpha;fillShell(idx);ctx.restore();
  }
  
  function drawEgg(g){
   ctx.save();ctx.translate(g.x,g.y);
   if(g.heldBy>=0)ctx.rotate(Math.sin(performance.now()/90)*0.25);
   if(g.inv>0&&((g.inv*8)|0)%2===0)ctx.globalAlpha=0.45;
   if(g.starT>0){ctx.shadowColor='#ffd23f';ctx.shadowBlur=22;}
   var s=(g.r||17)/17;
   var spd=Math.hypot(g.vx,g.vy),stretch=Math.min(0.22,spd/2500),sq=g.sq||0;
   if(g.heldBy<0)ctx.rotate(Math.max(-1,Math.min(1,g.vx/300))*0.15);
   ctx.scale(s*(1+stretch-Math.max(0,sq)*0.28),s*(1-stretch+sq*0.32));
   if(g.legs>0){
    var run=Math.min(1,Math.abs(g.vx)/160);
    var sw=Math.sin(performance.now()/110)*7*run;
    ctx.strokeStyle='#78350f';ctx.lineWidth=4.5;ctx.lineCap='round';
    ctx.beginPath();
    if(g.holding>=0){ctx.moveTo(-6,15);ctx.lineTo(-11,30);ctx.moveTo(6,15);ctx.lineTo(11,30);}
    else if(g.ground){ctx.moveTo(-6,15);ctx.lineTo(-6+sw,30);ctx.moveTo(6,15);ctx.lineTo(6-sw,30);}
    else{ctx.moveTo(-6,15);ctx.lineTo(-9,27);ctx.moveTo(6,15);ctx.lineTo(9,27);}
    ctx.stroke();
   }
   fillShell(g.idx);
   if(g.cracks>0){ctx.strokeStyle='rgba(0,0,0,.5)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-6,-2);ctx.lineTo(-2,3);ctx.lineTo(-6,8);ctx.stroke();}
   var isc=1/s;
   ctx.save();ctx.scale(isc,isc);
   ctx.globalAlpha=1;ctx.shadowBlur=0;
   var ls={w:3,c:'rgba(10,7,4,.85)'};
   if(g.dmg>0)txt(Math.round(g.dmg)+'%',0,-14*s-14,12,g.dmg>=180?'#f87171':'#f472b6','center',900,ls);
   txt(g.name||'',0,-27*s-10,12,colorOf(g.idx).shell,'center',900,ls);
   var tsub=34*s+12;
   if(g.starT>0){txt('★'+Math.ceil(g.starT),0,tsub,12,'#ffd23f','center',900,ls);tsub+=13;}
   if(g.bigTier>0){txt(TIER_NAME[g.bigTier]||'BIG',0,tsub,12,'#d6a05c','center',900,ls);tsub+=13;}
   if(g.legs>0){txt((g.holding>=0?'HOLDING ':'LEGS ')+Math.ceil(g.legs),0,tsub,12,'#fca5a5','center',900,ls);tsub+=13;}
   if(g.bombs>0){txt('BOMB x'+g.bombs,0,tsub,12,'#ff9a3c','center',900,ls);}
   ctx.restore();
   ctx.restore();
  }

  function drawBomb(x,y,s,t){
   ctx.save();ctx.translate(x,y);ctx.scale(s,s);
   ctx.fillStyle='#2b2b2b';ctx.beginPath();ctx.arc(0,2,10,0,7);ctx.fill();
   ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,2,10,0,7);ctx.stroke();
   ctx.fillStyle='rgba(255,255,255,.5)';ctx.beginPath();ctx.ellipse(-4,-1,2.2,3.5,-0.5,0,7);ctx.fill();
   ctx.strokeStyle='#a8895a';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(3,-7);ctx.quadraticCurveTo(8,-14,12,-12);ctx.stroke();
   var fl=0.6+0.4*Math.sin(t*30);
   ctx.fillStyle='rgba(255,'+((150+fl*80)|0)+',40,1)';ctx.beginPath();ctx.arc(12,-12,3+fl*2,0,7);ctx.fill();
   ctx.restore();
  }

  function drawNest(){
   if(!nest)return;
   var t=performance.now()/1000;
   var col=nest.contested?'#f87171':(nest.holder>=0?colorOf(nest.holder).shell:'#ffd23f');
   ctx.save();ctx.translate(nest.x,nest.y);
   var gr=ctx.createRadialGradient(0,0,10,0,0,nest.r);
   gr.addColorStop(0,'rgba(255,210,63,.30)');gr.addColorStop(1,'rgba(255,210,63,0)');
   ctx.fillStyle=gr;ctx.beginPath();ctx.arc(0,0,nest.r,0,7);ctx.fill();
   ctx.strokeStyle=col;ctx.lineWidth=4;
   ctx.setLineDash([14,10]);ctx.lineDashOffset=-t*30;
   ctx.beginPath();ctx.arc(0,0,nest.r,0,7);ctx.stroke();
   ctx.setLineDash([]);
   txt('NEST',0,-nest.r-10,18,col,'center',900,{w:5,c:'rgba(10,7,4,.85)'});
   ctx.restore();
  }

  function drawWorld(){
   if(!coopCv)buildCoop();
   ctx.drawImage(coopCv,0,0);
   drawBulb();
   
   decals.forEach(function(d){
    var a=Math.max(0,1-d.t/40);
    var sc=Math.min(2.4,d.sc||1);
    ctx.save();ctx.globalAlpha=Math.min(1,a+0.2);ctx.translate(d.x,d.y);
    ctx.fillStyle='rgba(0,0,0,.35)';
    ctx.beginPath();ctx.ellipse(0,1.5,22*sc,11*sc,0,0,7);ctx.fill();
    ctx.fillStyle='rgba(248,250,252,.92)';
    ctx.beginPath();ctx.ellipse(0,0,(20+((d.seed*37)%8))*sc,(9+((d.seed*53)%5))*sc,0,0,7);ctx.fill();
    ctx.beginPath();ctx.ellipse(8*((d.seed*7)%1-0.5)*2,2,11*sc,6*sc,0.3,0,7);ctx.fill();
    ctx.fillStyle='#fbbf24';
    ctx.beginPath();ctx.ellipse(0,0,8*sc,5.4*sc,0,0,7);ctx.fill();
    ctx.fillStyle='#f59e0b';
    ctx.beginPath();ctx.ellipse(0,0,4.4*sc,3*sc,0,0,7);ctx.fill();
    ctx.restore();
   });
   
   drawNest();

   plats.forEach(function(p){
    if(p.w>=W-1)return;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a||0);
    var w=p.w,h=Math.max(14,p.h);
    var grd=ctx.createLinearGradient(0,-h/2,0,h/2);
    grd.addColorStop(0,'#8a6a44');grd.addColorStop(0.35,'#6e5233');grd.addColorStop(1,'#4a3524');
    ctx.fillStyle=grd;
    ctx.beginPath();ctx.rect(-w/2,-h/2,w,h);ctx.fill();
    ctx.strokeStyle='rgba(20,12,6,.6)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='rgba(255,220,160,.35)';ctx.fillRect(-w/2+2,-h/2,w-4,3);
    ctx.restore();
   });

   if(mover){
    ctx.save();ctx.translate(mover.x,mover.y);
    ctx.fillStyle='#155e63';ctx.fillRect(-mover.w/2-3,-mover.h/2-3,mover.w+6,mover.h+6);
    ctx.fillStyle='#3cc3d4';ctx.strokeStyle='#0b3540';ctx.lineWidth=2;
    ctx.beginPath();ctx.rect(-mover.w/2,-mover.h/2,mover.w,mover.h);ctx.fill();ctx.stroke();
    ctx.fillStyle='#0b3540';
    for(var mi=-mover.w/2+14;mi<mover.w/2-6;mi+=20){
     ctx.beginPath();ctx.moveTo(mi,-mover.h/2+3);ctx.lineTo(mi+7,0);ctx.lineTo(mi,mover.h/2-3);ctx.fill();
    }
    var mlabel='ELEVATOR '+(mover.sp>=0?'+':'')+(mover.sp||0)+(mover.by?' · '+mover.by:'');
    ctx.font='700 13px monospace';ctx.textAlign='center';ctx.textBaseline='alphabetic';
    var mlw=ctx.measureText(mlabel).width;
    ctx.fillStyle='rgba(10,7,4,.7)';
    ctx.fillRect(-mlw/2-8,-mover.h/2-34,mlw+16,20);
    ctx.fillStyle='#3cc3d4';
    ctx.fillText(mlabel,0,-mover.h/2-19);
    ctx.restore();
   }

   if(peg){
    ctx.save();ctx.translate(peg.x,H-48);
    ctx.fillStyle='#e0432f';ctx.beginPath();ctx.rect(-6,-34,12,34);ctx.fill();
    ctx.fillStyle='#fff';
    ctx.beginPath();ctx.rect(-6,-28,12,7);ctx.fill();
    ctx.beginPath();ctx.rect(-6,-14,12,7);ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,.4)';ctx.lineWidth=2;
    ctx.beginPath();ctx.rect(-6,-34,12,34);ctx.stroke();
    ctx.restore();
   }

   if(board){
    ctx.save();ctx.translate(board.x,board.y);
    ctx.rotate((board.flip||0)+(board.stuck>0?Math.sin(performance.now()/60)*0.04:0));
    ctx.fillStyle='#8a5a2b';
    ctx.beginPath();ctx.rect(-board.w/2,-board.h/2,board.w,board.h);ctx.fill();
    ctx.strokeStyle='#3e2a10';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#ffd23f';
    ctx.fillRect(-board.w/2+8,-2,14,4);
    ctx.fillRect(board.w/2-22,-2,14,4);
    ctx.fillStyle='#1b1b1b';
    ctx.beginPath();ctx.arc(-board.w/2+16,board.h/2+5,5,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(board.w/2-16,board.h/2+5,5,0,7);ctx.fill();
    if(board.rider>=0)txt('RIDING',0,-16,11,'#3cc3d4','center',900);
    ctx.restore();
   }

   pus.forEach(function(pu){
    ctx.save();ctx.translate(pu.x,pu.y+Math.sin(pu.t*4)*3);
    ctx.textAlign='center';ctx.textBaseline='middle';
    if(pu.k==='star'){
     ctx.shadowColor='#ffd23f';ctx.shadowBlur=18;
     ctx.fillStyle='#ffd23f';ctx.font='30px sans-serif';
     ctx.fillText('★',0,0);
    }else if(pu.k==='bean'){
     ctx.rotate(0.5+Math.sin(pu.t*2)*0.15);
     ctx.shadowColor='#d6a05c';ctx.shadowBlur=16;
     ctx.fillStyle='#a16207';
     ctx.beginPath();ctx.ellipse(0,0,9,14,0,0,7);ctx.fill();
     ctx.shadowBlur=0;
     ctx.strokeStyle='#713f12';ctx.lineWidth=2.5;
     ctx.beginPath();ctx.moveTo(0,-12);ctx.quadraticCurveTo(6,0,0,12);ctx.stroke();
     ctx.fillStyle='rgba(255,255,255,.5)';
     ctx.beginPath();ctx.ellipse(-3,-5,2,4.5,-0.3,0,7);ctx.fill();
    }else if(pu.k==='bomb'){
     ctx.shadowColor='#ff9a3c';ctx.shadowBlur=16;
     drawBomb(0,0,1.5,pu.t);
    }else{
     ctx.shadowColor='#fca5a5';ctx.shadowBlur=16;
     ctx.fillStyle='rgba(10,7,4,.8)';
     ctx.beginPath();ctx.arc(0,0,17,0,7);ctx.fill();
     ctx.shadowBlur=0;
     var sw2=Math.sin(pu.t*6)*4;
     ctx.strokeStyle='#fca5a5';ctx.lineWidth=4;ctx.lineCap='round';
     ctx.beginPath();ctx.moveTo(-6,-4);ctx.lineTo(-6+sw2,12);ctx.moveTo(6,-4);ctx.lineTo(6-sw2,12);ctx.stroke();
     ctx.fillStyle='#fca5a5';
     ctx.beginPath();ctx.arc(-6+sw2,12,3,0,7);ctx.fill();
     ctx.beginPath();ctx.arc(6-sw2,12,3,0,7);ctx.fill();
    }
    ctx.restore();
   });

   bombs.forEach(function(b){drawBomb(b.x,b.y,1,b.t);});

   eggs.forEach(function(g){if(!g.dead)drawEgg(g);});
   parts.forEach(function(p){
    if(p.k==='p'){ctx.globalAlpha=Math.max(0,p.l/p.m||p.l);ctx.fillStyle=p.c;ctx.beginPath();ctx.arc(p.x,p.y,p.s,0,7);ctx.fill();ctx.globalAlpha=1;}
    else{var sc=Math.min(1,p.t*8);ctx.save();ctx.translate(p.x,p.y-p.t*40);ctx.scale(sc,sc);ctx.globalAlpha=1-Math.max(0,(p.t-.7)/.4);
     txt(p.tx,0,0,22,'#e0432f','center',900,{w:6,c:'#fff'});ctx.restore();}
   });
   ctx.globalAlpha=1;
  }
  
  function drawMutTint(){
   if(!mut)return;
   var c={moon:'rgba(120,150,255,.10)',ice:'rgba(140,230,255,.12)',turbo:'rgba(255,90,60,.07)',glass:'rgba(255,255,255,.07)',flood:'rgba(255,210,63,.06)',giant:'rgba(214,160,92,.08)'}[mut.id];
   if(c){ctx.fillStyle=c;ctx.fillRect(0,0,W,H);}
  }

  function drawHud(){
   var n=eggs.length;
   var eggsHigh = eggs.some(function(g) { return !g.dead && g.y < 220; });
   var hudAlpha = eggsHigh ? 0.20 : 0.85; 

   var hudScale = n > 4 ? 4 / n : 1; 
   ctx.save();
   ctx.scale(hudScale, hudScale);
   var effW = W / hudScale;
   var bw = 330, bh = 64;

   for(let i=0; i<n; i++){
    var g=eggs[i], C=colorOf(g.idx);
    var x=n===1?8:8+i*((effW-16-bw)/(n-1)), y=8;
    var out=(mode==='stocks'&&g.stocks<=0);
    ctx.save();
    ctx.globalAlpha = out ? hudAlpha * 0.4 : hudAlpha;
    ctx.fillStyle='rgba(10,7,4,1)';rrect(x,y,bw,bh,12);ctx.fill();
    ctx.strokeStyle=C.shell;ctx.lineWidth=3;rrect(x,y,bw,bh,12);ctx.stroke();
    fitTxt(g.name,x+14,y+27,150,20,C.shell,'left',900);
    if(g.dmg>0)txt(Math.round(g.dmg)+'%',x+bw-12,y+27,22,g.dmg>=180?'#f87171':'#f472b6','right',900);
    if(mode==='stocks'){
     for(var s=0;s<3;s++)drawEggIcon(x+26+s*26,y+46,0.52,g.idx,s<g.stocks?1:0.18);
    }else if(mode==='nest'){
     // A progress bar to 25 seconds, so "am I winning" is on screen rather
     // than something you work out by watching the nest for a minute.
     var frac=Math.min(1,g.nestPts/NEST_WIN);
     ctx.fillStyle='rgba(255,255,255,.15)';rrect(x+14,y+44,bw-28,10,5);ctx.fill();
     ctx.fillStyle='#ffd23f';rrect(x+14,y+44,Math.max(2,(bw-28)*frac),10,5);ctx.fill();
     txt(g.nestPts.toFixed(1)+'s',x+bw-14,y+40,17,'#ffd23f','right',900);
    }else{
     txt(String(g.pts||0)+' splats',x+26,y+52,17,'#ffd23f','left',900);
    }
    ctx.restore();
   }
   
   var md = MODES.filter(function(m){return m.id===mode;})[0]||MODES[0];
   var label = (roundsNeed>1?'ROUND '+roundNo:md.name) + (mut?'  ·  '+mut.name:'');
   ctx.font='900 15px system-ui,sans-serif';
   var pw=ctx.measureText(label).width+28;
   ctx.globalAlpha = hudAlpha;
   ctx.fillStyle='rgba(10,7,4,1)';rrect(effW/2-pw/2,70,pw,24,12);ctx.fill();
   ctx.strokeStyle=mut?'#ffd23f':'#6b5636';ctx.lineWidth=2;rrect(effW/2-pw/2,70,pw,24,12);ctx.stroke();
   txt(label,effW/2,87,15,mut?'#ffd23f':'#f0e6d2','center',900);
   ctx.globalAlpha = 1;
   ctx.restore();
  }

  function drawBanner(){
   if(!ban)return;
   var t=ban.t,a=Math.max(0,Math.min(1,Math.min(t/0.15,(ban.dur-t)/0.4)));
   if(a<=0)return;
   var sc=0.85+0.15*Math.min(1,t/0.2);
   ctx.save();ctx.globalAlpha=a;ctx.translate(W/2,H*0.34);ctx.scale(sc,sc);
   txt(ban.text,0,0,92,ban.col,'center',900,{w:12,c:'rgba(10,7,4,.92)'});
   if(ban.sub)txt(ban.sub,0,54,28,'#f0e6d2','center',800,{w:6,c:'rgba(10,7,4,.92)'});
   ctx.restore();
  }
  function drawCountdown(){
   if(scene!=='countdown')return;
   var left=COUNT-sceneT,n=Math.ceil(left);
   if(n>3||n<=0)return;
   var f=left-Math.floor(left);
   ctx.save();ctx.globalAlpha=0.35+0.65*f;ctx.translate(W/2,H*0.6);ctx.scale(0.8+0.5*f,0.8+0.5*f);
   txt(String(n),0,70,220,'#ffd23f','center',900,{w:16,c:'rgba(10,7,4,.9)'});
   ctx.restore();
  }
  function drawFeed(){
   for(var i=0;i<feed.length;i++){
    var f=feed[i],a=Math.max(0,Math.min(1,(5-f.t)/1));
    if(a<=0)continue;
    ctx.globalAlpha=a;
    txt(f.text,18,H-22-(feed.length-1-i)*24,18,'#f0e6d2','left',800,{w:5,c:'rgba(10,7,4,.9)'});
   }
   ctx.globalAlpha=1;
  }
  function panel(x,y,w,h,stroke){
   ctx.fillStyle='rgba(20,14,8,.96)';rrect(x,y,w,h,18);ctx.fill();
   ctx.strokeStyle=stroke||'#6b5636';ctx.lineWidth=3;rrect(x,y,w,h,18);ctx.stroke();
  }
  // The last resort: render() threw. Say so on the canvas instead of freezing
  // whatever was there before, and only once, so a per-frame failure does not
  // spam the log.
  var paintErrShown = false;
  function drawPaintError(err){
   var msg=String((err&&err.message)||err);
   if(!paintErrShown)console.error('eggs render() threw:',err);
   try{
    ctx.fillStyle='rgba(10,7,4,.95)';ctx.fillRect(0,0,W,H);
    panel(W/2-460,Math.max(90,H/2-140),920,280,'#e05a42');
    txt('THE MATCH SCREEN COULD NOT BE DRAWN',W/2,Math.max(90,H/2-140)+80,34,'#fca5a5','center',900,{w:8,c:'rgba(10,7,4,.9)'});
    fitTxt(msg,W/2-400,Math.max(90,H/2-140)+150,800,22,'#f0e6d2','center',400);
    txt('Tap to go back to the lobby.',W/2,Math.max(90,H/2-140)+210,22,'#ffd23f','center',900,{w:5,c:'rgba(10,7,4,.9)'});
   }catch(e2){}
   paintErrShown=true;
  }
  // The panel used to be a fixed 560px tall with a row every 46px from y=480,
// so an eight-player table's standings ran off the bottom of the panel and
// past the edge of the world — and the champion's own colour was read off
// champ.idx, which roundWinner never stored, so this threw on EVERY frame of
// the end screen. A throw inside draw() left the dimmed world behind with
// nothing on it, which is the "black screen at the end" report.
  function drawMatchEnd(){
   ctx.fillStyle='rgba(10,7,4,0.7)';ctx.fillRect(0,0,W,H);
   var champ=roundWinner;
   var champEgg = champ ? eggs.find(function(g){return g.id===champ.id;}) : null;
   var champIdx = champEgg ? champEgg.idx : 0;
   var champCol = champEgg ? colorOf(champIdx).shell : '#f0e6d2';
   var sorted=eggs.slice().sort(function(a,b){return b.wins-a.wins||b.kills-a.kills;});
   // Size the panel to the table, so eight players are not a scroll of rows
   // running off the bottom.
   var rowH=Math.max(34,Math.min(46,Math.floor(430/Math.max(1,sorted.length))));
   var bodyH=120+sorted.length*rowH;
   var top=Math.max(90,H/2-bodyH/2);
   panel(W/2-460,top,920,bodyH,'#ffd23f');
   txt(champ?champ.name+' IS THE EGG CHAMPION':'IT\'S A DRAW',W/2,top+70,52,champCol,'center',900,{w:8,c:'rgba(10,7,4,.9)'});
   if(champEgg)drawEggIcon(W/2,top+150,3.2+Math.sin(performance.now()/300)*0.1,champIdx,1);
   sorted.forEach(function(g,i){
    var y=top+240+i*rowH;
    drawEggIcon(W/2-380,y-8,0.9,g.idx,1);
    txt(g.name,W/2-340,y,26,colorOf(g.idx).shell,'left',900);
    txt(String(g.wins),W/2+60,y,26,'#fff','right',900);
   });
  }

  function drawLobby() {
   ctx.fillStyle='rgba(10,7,4,0.7)';ctx.fillRect(0,0,W,H);
   var t=performance.now()/1000;
   txt('EGGS',72,176,150,'#ffd23f','left',900,{w:14,c:'rgba(10,7,4,.95)'});
   txt(api.isHost ? 'Waiting for guests to join...' : 'Waiting for host to start...',80,214,26,'#f0e6d2','left',700);
   
   var roster = viewState ? viewState.players : [];
   var slots=Math.min(8,Math.max(4,roster.length));
   var colX=[60,405], colW=330, rowH=118, startY=242;
   for(let i=0;i<slots;i++){
    var col=i%2, row=(i/2)|0;
    var x=colX[col], y=startY+row*rowH, r=roster[i];
    ctx.fillStyle='rgba(10,7,4,.74)';rrect(x,y,colW,108,16);ctx.fill();
    ctx.strokeStyle=r?colorOf(i).shell:'#4a3a26';ctx.lineWidth=3;rrect(x,y,colW,108,16);ctx.stroke();
    if(r){
     drawEggIcon(x+46,y+54,1.7+Math.sin(t*3+i)*0.04,i,1);
     fitTxt(r.name,x+92,y+48,colW-104,26,colorOf(i).shell,'left',900);
     txt(r.bot?'CPU egg':'Player',x+92,y+78,16,'#d8c9a8','left',700);
    }else{
     ctx.globalAlpha=0.5+0.3*Math.sin(t*3);
     txt('Waiting for player...',x+colW/2,y+64,20,'#8a7a5c','center',800);
     ctx.globalAlpha=1;
    }
   }

   // There is a fifth row now (mode, match, chaos, cpu, start). At ROW_Y0 232 with
  // ROW_H 72 the last row would end at 592 and the guest note at 662 — inside
  // the 900-tall world, but crowding it. Start higher.
  var ROW_X=760, ROW_Y0=200, ROW_H=72, ROW_W=560;
   var ROUND_NAMES = ['Single round','Best of 3','Best of 5'];

   for(let i=0; i<ROWS.length; i++){
    var rr=ROWS[i], ry=ROW_Y0+i*ROW_H;
    ctx.fillStyle='rgba(10,7,4,.74)';rrect(ROW_X,ry,ROW_W,62,14);ctx.fill();
    ctx.strokeStyle='#4a3a26';ctx.lineWidth=3;rrect(ROW_X,ry,ROW_W,62,14);ctx.stroke();
    
    var big=(rr==='start');
    var label = rr==='mode'?'MODE':rr==='match'?'MATCH':rr==='chaos'?'CHAOS RULES':rr==='cpu'?'CPU EGGS':'START MATCH';
    txt(label, big?ROW_X+ROW_W/2:ROW_X+22,ry+40,big?28:22,api.isHost?'#ffd23f':'#8a7a5c',big?'center':'left',900);
    
    var v = '';
    if(rr==='mode') v = MODES[cfg.mode|0].name;
    if(rr==='match') v = ROUND_NAMES[cfg.rounds];
    if(rr==='chaos') v = cfg.chaos ? 'ON' : 'OFF';
    if(rr==='cpu') v = cfg.cpu === 0 ? 'NONE' : String(cfg.cpu);
    
    if(v){
     txt(v,ROW_X+ROW_W-52,ry+40,22,'#fff','right',900);
     if(api.isHost){
      txt('◀',ROW_X+ROW_W-250,ry+40,22,'#ffd23f','center',900);
      txt('▶',ROW_X+ROW_W-26,ry+40,22,'#ffd23f','center',900);
     }
    }
   }
   if(!api.isHost) {
    txt('Only the host can change settings and start the match.', ROW_X, ROW_Y0+ROWS.length*ROW_H+30, 18, '#fca5a5', 'left', 700);
   }
  }

  function render(){
   ctx.setTransform(1,0,0,1,0,0);
   ctx.globalAlpha=1;ctx.shadowBlur=0;
   ctx.clearRect(0,0,W,H);
   if (scene === 'lobby') {
    if(!coopCv)buildCoop();
    ctx.drawImage(coopCv,0,0);
    drawLobby();
   } else {
    drawWorld();drawMutTint();drawHud();drawBanner();drawCountdown();drawFeed();
    if(scene==='matchEnd')drawMatchEnd();
   }
  }

  // --- IO / Network loop ---
  let keys = {};
  let lastInpStr = '';
  
  function updateInput() {
      if (api.isSpectator) return;
      const L = keys.ArrowLeft || keys.KeyA, R = keys.ArrowRight || keys.KeyD;
      const U = keys.ArrowUp || keys.KeyW, D = keys.ArrowDown || keys.KeyS;
      const inp = {
          ax: (R ? 1 : 0) - (L ? 1 : 0),
          jump: !!(keys.Space || U),
          brake: !!D,
          up: !!U,
          dash: !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyZ || keys.KeyJ),
          item: !!(keys.KeyX || keys.KeyE || keys.KeyK)
      };
      const str = JSON.stringify(inp);
      if (str !== lastInpStr) {
          api.send({ type: 'INPUT', inp });
          lastInpStr = str;
      }
  }

  const onKeyDown = (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
      keys[e.code] = true; updateInput();
  };
  const onKeyUp = (e) => {
      keys[e.code] = false; updateInput();
  };

  cv.addEventListener('mousedown', function(e) {
    var r = cv.getBoundingClientRect();
    var p = { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
    // A paint error shows "tap to go back to the lobby" — honour it. Without
    // this the error card is a dead end and the only way out is the hub menu.
    if (paintErrShown && api.isHost) {
      paintErrShown = false;
      scene = 'lobby';
      sceneT = 0;
      matchOver = false;
      roundWinner = null;
      return;
    }
    if (scene === 'lobby' && api.isHost) {
      var ROW_X = 760, ROW_Y0 = 200, ROW_H = 72, ROW_W = 560;
      for(var i=0; i<ROWS.length; i++) {
        var ry = ROW_Y0 + i*ROW_H;
        if (p.x >= ROW_X && p.x <= ROW_X+ROW_W && p.y >= ry && p.y <= ry+62) {
          var rr = ROWS[i];
          if (rr === 'start') {
            startMatch(viewState.players);
          } else {
            var d = (p.x < ROW_X + ROW_W/2) ? -1 : 1;
            if (rr === 'mode') cfg.mode = (cfg.mode + d + MODES.length) % MODES.length;
            if (rr === 'match') cfg.rounds = (cfg.rounds + d + 3) % 3;
            if (rr === 'chaos') cfg.chaos = cfg.chaos ? 0 : 1;
            if (rr === 'cpu') cfg.cpu = (cfg.cpu + d + 4) % 4;
          }
        }
      }
    } else if (scene === 'matchEnd' && sceneT > 0.8 && api.isHost) {
      scene = 'lobby';
      sceneT = 0;
    }
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  let viewState = null;
  let hostEngineStarted = false;
  let lastSync = 0;
  let joined = false;
  let lastT = performance.now();

  function serialize() {
      return {
          eggs, plats, bombs, pus, mover, board, peg, nest,
          parts, decals, scene, sceneT, roundT, ban, feed,
          levelName, mode, roundNo, roundsNeed, matchOver, roundWinner, overtime, mut, cfg
      };
  }

  function syncFromHost(hs) {
      plats = hs.plats || []; decals = hs.decals || []; parts = hs.parts || [];
      bombs = hs.bombs || []; pus = hs.pus || []; mover = hs.mover || null;
      board = hs.board || null; peg = hs.peg || null; nest = hs.nest || null;
      scene = hs.scene || 'play'; sceneT = hs.sceneT || 0; roundT = hs.roundT || 0;
      ban = hs.ban || null; feed = hs.feed || []; mut = hs.mut || null; 
      levelName = hs.levelName || 'coop'; roundNo = hs.roundNo || 1; 
      matchOver = hs.matchOver || false; roundWinner = hs.roundWinner || null;
      overtime = hs.overtime || false; cfg = hs.cfg || cfg;
      // Host-authoritative: which round type is being played comes from the
      // host's cfg, or a guest would be scoring nest time in a stocks round.
      mode = (MODES[cfg.mode | 0] || MODES[0]).id;

      if (!eggs || eggs.length === 0) {
          eggs = hs.eggs || [];
      } else {
          (hs.eggs || []).forEach((he, i) => {
              if (eggs[i]) {
                  let currX = eggs[i].x; let currY = eggs[i].y;
                  Object.assign(eggs[i], he);
                  eggs[i].tx = he.x; eggs[i].ty = he.y;
                  eggs[i].x = currX; eggs[i].y = currY;
              } else {
                  eggs[i] = he;
              }
          });
      }
  }

  api.update = (view) => {
      viewState = view;
      // Announce on the first update(), never in mount(): the hub has not
      // finished wiring the handle while mount() runs (see AGENTS.md).
      if (!joined) {
          joined = true;
          api.send({ type: 'JOIN', player: { id: api.me.id, name: api.me.name } });
      }
      if (api.isHost && !hostEngineStarted && view.players) {
          hostEngineStarted = true;
      }
      if (!api.isHost && view.hostState) {
          syncFromHost(view.hostState);
      }
  };

  function startMatch(playersList) {
      eggs = playersList.map((p, i) => spawnEgg(i, p));
      for (let i = 0; i < cfg.cpu; i++) {
          eggs.push(spawnEgg(eggs.length, { id: 'cpu' + i, name: 'CPU ' + (i + 1), bot: true }));
      }
      mode = (MODES[cfg.mode | 0] || MODES[0]).id;
      roundsNeed = [1, 3, 5][cfg.rounds];
      roundNo = 0; lastMutId = '';
      api.send({ type: 'MATCH_ID', matchId: Math.random().toString(36).slice(2) });
      startRound();
  }

api.setInterval(function loop() {
      let now = performance.now();
      let rdt = (now - lastT) / 1000;
      lastT = now;
      if (!(rdt >= 0)) rdt = 0.016;
      rdt = Math.min(0.05, rdt);

      if (api.isHost && hostEngineStarted) {
          if (viewState && viewState.inputs) {
              eggs.forEach(g => {
                  if (g.bot) g.inp = botInput(g, rdt);
                  else if (viewState.inputs[g.id]) g.inp = viewState.inputs[g.id];
              });
          }
          
          // Let guests spawn seamlessly into match. Never in the lobby: eggs is
          // rebuilt from scratch by startMatch() and would just churn here.
          if (scene !== 'lobby') {
              viewState.players.forEach((vp) => {
                  if (!eggs.find(e => e.id === vp.id)) {
                      var newEgg = spawnEgg(eggs.length, vp);
                      if (scene === 'play' || scene === 'countdown') respawn(newEgg, true);
                      eggs.push(newEgg);
                  }
              });
          }

          if (scene === 'countdown' || scene === 'play' || scene === 'roundEnd') {
              sceneTick(rdt); step(rdt * timeScale, rdt); checkRound();
          } else {
              sceneT += rdt;
          }
          
          if (now - lastSync > 33) {
              if (parts.length > 100) parts = parts.slice(parts.length - 100);
              if (decals.length > 30) decals = decals.slice(decals.length - 30);
              api.send({ type: 'SYNC', hostState: serialize() });
              lastSync = now;
          }
      } else if (!api.isHost) {
          eggs.forEach(g => {
              if (g.tx !== undefined) {
                  if (Math.abs(g.tx - g.x) > 150 || Math.abs(g.ty - g.y) > 150) {
                      g.x = g.tx; g.y = g.ty;
                  } else {
                      g.x += (g.tx - g.x) * 0.4;
                      g.y += (g.ty - g.y) * 0.4;
                  }
              }
          });
      }

      // A throw inside render() kills the whole 16ms loop, and the canvas keeps
      // whatever was last painted. On the end screen that last frame was the
      // dimmed world with nothing on it — a black screen, permanently. Show the
      // error instead, and keep the loop alive.
      try {
          render();
      } catch (err) {
          drawPaintError(err);
      }
  }, 16); // 16ms interval targets ~60fps

  return {
    update: api.update,
    destroy() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    }
  };
}
