// Từ Trái Nghĩa — a side-scrolling Vietnamese word game (VietGames standalone, solo).
// The game module keeps the Bub Hub contract (init/reduce/project/mount) and is driven by a local harness, like public/vietgames/chem-tu/.
// Grab the word that helps, dodge the one that hurts: every power-up is a plain Vietnamese word, and the two words of a pair differ by a tone, a vowel mark or a letter.
// 4 sets (City, Countryside, Seaside, Mountains) × 8 levels (ROYGBIV + rainbow finale). Each level uses exactly two word pairs.
// Language is the difficulty: later levels/sets pick pairs that differ only by tone, and take away the hints (see HINT).
// GATES ("needed power-ups"): levels 2, 4 and 6 of every set carry one obstacle that the base kit cannot pass. Which kind comes first; the pair that opens it is then CHOSEN BY CAPABILITY (see CAPS):
//   chasm  500-540px wide, needs 'span'  (cầu builds a bridge, nhẹ / chim / quạ fly)      wood  full-height barricade, needs 'burn'  (hỏa, lửa, rồng: fire shots)
//   stone  full-height cracked wall, needs 'smash' (lớn, voi, cơ, râu, tay, phở: punch / big body)
// A signpost shows the key word's picture; on a pedestal before the obstacle stand the two words of a minimal pair, side by side. Only one opens the way. After the obstacle, an ECHO pedestal offers the same pair again
// (the right word heals you): a second reading of the same contrast. Choosing is deliberate: stand by a word and press ▼. No English anywhere in the game: the picture is the only scaffold.
// Lives: LIVES_START to begin, +1 per level cleared, back to the start of the current set when they run out.
//
// HUB CONTRACT: the simulation runs in mount()'s closure and only *reports* to the host: start / clear / die. reduce() owns the run (set, level, lives, seed).
//
// AUDIO SLOTS (all optional, missing files are skipped silently). Put them in public/vietgames/assets/tutrainghia/ :
//   music/1-red.mp3 … 8-rainbow.mp3          one loop per level colour (used by every set)
//   music/s2-3-yellow.mp3                    optional per-set override: s<set 1-4>-<level>-<colour>.mp3
//   music/water.mp3, music/s2-water.mp3      optional underwater loop (without it the level music just continues)
//   sfx/<id>.mp3                             power-up inserts; <id> is the first column of WD (e.g. sfx/horse.mp3, sfx/dance.mp3)
const SAW_KILLS=true;   // cưa kills outright, as written. false = costs 2 hearts instead.
const LW=640,LH=360,GY=270,EF='"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const cl=(v,a,b)=>v<a?a:v>b?b:v;
function mb(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hh(i,s){let n=Math.imul(i+7,374761393)^Math.imul(s+3,668265263);n=Math.imul(n^n>>>13,1274126177);n^=n>>>16;return(n>>>0)/4294967296}

// ===== words =====  [id, word, english, pic, 1 good / 0 bad / 2 neutral, spec]. Pairs are neighbours (2k, 2k+1); picking one cancels its partner.
// spec keys: s speed*  j jump*  z size*  w width*  sl slide*  r out-of-control  f form emoji  c body colour  nf no-flip  at attack  hd held item  acc [emoji,x,y,size]
//   k kills on touch  fly  mj max jumps  sw swim speed  d seconds (default 8)  L/lk/e = lock (stand still) seconds/look/emoji  one = special handler
const SK=(lk,e,L)=>({L:L||5,lk,e});
const DUMB={s:2,r:.8,xeye:1};
const WD=[
['big','lớn','big','💪',1,{z:1.5,k:1,arms:1}],
['pig','lợn','pig','🐷',0,{d:10,s:.3,f:'🐷',c:'#f9a8c9',mud:1}],
['horse','ngựa','horse','🐴',1,{s:1.5,f:'🐴',c:'#a0693a'}],
['itch','ngứa','itchy','🐜',0,{d:10,s:.5,r:.6,itch:1}],
['dragon','rồng','dragon','🐉',1,{f:'🐉',c:'#4caf50',at:'fire',wing:1}],
['wide','rộng','wide','↔️',0,{d:10,w:2.2,s:.4}],
['flip','dép','flip-flops','🩴',2,{s:.85,foot:'🩴'}],
['pony','đẹp','pretty','🎀',2,{pony:1}],
['sleep','ngủ','sleep','😴',0,SK('z','💤')],
['dumb','ngu','stupid','🤪',2,DUMB],
['shoes','giầy','shoes','👟',1,{s:1.8,foot:'👟'}],
['string','dây','string','🧵',0,{tet:1,d:10}],
['ears','tai','ear','👂',2,{ears:1}],
['hands','tay','hand','✋',1,{at:'slap',hd:'🖐️'}],
['nose','mũi','nose','👃',0,{d:10,s:.5,nose:1}],
['smell','mùi','smell','💨',1,{aura:1}],
['fire','hỏa','fire','🔥',1,{at:'fire',hd:'🔥'}],
['flower','hoa','flower','🌸',2,{hd:'🌼'}],
['blaze','lửa','fire','🔥',1,{at:'fire',hd:'🔥'}],
['donkey','lừa','donkey','🫏',0,{d:10,s:.3,f:'🫏',c:'#9ca3af'}],
['coco','dừa','coconut','🥥',1,{at:'coco',hd:'🥥'}],
['pine','dứa','pineapple','🍍',0,{d:10,s:.4,acc:['🍍',0,-46,20]}],
['dance','múa','dance','💃',0,SK('d','💃',4)],
['cart','mua','buy','🛒',1,{cart:1,s:.9}],
['laugh','cười','laugh','😂',0,SK('o','😂')],
['wife','cưới','marry','💍',1,{one:'wife'}],
['dog','chó','dog','🐕',1,{s:1.35,f:'🐕',c:'#c49a6c'}],
['gift','cho','give','🎁',0,{one:'gift',e:'🎁'}],
['hen','gà','chicken','🐓',2,{s:1.7,r:.6,f:'🐓',c:'#fff'}],
['train','ga','station','🚉',0,SK('t','🚂',6)],
['cabinet','tủ','cabinet','🗄️',0,SK('o','🗄️')],
['prison','tù','prison','⛓️',0,SK('p','⛓️')],
['eyes','mắt','eye','👁️',1,{at:'laser',eyes:1}],
['face','mặt','face','🙂',0,{one:'face'}],
['milk','sữa','milk','🥛',1,{at:'punch',arms:1}],
['fix','sửa','fix','🔧',0,SK('l','🚗')],
['two','hai','two','2️⃣',1,{clone:1,d:10}],
['hear','hay','interesting','🎧',0,SK('o','🎧')],
['letter','thư','letter','✉️',0,{one:'gift',e:'✉️',L:4}],
['autumn','thu','autumn','🍂',1,{at:'leaf',hd:'🍂'}],
['cut','cắt','cut','✂️',1,{at:'scis',hd:'✂️'}],
['shelf','cất','put away','🗄️',0,SK('u','🗄️')],
['hot','nóng','hot','🥵',1,{k:1,hot:1,s:1.2,c:'#ff5a4d'}],
['farm','nông','farming','🌱',0,SK('s','🌱')],
['muscle','cơ','muscle','💪',1,{at:'punch',arms:1}],
['teacher','cô','teacher','👩‍🏫',0,SK('s','👩‍🏫')],
['cow','bò','cow','🐄',2,DUMB],
['beach','bờ','shore','🏖️',0,SK('s','🏖️')],
['avo','bơ','avocado','🥑',1,{at:'avo',hd:'🥑'}],
['old','già','old','🧓',0,{d:10,s:.3,j:.5,old:1}],
['ice','đá','ice','🧊',0,SK('o','🧊')],
['leather','da','leather','👛',1,{at:'money',hd:'👛'}],
['boy','trai','boy','👦',1,{z:.65,s:1.9}],
['bottle','chai','bottle','🍾',0,SK('f','🍾')],
['light','nhẹ','light','🪶',1,{fly:1,wing:1}],
['listen','nghe','listen','👂',0,SK('o','🎧')],
['bird','chim','bird','🐦',1,{fly:1,f:'🐦',wing:1}],
['nine','chín','nine','9️⃣',0,SK('n','9️⃣',5.4)],
['teeth','răng','tooth','🦷',1,{k:1,teeth:1}],
['snake','rắn','snake','🐍',0,{j:0,s:.8,f:'🐍',nf:1,c:'#5cb85c',sn:1}],
['cold','lạnh','cold','🥶',0,SK('o','🧊')],
['dive','lặn','dive','🤿',1,{sw:1.8,acc:['🤿',0,-32,18]}],
['great','giỏi','great','🏆',1,{one:'great'}],
['awful','dở','bad','👎',0,{one:'awful'}],
['friend','bạn','friend','🧑‍🤝‍🧑',1,{clone:1,d:10}],
['table','bàn','table','🍽️',0,SK('s','🍜')],
['where','đâu','where','👻',1,{ghost:1}],
['hurt','đau','hurt','🤕',0,{d:10,s:.45,acc:['🩹',3,-38,14]}],
['octo','tuộc','octopus','🐙',1,{f:'🐙',nf:1,tent:1,z:1.2,c:'#c04fa0'}],
['pill','thuốc','medicine','💊',0,{d:10,s:.25,acc:['💊',0,-46,14]}],
['bridge','cầu','bridge','🌉',1,{one:'bridge'}],
['mask','khâu','sew','😷',0,{d:10,s:.45,acc:['😷',0,-30,20]}],
['monkey','khỉ','monkey','🐒',1,{f:'🐒',nf:1,mj:3,c:'#a0693a'}],
['pen','kí','sign','🖊️',0,SK('f','🖊️')],
['pho','phở','pho','🍜',1,{at:'punch',arms:1}],
['street','phố','street','🛣️',0,SK('b','🛣️')],
['crab','cua','crab','🦀',1,{at:'snip',hd:'🦀'}],
['saw','cưa','saw','🪚',0,{one:'saw'}],
['ship','tàu','ship','🚢',1,{ship:1,z:2,k:1,d:6}],
['apple','táo','apple','🍎',0,SK('f','🍎')],
['star','sao','star','⭐',1,{star:1,k:1,d:6}],
['worm','sâu','worm','🐛',0,SK('f','🐛')],
['garlic','tỏi','garlic','🧄',1,{aura:1}],
['dark','tối','dark','🌑',0,{dark:1,d:9}],
['swim','bơi','swim','🏊',1,{sw:1.8}],
['cream','bôi','smear','🧴',0,{sl:.07,cream:1}],
['sing','hát','sing','🎤',1,{one:'sing'}],
['seed','hạt','seed','🌰',0,SK('f','🌰')],
['soap','sạch','clean','🧼',2,{s:1.8,sl:.07,foot:'🧼'}],
['book','sách','book','📖',0,SK('f','📖')],
['beard','râu','beard','🧔',1,{at:'punch',arms:1,beard:1}],
['berry','dâu','strawberry','🍓',0,SK('f','🍓')],
['elephant','voi','elephant','🐘',1,{z:2,k:1,f:'🐘',c:'#9aa7b4'}],
['hurry','vội','hurry','💨',0,{s:2.2,r:.8,d:3}],
['crow','quạ','crow','🐦‍⬛',1,{fly:1,f:'🐦‍⬛',wing:1,c:'#444'}],
['fruit','quả','fruit','🍎',0,{one:'gift',e:'🎁'}],
['spouse','vợ','wife','👰',1,{one:'wife'}],
['broken','vỡ','broken','💔',0,{one:'broke'}],
['bamboo','tre','bamboo','🎍',0,SK('f','🎍')]
];
const SP={},IDX={};WD.forEach((w,i)=>{SP[w[0]]=w[5];IDX[w[0]]=i});
const ATK={fire:{p:'🔥',v:320,k:1,cd:.3,e:'🔥'},coco:{p:'🥥',v:240,vy:-160,g:600,k:1,cd:.35,e:'🥥'},avo:{p:'🥑',v:240,vy:-160,g:600,k:1,cd:.35,e:'🥑'},
 money:{p:'💸',v:260,vy:-80,g:200,k:1,cd:.25,e:'💸'},leaf:{p:'🍂',v:210,st:3,cd:.3,e:'🍂'},laser:{beam:1,cd:.45,e:'👁️'},
 slap:{m:48,e:'👋',cd:.3},punch:{m:60,e:'👊',cd:.28},scis:{m:52,e:'✂️',cd:.3},snip:{m:52,e:'🦀',cd:.25}};
const MUS=['1-red','2-orange','3-yellow','4-green','5-blue','6-indigo','7-violet','8-rainbow'];
const LV=[['đỏ',0],['cam',28],['vàng',52],['xanh lá',115],['xanh dương',210],['chàm',245],['tím',280],['cầu vồng',-1]];
const SIGNS=['phở','cà phê','quán','tiệm','bánh mì'],COUNT=['chín','tám','bảy','sáu','năm','bốn','ba','hai','một'];

// ===== sets, lives, language difficulty =====
export const meta={id:'tutrainghia',title:'Từ Trái Nghĩa',players:'solo',color:'#ff9f1c',icon:'↔️',desc:'A side-scrolling Vietnamese word game: grab the right word, dodge the wrong one. 4 sets × 8 levels, tone-by-tone harder.',soloable:true};
const LEVELS=8,LIVES_START=9,LIVES_MAX=15;
// g = [sat,light] of the ground top, [sat,light] of the ground body. foes = [slow walker, fast walker, flyer, extra walker]
const SETS=[
 {n:'Thành Phố',en:'City',bg:0,g:[55,48,40,32],foes:['🐌','🦀','🐝','🐀'],deco:['🌿','🪸','🪨']},
 {n:'Đồng Quê',en:'Countryside',bg:1,g:[55,42,45,28],foes:['🐍','🐗','🦟','🐸'],deco:['🌾','🪷','🪨']},
 {n:'Bờ Biển',en:'Seaside',bg:2,g:[60,74,50,62],foes:['🐢','🦀','🦅','🦞'],deco:['🪸','🐚','🦪']},
 {n:'Vùng Núi',en:'Mountains',bg:3,g:[25,52,20,36],foes:['🐻','🐺','🦇','🦂'],deco:['🪨','🧊','🌿']}
];
// What the game tells you (no English: pictures are the only scaffold, and they thin out). intro: 2 = level start lists the pairs with their pictures, 1 = the words only, 0 = nothing.
// sign: what a gate signpost shows (1 = the key word's picture, 0 = just a ❓). tag: a picture engraved under each word you can choose.
const HINT=[{intro:2,sign:1,tag:1},{intro:1,sign:1,tag:0},{intro:0,sign:1,tag:0},{intro:0,sign:0,tag:0}];
const NP=Math.ceil(WD.length/2);
const noTone=s=>s.normalize('NFD').replace(/[\u0300\u0301\u0303\u0309\u0323]/g,'').normalize('NFC');
const noMarks=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
// How hard is it to tell the two words apart?  1 = different letters (tai/tay) · 2 = a vowel mark or đ differs (cua/cưa, đá/da) · 3 = same letters, tone only (lớn/lợn)
const contrast=(a,b)=>noTone(a)===noTone(b)?3:noMarks(a)===noMarks(b)?2:1;
const PC=[];for(let p=0;p<NP;p++)PC.push(WD[p*2+1]?contrast(WD[p*2][1],WD[p*2+1][1]):1);
// Two pairs per level. Target difficulty t rises from 1 to 3 across all 32 levels, so each set is harder in the *language* first. No repeats inside a set; every level has something good in it.
// ===== what a word lets you DO: derived from its spec, never listed by hand per gate =====
const MELEE=new Set(['punch','slap']);
function capsOf(i){const s=WD[i][5]||{},c=new Set(),a=s.at&&ATK[s.at];
  if(s.one==='bridge'||s.fly)c.add('span');                  // cross a chasm no jump can
  if(s.fly||(s.mj||0)>=3)c.add('rise');                      // get higher than a double jump (no gate uses it yet)
  if(s.at==='fire')c.add('burn');                            // set a wooden barricade alight
  if(!s.ship&&(MELEE.has(s.at)||((s.z||1)>=1.5&&s.k)))c.add('smash');   // break a cracked stone wall (never a word that takes over your movement, like tàu)
  if(s.at==='scis'||s.at==='snip')c.add('cut');
  if(a&&a.p)c.add('shoot');
  if(s.z&&s.z<=.7)c.add('crawl');
  return c}
const CAPS=WD.map((_,i)=>capsOf(i));
// Gate kinds. Adding a kind = one line here + how it looks/behaves. The generator works backwards from `need`: it only ever offers a pair where exactly one word has it.
const KINDS={chasm:{need:'span'},wood:{need:'burn'},stone:{need:'smash'}};
const KEYPAIRS={};for(const k in KINDS){const need=KINDS[k].need;KEYPAIRS[need]=[];
  for(let p=0;p<NP;p++){const a=p*2,b=a+1;if(!WD[b])continue;const ca=CAPS[a].has(need),cb=CAPS[b].has(need);if(ca!==cb)KEYPAIRS[need].push({p,key:ca?a:b})}}
const GATE_LV=[1,3,5];   // 0-based levels that carry a gate (levels 2, 4, 6)
const GAP_MAX=472,       // the widest gap any jump clears, speed words included (measured by brute force: base 259, ngựa 379, giầy 451, trai 472)
      WALL_W=44,         // wall thickness
      WALL_TOP=-400;     // walls run far past the top of the screen: not even a jump from the flight ceiling (feet at y=36) clears them
// Validator: everything a gate promises, checked on the built level (the dev harness runs it on every build).
function gateProblems(Wd,lp){const bad=[];
  for(const g of Wd.gates){const need=g.need,dec=g.key^1;
    if(!CAPS[g.key].has(need))bad.push(g.kind+': key word lacks '+need);
    if(WD[dec]&&CAPS[dec].has(need))bad.push(g.kind+': decoy also has '+need);
    if(g.pk.length!==2||g.pk.map(k=>k.i).sort().join()!==[g.key,dec].sort().join())bad.push(g.kind+': pedestal is not the key pair');
    if(g.echo.length!==2||g.echo.map(k=>k.i).sort().join()!==[g.key,dec].sort().join())bad.push(g.kind+': echo is not the key pair');
    if(g.kind==='chasm'){if(g.w<=GAP_MAX+20)bad.push('chasm of '+Math.round(g.w)+'px can be jumped')}
    else{const wl=Wd.walls.find(q=>q.gate===g.id);if(!wl||wl.top>WALL_TOP)bad.push(g.kind+': no full-height wall');else if(wl.kind!==g.kind)bad.push('wall kind mismatch')}
    if(!(g.px<g.x0-60&&g.ex>g.x1+60))bad.push(g.kind+': pedestal/echo on the wrong side');
    if(lp)for(const p of lp)if(p!==(g.key>>1)&&(CAPS[p*2].has(need)||(WD[p*2+1]&&CAPS[p*2+1].has(need))))bad.push(g.kind+': the level\'s other pair also opens it')}
  return bad}
function pickPairs(seed,set){
  const r=mb(seed*977+set*131+3),R=()=>r(),gi=IDX.great>>1,used=new Set([gi]),out=[],gate={};
  const good=p=>WD[p*2][4]===1||(WD[p*2+1]&&WD[p*2+1][4]===1);
  const has=(p,need)=>CAPS[p*2].has(need)||(WD[p*2+1]&&CAPS[p*2+1].has(need));
  const wpick=(c,tot)=>{let x=R()*tot;for(const[v,w]of c){x-=w;if(x<=0)return v}return c[c.length-1][0]};
  const draw=(t,wantGood,notNeed)=>{const c=[];let tot=0;
    for(let p=0;p<NP;p++)if(!used.has(p)&&(!wantGood||good(p))&&!(notNeed&&has(p,notNeed))){const w=Math.exp(-Math.pow(PC[p]-t,2)*1.5)+.02;c.push([p,w]);tot+=w}
    const p=wpick(c,tot);used.add(p);return p};
  // generator inversion: the obstacle comes first, then a pair that can open it, as close in difficulty to this part of the game as possible
  const gdraw=(kind,t)=>{const need=KINDS[kind].need,c=[];let tot=0;
    for(const kp of KEYPAIRS[need])if(!used.has(kp.p)){const w=Math.exp(-Math.pow(PC[kp.p]-t,2)*1.5)+.02;c.push([kp,w]);tot+=w}
    const kp=wpick(c,tot);used.add(kp.p);return{kind,need,key:kp.key,pair:kp.p}};
  const tOf=lv=>1+2*(set*LEVELS+lv)/(SETS.length*LEVELS-1);
  const kinds=Object.keys(KINDS);for(let i=kinds.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[kinds[i],kinds[j]]=[kinds[j],kinds[i]]}   // every set meets every kind, in its own order
  GATE_LV.forEach((lv,n)=>{gate[lv]=gdraw(kinds[n],tOf(lv))});
  for(let lv=0;lv<LEVELS-1;lv++){const t=tOf(lv),g=gate[lv],a=g?g.pair:draw(t,false),b=draw(t,!good(a),g&&g.need);out.push([a,b])}   // (the other pair never opens the gate by accident)
  out.push([gi,draw(3,false)]);   // the rainbow finale always has giỏi/dở
  out.gate=gate;                  // lv -> {kind, need, key (word index), pair}
  return out}
// which of the two words goes first (left / top): no cue at all - the good one is first half the time
function orient(a,b,R){const sc=v=>v===1?2:v===2?1:0,x=sc(WD[a][4]),y=sc(WD[b][4]);
  if(x===y)return R()<.5?[a,b]:[b,a];
  const gw=x>y?a:b,bw=gw===a?b:a;return R()<.5?[gw,bw]:[bw,gw]}

// ===== the hub contract: the run (set / level / lives / seed) is host state =====
const freshRun=()=>({phase:'idle',set:0,level:0,lives:LIVES_START,seed:0,seq:0,deaths:0,resets:0,cleared:0});
export function init(ctx){
  const runs={};((ctx&&ctx.atTable)||[]).forEach(p=>{if(p&&p.id&&!p.spectator)runs[p.id]=freshRun()});
  return{v:1,runs,done:null,n:0};
}
export function reduce(state,a,ctx){
  const id=ctx&&ctx.from&&ctx.from.id;
  if(!id)return{error:'Unknown sender.'};
  if(!a||typeof a.a!=='string')return{error:'Unknown action.'};
  if(a.a==='join')return state.runs[id]?state:{...state,runs:{...state.runs,[id]:freshRun()}};
  const r=state.runs[id];
  if(!r)return{error:'You are watching — not seated.'};
  const put=(nr,extra)=>({...state,...(extra||{}),runs:{...state.runs,[id]:nr}});
  if(a.a==='start'){
    if(r.phase==='play')return state;
    const rng=(ctx&&ctx.rng)||Math.random;
    return put({...freshRun(),phase:'play',seed:Math.floor(rng()*4294967296),seq:r.seq+1});
  }
  if(r.phase!=='play'||a.seq!==r.seq)return state;   // a stale or repeated report: ignore quietly
  if(a.a==='die'){
    const lives=r.lives-1;
    if(lives>0)return put({...r,lives,seq:r.seq+1,deaths:r.deaths+1});
    return put({...r,lives:LIVES_START,level:0,seq:r.seq+1,deaths:r.deaths+1,resets:r.resets+1});   // out of lives: back to the start of this set
  }
  if(a.a==='clear'){
    const lives=Math.min(LIVES_MAX,r.lives+1);
    if(r.level+1<LEVELS)return put({...r,lives,level:r.level+1,seq:r.seq+1,cleared:r.cleared+1});
    const won=r.set+1>=SETS.length,n=state.n+1;
    const nr=won?{...r,phase:'won',lives,seq:r.seq+1,cleared:r.cleared+1}
               :{...r,set:r.set+1,level:0,lives:Math.max(lives,LIVES_START),seq:r.seq+1,cleared:r.cleared+1};
    return put(nr,{n,done:{n,id,set:r.set,won,lives:nr.lives}});
  }
  return{error:'Unknown action.'};
}
export function project(state,playerId){
  return{v:state.v,you:playerId,run:state.runs[playerId]||null,done:state.done,
    others:Object.keys(state.runs).filter(k=>k!==playerId).map(k=>({id:k,set:state.runs[k].set,level:state.runs[k].level,phase:state.runs[k].phase}))};
}
export function summarize(state,nameOf){
  const d=state.done;if(!d)return null;
  return d.won?`${nameOf(d.id)} cleared all ${SETS.length} sets of ${meta.title}`:`${nameOf(d.id)} cleared set ${d.set+1} (${SETS[d.set].n}) of ${meta.title}`;
}
export function roundId(state){return 'd'+(state.done?state.done.n:0)}
export function prune(state,goneId){
  if(!state.runs[goneId])return state;
  const runs={...state.runs};delete runs[goneId];return{...state,runs};
}

// ===== the game itself =====
export function mount(root,api){
  // ===== state =====
  const K={left:0,right:0,up:0,down:0,jump:0,act:0};
  const G={mode:'wait',sc:'up',set:0,lv:0,seed:0,seq:-1,resets:null,lives:LIVES_START,t:0,intro:0,retry:0,clearT:0,waitT:0,cam:0,shake:0,wife:null,freeze:0,lp:[],out:null,lastOut:null,starting:0,joined:0,spec:false};
  let P=null,W=null,WAT=null,pops=[],parts=[],shots=[],GN=0,dead=false;
  const queue=o=>{G.out=G.lastOut=o};   // intents are queued and sent at the END of a frame, never from inside one
  const has=k=>P.fx[k]>0;
  function capNow(c){for(const i in P.fx)if(P.fx[i]>0&&CAPS[IDX[i]].has(c))return true;return false}   // does a word you are carrying give this capability?
  function any(k){for(const i in P.fx)if(P.fx[i]>0&&SP[i][k])return SP[i][k];return 0}
  function mul(k){let m=1;for(const i in P.fx)if(P.fx[i]>0&&SP[i][k]!==undefined)m*=SP[i][k];return m}
  const foes=()=>G.sc==='water'?WAT.en:W.en;
  const pop=(s,x,y,sz)=>pops.push({s,x,y,t:G.t,sz:sz||24});
  function puff(x,y,n,c){for(let i=0;i<n;i++)parts.push({x,y,vx:(Math.random()-.5)*130,vy:-Math.random()*100,t:0,l:.45+Math.random()*.3,c:c||'#fff'})}

  // ===== audio (optional files; see the header) =====
  const AS='../assets/tutrainghia/';
  let AC=null,cur=null,curKey='';
  function tone(f,d,f1,v){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();
   const t=AC.currentTime,o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.setValueAtTime(f,t);if(f1)o.frequency.exponentialRampToValueAtTime(f1,t+d);
   g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(v||.12,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+d+.05)}catch(e){}}
  function music(list){try{   // list = candidate file stems, tried in order; the first one that loads plays
    const key=list.join('|');if(key===curKey)return;curKey=key;if(cur){cur.pause();cur=null}
    let i=0;const next=()=>{if(i>=list.length||curKey!==key)return;const a=new Audio(AS+'music/'+list[i++]+'.mp3');a.loop=true;a.volume=.45;a.onerror=next;cur=a;a.play().catch(()=>{})};next()}catch(e){}}
  const trackL=()=>['s'+(G.set+1)+'-'+MUS[G.lv],MUS[G.lv]],trackW=()=>['s'+(G.set+1)+'-water','water'].concat(trackL());
  const SFXC={};
  function sfx(id){try{let a=SFXC[id];if(a===undefined){a=new Audio(AS+'sfx/'+id+'.mp3');a.onerror=()=>{SFXC[id]=null};SFXC[id]=a}if(a){a.currentTime=0;a.play().catch(()=>{})}}catch(e){}}
  function unlock(){if(cur&&cur.paused)cur.play().catch(()=>{})}

  // ===== level generation =====
  const lpCache={},pairsOf=(seed,set)=>{const k=seed+'|'+set;return lpCache[k]||(lpCache[k]=pickPairs(seed,set))};
  const E=(e,x,y,vx,x0,x1,o)=>Object.assign({e,x,y,vx,vy:0,x0,x1,y0:0,y1:0,t:0,by:y,amp:0,r:9,s:22,dead:0,stun:0},o||{});
  // Pair events: the two words of a pair go to two DIFFERENT spots (different heights, any order), so you jump for one and can't tell them apart by position. Good words lean high.
  // Pair events: the two words of a minimal pair stand SIDE BY SIDE at the same height, so nothing but the language tells you which is which.
  // You choose one by standing next to it and pressing ▼ (see forkStep); the other disappears.
  function place(pk,R,lp,spots,n,nh,segs){
    const pick=a=>a[Math.floor(R()*a.length)],free=()=>spots.filter(s=>!s.u&&(!s.t||s.pw>=70)),onG=x=>(segs||[]).some(s=>x>s.x0+22&&x<s.x1-22);
    for(let i=0;i<n;i++){
      const a=lp[Math.floor(R()*lp.length)]*2,b=a+1,g=++GN,fr=free();if(!fr.length)break;
      const up=fr.filter(s=>s.t>=3),mid=fr.filter(s=>s.t>=2),s1=pick(i%3===0&&up.length?up:i%3===0&&mid.length?mid:fr);s1.u=1;
      if(!WD[b]){pk.push({i:a,x:s1.x,y:s1.y,got:0,g,pick:1});continue}
      const sep=s1.t?Math.min(70,s1.pw-14):76,w=orient(a,b,R);
      if(!s1.t&&!(onG(s1.x-sep/2)&&onG(s1.x+sep/2)))continue;   // both words need ground under them
      pk.push({i:w[0],x:s1.x-sep/2,y:s1.y,got:0,g,pick:1},{i:w[1],x:s1.x+sep/2,y:s1.y,got:0,g,pick:1});
    }
    for(let i=0;i<nh;i++){const fr=free().filter(s=>s.t>=1),f=fr.length?fr:free();if(!f.length)break;const s=pick(f);s.u=1;pk.push({h:1,x:s.x,y:s.y,got:0})}
  }
  function build(set,lv,seed,lp){
    const dd=set,S=SETS[set],r=mb(seed*31+lv*7919+set*104729+1),R=()=>r(),segs=[{x0:0,x1:440}],plats=[],en=[],spots=[],pk=[],gates=[],walls=[],GD=pairsOf(seed,set).gate[lv]||null;
    const sp=(x,y,t)=>{const q=t?plats.find(p=>p.x+p.w/2===x&&p.y===y+24):0;spots.push({x,y,t,u:0,pw:q?q.w:0})};   // pw = width of the platform under a spot
    const plat=(x,y,w)=>{plats.push({x,y,w});return{x:x+w/2,y:y-24}};
    const walker=(e,x,v,x0,x1,y)=>en.push(E(e,x,y||GY-11,v*(1+.12*dd)*(R()<.5?-1:1),x0,x1));
    sp(250,GY-26,0);{const q=plat(350,GY-55,90);sp(q.x,q.y,1)}   // the first stretch always offers a ground word and a platform word
    const tower=(a,b)=>{   // a staircase of small platforms up to the high words (sets 3-4 climb one step higher)
      const dir=R()<.5?1:-1,nmax=Math.max(2,Math.floor((b-a-140)/70)+1),n=Math.min(nmax,3+(dd>=2&&R()<.6?1:0));
      for(let i=0;i<n;i++){const w=i<n-1?62:88,x=dir>0?a+30+i*70:b-30-w-i*70,p=plat(x,GY-54*(i+1),w);sp(p.x,p.y,i+1)}};
    const deco=(a,b)=>{
      const L=b-a,ne=Math.floor(R()*(L/(170-10*dd))+.6+lv*.12+.2*dd),F=S.foes;
      for(let i=0;i<ne;i++){const ex=a+70+R()*(L-140),k=R();
        if(k<.3)walker(F[0],ex,26,a+4,b-4);else if(k<.58)walker(F[1],ex,48,a+4,b-4);
        else if(k<.82)en.push(E(F[2],ex,GY-75,40*(1+.12*dd),ex-110,ex+110,{amp:10,by:GY-75-R()*(40+dd*10)}));else walker(F[3],ex,36,a+4,b-4)}
      sp(a+90+R()*(L-180),GY-26,0);if(L>380&&R()<.6)sp(a+90+R()*(L-180),GY-26,0);
      if(R()<.7){const pw=70+R()*50,px=a+50+R()*Math.max(10,L-pw-100),p=plat(px,GY-55,pw);sp(p.x,p.y,1);
        if(R()<.35)en.push(E(F[0],px+pw/2,GY-66,-24*(1+.12*dd),px+4,px+pw-4));
        if(R()<.45){const p2=plat(px+pw-26,GY-108,64);sp(p2.x,p2.y,2)}}
      if(L>=300&&R()<.42+.05*dd)tower(a,b);
    };
    let x=440,gateAt=1150+R()*350,gate=null;
    while(x<3400+lv*500+dd*400){
      let hw=80+R()*(95+12*dd);const isG=GD&&!gate&&x>=gateAt,chasm=isG&&GD.kind==='chasm',wallG=isG&&!chasm;
      if(chasm){const pv=segs[segs.length-1];if(pv.x1-pv.x0<340){pv.x1=pv.x0+340;x=pv.x1}hw=500+R()*40}   // the chasm: wider than any jump
      const a=x+hw,b=a+(chasm?360+R()*160:wallG?720:240+R()*320);
      if(chasm){gate={id:gates.length+1,kind:'chasm',need:GD.need,key:GD.key,x0:x,x1:a,w:hw,done:0,taken:0,armed:0,px:x-150,ex:a+220,pk:[],echo:[]};gates.push(gate)}
      else{
        if(hw>135){const p=plat(x+hw/2-42,GY-55,84);sp(p.x,p.y,1)}
        if(wallG){const wx=a+390;   // one long stretch: pedestal at +130, the wall at +390, the echo at +574
          gate={id:gates.length+1,kind:GD.kind,need:GD.need,key:GD.key,x0:wx,x1:wx+WALL_W,w:WALL_W,done:0,taken:0,armed:0,px:a+130,ex:wx+WALL_W+140,pk:[],echo:[]};gates.push(gate);
          walls.push({x:wx,w:WALL_W,top:WALL_TOP,kind:GD.kind,dead:0,gate:gate.id})}}
      segs.push({x0:a,x1:b});
      if(wallG)deco(gate.x1+30,b);else deco(a,b);   // a wall stretch is calm up to the wall; foes only beyond it
      x=b}
    const fa=x+100;segs.push({x0:fa,x1:fa+520});{const p=plat(x+8,GY-55,84);sp(p.x,p.y,1)}sp(fa+200,GY-26,0);sp(fa+330,GY-26,0);
    const calm=cx=>{for(let j=en.length-1;j>=0;j--)if(en[j].y>GY-50&&en[j].x0<=cx+170&&en[j].x1>=cx-170)en.splice(j,1);for(const s of spots)if(Math.abs(s.x-cx)<150)s.u=1};   // a quiet patch of ground around a pedestal
    for(const g of gates){   // the pedestal before the obstacle and the echo after it: the key pair, side by side, either way round
      const a=g.key&~1,b=a+1;
      for(const[cx,echo,list]of[[g.px,0,g.pk],[g.ex,1,g.echo]]){
        const gid=++GN,w=orient(a,b,R),L={i:w[0],x:cx-38,y:GY-26,got:0,g:gid,pick:1,ped:1,gate:g.id},Rt={i:w[1],x:cx+38,y:GY-26,got:0,g:gid,pick:1,ped:1,gate:g.id};
        if(echo)L.echo=Rt.echo=1;
        pk.push(L,Rt);list.push(L,Rt);calm(cx)}}
    const gp=GD?GD.pair:-1,lpp=lp.filter(p=>p!==gp);   // the gate's pair lives on the pedestal and the echo only
    place(pk,R,lpp.length?lpp:lp,spots,Math.round(segs.length*.6+2),3,segs);
    const out={segs,plats,en,pk,len:fa+520,flag:fa+440,gates,walls};
    if(api.__tt){const bad=gateProblems(out,lp);if(bad.length)throw new Error('gate validator: '+bad.join('; '))}   // only in the test harness
    return out;
  }
  function buildWater(set,lv,seed,hi,lp){
    const r=mb(seed*17+lv*101+hi*13+set*7+5),R=()=>r(),len=1500+R()*500+set*150,en=[],pk=[],n=Math.floor(len/(95-8*set)),sp=1+.12*set;
    for(let i=0;i<n;i++){const x=320+i*(len-480)/n+R()*40,y=60+R()*240,k=R(),d=R()<.5?-1:1;
      if(k<.3)en.push(E('🐟',x,y,d*(35+R()*40)*sp,x-70,x+70));
      else if(k<.5)en.push(E('🐡',x,y,0,x,x,{vy:d*25*sp,y0:50,y1:330}));
      else if(k<.7)en.push(E('🦑',x,y,0,x,x,{vy:d*45*sp,y0:50,y1:330}));
      else if(k<.85)en.push(E('🪼',x,y,d*15,x-40,x+40,{amp:40,by:y}));
      else en.push(E('🦈',x,y,d*28*sp,x-120,x+120,{r:15,s:36}));}
    for(let i=0;i<4;i++){   // the two words hang one above the other in the same current: steer up or down to choose
      const a=lp[Math.floor(R()*lp.length)]*2,b=a+1,g=++GN,x1=300+R()*(len-600),yt=60+R()*60,yb=yt+120+R()*40;
      if(!WD[b]){pk.push({i:a,x:x1,y:60+R()*240,got:0,g});continue}
      const w=orient(a,b,R);pk.push({i:w[0],x:x1,y:yt,got:0,g},{i:w[1],x:x1,y:yb,got:0,g})}
    pk.push({h:1,x:400+R()*(len-700),y:80+R()*200,got:0});
    return{en,pk,len};
  }
  function mv(e,dt){
    e.t+=dt;e.x+=e.vx*dt;if(e.x<e.x0||e.x>e.x1){e.vx=-e.vx;e.x=cl(e.x,e.x0,e.x1)}
    if(e.vy){e.y+=e.vy*dt;if(e.y<e.y0||e.y>e.y1)e.vy=-e.vy}
    if(e.amp)e.y=e.by+Math.sin(e.t*3)*e.amp;
  }
  const upd=(e,dt)=>{if(e.stun>0)e.stun-=dt;else mv(e,dt)};

  // ===== following the host's run =====
  function startLevel(retry){
    G.mode='up';G.sc='up';G.intro=retry===1?1.6:retry===2?2.8:2.8;G.retry=retry;G.cam=0;G.freeze=0;G.starting=0;
    W=build(G.set,G.lv,G.seed,G.lp[G.lv]);WAT=null;pops=[];shots=[];parts=[];
    P={x:60,y:GY,vx:0,vy:0,f:1,og:true,coy:0,jb:0,jp:0,jn:0,ju:0,spin:0,hp:3,inv:0,fx:{},t:0,say:'',sayT:0,cd:0,sw:0,swe:'',beam:0,lock:null,head:null,rt:0,rd:null,tx:0,hist:[],saw:0,dp:0};G.near=null;
    if(G.wife){G.wife.x=30;G.wife.y=GY;G.wife.vx=G.wife.vy=0}
    music(trackL());
  }
  function applyRun(r){
    if(G.spec){G.mode='watch';return}
    if(!r){G.mode='wait';return}
    if(r.phase==='idle'){G.mode='title';G.starting=0;G.resets=null;G.seq=-1;G.seed=0;return}
    if(r.phase==='won'){G.mode='end';G.starting=0;G.lives=r.lives;G.resets=null;G.seq=-1;G.seed=0;return}
    const inGame=G.mode==='up'||G.mode==='water'||G.mode==='clear'||G.mode==='wait';
    if(inGame&&G.seq===r.seq&&G.seed===r.seed)return;   // nothing new
    const same=G.seed===r.seed&&G.set===r.set&&G.lv===r.level&&G.seq>=0;
    const retry=G.resets!==null&&r.resets!==G.resets?2:same?1:0;
    G.set=r.set;G.lv=r.level;G.seed=r.seed;G.seq=r.seq;G.resets=r.resets;G.lives=r.lives;G.lp=pairsOf(r.seed,r.set);
    startLevel(retry);
  }
  function startRun(){if(G.spec||G.starting||(G.mode!=='title'&&G.mode!=='end'))return;G.starting=1;queue({a:'start'})}
  // ===== rules =====
  const floorAt=(x,prev,next)=>{let b=null;
    for(const s of W.segs)if(x>s.x0-8&&x<s.x1+8&&prev<=GY+2&&next>=GY){b=GY;break}
    for(const p of W.plats)if(x>p.x-6&&x<p.x+p.w+6&&prev<=p.y+2&&next>=p.y&&(b===null||p.y<b))b=p.y;
    return b};
  function kill(e){e.dead=1;pop('💥',e.x,e.y,26);puff(e.x,e.y,7,'#ffe27a');tone(300,.12,150,.12);G.shake=Math.max(G.shake,.12)}
  function lock(s){P.lock={t:0,d:s.L,lk:s.lk,e:s.e,end:s.end,safe:s.lk==='b'};P.vx=0;if(s.lk==='d')G.freeze=s.L}
  const ONE={   // special power-ups
    wife(){if(G.wife){P.hp=Math.min(3,P.hp+1);pop('💞',P.x,P.y-70,30);tone(660,.12,990)}   // she is already with you: another vow, +1 heart (she stays for the whole run)
    else{G.wife={x:P.x-30,y:P.y,vx:0,vy:0,og:1,f:1,jt:0,t:0};pop('💞',P.x,P.y-70,30)}},
    gift(s){if(G.wife)lock({L:s.L||1.6,lk:'o',e:s.e,end:'heart'});else lock({L:5,lk:'o',e:s.e})},   // with a wife: she loves it, +1 heart. without: stand there holding it
    face(){if(G.sc==='water'){lock({L:4,lk:'o',e:'😵'});return}P.head={x:P.x,y:P.y-36,vx:P.f*140,vy:-230,t:0}},   // head falls off: chase it within 12s or die
    bridge(){if(G.mode!=='up')return;
      const g=(W.gates||[]).find(q=>q.kind==='chasm'&&!q.done&&P.x<q.x1&&P.x>q.x0-440);   // a chasm ahead: the bridge spans ALL of it and stays
      if(g){W.plats.push({x:g.x0-12,y:GY,w:g.w+24,br:1,deck:1,gate:g.id});g.done=1;pop('🌉',g.x0+g.w/2,GY-70,36);puff(g.x0+g.w/2,GY,14,'#e9c58a');return}
      const x=P.x+70;[[0,GY-34,52],[52,GY-68,76],[128,GY-34,52]].forEach(a=>W.plats.push({x:x+a[0],y:a[1],w:a[2],ex:G.t+14,br:1}))},   // no chasm: the short 14s arch
    broke(){P.fx={};   // vỡ: everything you were carrying breaks - and so does any bridge you built
      for(const q of W.plats)if(q.deck){const g=(W.gates||[]).find(z=>z.id===q.gate);if(g){g.done=0;g.armed=g.taken?1:0}puff(q.x+q.w/2,q.y,16,'#a8763e')}
      W.plats=W.plats.filter(q=>!q.deck&&!q.br);pop('💔',P.x,P.y-60,32);G.shake=.4;tone(180,.3,70,.2)},
    sing(){foes().forEach(e=>{if(!e.dead&&Math.abs(e.x-G.cam-LW/2)<LW/2+30)kill(e)});for(let i=0;i<6;i++)pop('🎵',P.x+(i-3)*30,P.y-50-i*6,22)},
    saw(){P.saw=1.3;puff(P.x,P.y-20,12,'#f66')},
    great(){['big','shoes','blaze','light'].forEach(k=>P.fx[k]=8)},    // all the good ones at once
    awful(){['wide','itch','snake'].forEach(k=>P.fx[k]=8);lock({L:3,lk:'z',e:'💤'})}   // all the worst at once
  };
  function take(i){
    const w=WD[i],s=w[5],pr=WD[i^1];if(pr&&pr[0]!==w[0])delete P.fx[pr[0]];
    if(s.f)for(const k in P.fx)if(SP[k].f)delete P.fx[k];
    P.say=w[1];P.sayT=2.4;pop(w[3],P.x,P.y-60,28);sfx(w[0]);
    if(w[4]===1){tone(520,.1,780);api.setTimeout(()=>tone(780,.15,1040),90)}else{tone(400,.15,200);api.setTimeout(()=>tone(260,.2,130),110)}
    if(s.one)ONE[s.one](s,w);else if(s.L)lock(s);else{P.fx[w[0]]=s.d||8;if(s.tet)P.tx=P.x}
  }
  function die(){queue({a:'die',seq:G.seq});G.mode='wait';G.waitT=0}   // out of hearts: the host takes a life and tells us what to load next
  function hurt(e){
    const p=P;if(p.inv>0||has('star')||has('where')||(p.lock&&p.lock.safe)||p.saw>0)return false;
    p.hp--;p.inv=1.6;p.vy=-240;p.vx=(p.x>e.x?1:-1)*150;p.og=false;tone(220,.3,90,.2);G.shake=.3;puff(p.x,p.y-20,8,'#f66');
    if(p.hp<=0){die();return true}return false}
  function win(){tone(523,.15);api.setTimeout(()=>tone(659,.15),130);api.setTimeout(()=>tone(784,.15),260);api.setTimeout(()=>tone(1046,.3),390);
    G.mode='clear';G.clearT=2.6}   // show the recap card, then report 'clear'
  function fall(){
    let j=0;for(let i=0;i<W.segs.length;i++)if(W.segs[i].x0<=P.x)j=i;
    const k=Math.min(W.segs.length-1,j+2+(j&1));
    const gt=(W.gates||[]).find(q=>q.kind==='chasm'&&!q.done&&P.x>q.x0-40&&P.x<q.x1+40);   // fell into a chasm: you come back out on the near side, no skipping it
    WAT=buildWater(G.set,G.lv,G.seed,j,G.lp[G.lv]);WAT.exit=gt?gt.x0-70:W.segs[k].x0+70;WAT.gate=gt||null;
    G.mode='water';G.sc='water';G.cam=0;P.x=40;P.y=60;P.vx=0;P.vy=0;P.inv=Math.max(P.inv,.8);P.head=null;tone(300,.5,100);music(trackW());
  }
  function surface(){
    const gt=WAT.gate;G.mode='up';G.sc='up';P.x=WAT.exit;P.y=GY-30;P.vy=-430;P.vx=0;P.og=false;P.inv=2;WAT=null;if(gt&&!gt.done)reoffer(gt);pop('💦',P.x,GY-60,30);tone(400,.3,900);music(trackL());
  }
  function collect(arr,test){
    for(const k of arr)if(!k.got&&test(k)){k.got=1;
      if(k.h){P.hp=Math.min(3,P.hp+1);pop('❤️',k.x,k.y-10,26);tone(660,.12,990)}
      else{if(k.g)for(const o of arr)if(o.g===k.g)o.got=1;take(k.i)}}
  }
  function breakWall(wl){wl.dead=1;const g=W.gates.find(q=>q.id===wl.gate);if(g)g.done=1;
    puff(wl.x+wl.w/2,GY-50,20,wl.kind==='wood'?'#ff9a3c':'#bdbdbd');pop(wl.kind==='wood'?'🔥':'💥',wl.x+wl.w/2,GY-96,38);G.shake=.35;tone(160,.3,60,.2)}
  function reoffer(g){for(const k of g.pk){k.got=0;delete P.fx[WD[k.i][0]]}g.taken=0;g.armed=0;pop('🔄',g.px,GY-70,26);tone(500,.08,700,.08)}   // the pedestal offers its pair again: a wrong choice is never a dead end
  function gateStep(){
    for(const g of W.gates){
      if(g.done)continue;
      if(P.x>g.x1+30){g.done=1;continue}
      if(g.taken){const d=Math.abs(P.x-g.px);if(d>110)g.armed=1;else if(g.armed&&d<44&&P.og)reoffer(g)}}}   // walk away and come back to choose again
  function forkStep(reach){   // words are CHOSEN, not bumped into: stand beside one and press ▼
    const p=P,dn=K.down?1:0,edge=dn&&!p.dp;p.dp=dn;
    let b=null,bd=1e9;
    if(!p.lock)for(const k of W.pk)if(!k.got&&!k.h&&reach(k)){const d=Math.abs(k.x-p.x);if(d<bd){bd=d;b=k}}
    G.near=b;
    if(!b||!edge)return;
    b.got=1;if(b.g)for(const o of W.pk)if(o.g===b.g)o.got=1;
    const gt=b.gate?W.gates.find(q=>q.id===b.gate):null;
    if(gt&&b.echo){if(b.i===gt.key){P.hp=Math.min(3,P.hp+1);pop('💚',P.x,P.y-84,24);tone(660,.1,990,.1)}}   // the echo: read the pair again - the right word heals you
    else if(gt){gt.taken=1;gt.armed=0}
    take(b.i)}
  function ctlDir(dir,dt){const rr=any('r');if(!rr||P.lock)return dir;P.rt-=dt;if(P.rt<=0){P.rt=.25+Math.random()*.35;P.rd=Math.random()<rr*.7?[-1,0,1][Math.floor(Math.random()*3)]:null}return P.rd===null?dir:P.rd}
  function clonePos(){const h=P.hist;if(!h.length||!any('clone'))return null;let c=null;for(const q of h)if(G.t-q.t>=1)c=q;return c}

  function foeStep(dt,fr){   // touching enemies: stomp / kill-on-touch / hurt, plus the area powers
    const p=P,sz=mul('z'),wx=mul('w'),up=G.sc==='up',cart=any('cart'),tent=any('tent'),aura=any('aura'),cp=clonePos();
    const kl=any('k')||(has('dive')&&K.down&&!p.og&&p.vy>200&&up);
    for(const e of foes()){
      if(e.dead)continue;
      if(!fr)upd(e,dt);
      const cy=up?p.y-20*sz:p.y,dx=e.x-p.x;
      if(aura&&Math.abs(dx)<110&&Math.abs(e.y-cy)<60){e.vx=(dx>=0?1:-1)*(Math.abs(e.vx)||40);continue}
      if(tent&&Math.hypot(dx,e.y-cy)<56*sz){kill(e);continue}
      if(cart&&dx*p.f>0&&Math.abs(dx)<44&&Math.abs(e.y-cy)<24){kill(e);continue}
      if(cp&&Math.abs(e.x-cp.x)<22&&Math.abs(e.y-(cp.y-16))<26){kill(e);continue}
      if(fr)continue;
      const hit=up?(Math.abs(dx)<e.r*.8+6*sz*wx&&p.y-34*sz<e.y+e.r*.7&&p.y>e.y-e.r*.7):(Math.abs(dx)<10*sz*wx+e.r*.75&&Math.abs(e.y-p.y)<10*sz+e.r*.75);
      if(hit){
        if(kl||(up&&p.vy>0&&p.y<e.y+4)){kill(e);if(!kl){p.vy=-300;p.jn=0}}
        else if(hurt(e))return true;
      }
    }
    return false}
  function act(){
    const a=any('at'),A=a&&ATK[a];if(!A||!K.act||P.cd>0||P.lock)return;
    const p=P,f=p.f,sz=mul('z'),cy=G.sc==='water'?p.y:p.y-20*sz;p.cd=A.cd;
    if(A.p)shots.push({x:p.x+f*16,y:cy-4,vx:f*A.v+p.vx*.3,vy:A.vy||0,g:A.g||0,e:A.p,k:A.k,st:A.st,t:0});
    else if(A.beam){p.beam=.2;foes().forEach(e=>{if(!e.dead&&(e.x-p.x)*f>0&&Math.abs(e.x-p.x)<320&&Math.abs(e.y-(cy-10))<26)kill(e)})}
    else{p.sw=.18;p.swe=A.e;const cx=p.x+f*A.m*.6;foes().forEach(e=>{if(!e.dead&&Math.abs(e.x-cx)<A.m*.6+e.r&&Math.abs(e.y-cy)<36)kill(e)});
      if(G.sc==='up'&&MELEE.has(a))for(const wl of W.walls)if(!wl.dead&&wl.kind==='stone'&&Math.abs(wl.x+wl.w/2-cx)<A.m*.6+wl.w/2+6)breakWall(wl)}   // a punch or a slap cracks the stone
    tone(A.p?700:500,.08,A.p?300:200,.08)}
  function shotsStep(dt){
    for(const s of shots){s.t+=dt;s.x+=s.vx*dt;s.vy+=s.g*dt;s.y+=s.vy*dt;
      for(const e of foes())if(!e.dead&&Math.abs(e.x-s.x)<e.r+8&&Math.abs(e.y-s.y)<e.r+8){if(s.st)e.stun=s.st;else kill(e);s.t=9;break}
      if(G.sc==='up'&&s.y>GY)s.t=9;
      if(G.sc==='up')for(const wl of W.walls){if(wl.dead||s.x<wl.x-6||s.x>wl.x+wl.w+6)continue;if(wl.kind==='wood'&&s.e==='🔥')breakWall(wl);s.t=9;break}}   // fire burns the barricade; any shot stops at a wall
    shots=shots.filter(s=>s.t<1.4&&Math.abs(s.x-(G.cam+LW/2))<LW)}
  function stepWife(dt){   // follows the eggs-bot recipe: chase the nearest target, spaced jump taps, random hops, snap back if far behind
    const w=G.wife,p=P;w.t+=dt;w.jt-=dt;
    if(G.sc==='water'){w.x+=(p.x-36*p.f-w.x)*Math.min(1,dt*3);w.y+=(p.y+4-w.y)*Math.min(1,dt*3);w.f=p.f;w.og=0;w.vx=p.vx;return}
    let tg=null,bd=240;for(const e of W.en)if(!e.dead){const d=Math.abs(e.x-w.x);if(d<bd&&Math.abs(e.y-w.y)<70){bd=d;tg=e}}
    const gx=tg?tg.x:p.x-p.f*46,dx=gx-w.x,dir=Math.abs(dx)>14?Math.sign(dx):0;if(dir)w.f=dir;
    const sp=tg?170:(Math.abs(dx)>200?210:130);
    w.vx+=cl(dir*sp-w.vx,-1500*dt,1500*dt);w.x=cl(w.x+w.vx*dt,12,W.len-12);
    let wb=0;for(const wl of W.walls){if(wl.dead)continue;if(w.x>wl.x-9&&w.x<wl.x+wl.w+9&&w.y>wl.top+1){w.x=w.x<wl.x+wl.w/2?wl.x-9:wl.x+wl.w+9;w.vx=0;wb=1}}   // she is stopped by walls too…
    w.blk=wb?(w.blk||0)+dt:0;if(w.blk>1.2){w.blk=0;w.x=p.x-p.f*40;w.y=p.y-30;w.vy=0;w.vx=0;puff(w.x,w.y,6,'#f9a')}   // …and, if stuck on the wrong side, joins you
    const hole=w.og&&floorAt(w.x+w.f*26,w.y-1,w.y+2)===null;
    if(w.og&&w.jt<=0&&(hole||(tg&&bd<80)||p.y<w.y-45||Math.random()<.006)){w.vy=-370;w.og=false;w.jt=.34+Math.random()*.2}
    w.vy=Math.min(w.vy+950*dt,560);const ny=w.y+w.vy*dt,fl=w.vy>=0?floorAt(w.x,w.y,ny):null;
    if(fl!==null){w.y=fl;w.vy=0;w.og=true}else{w.y=ny;w.og=false}
    if(w.y>LH+40||Math.abs(w.x-p.x)>420){w.x=p.x-p.f*40;w.y=p.y-30;w.vy=0;w.vx=0;puff(w.x,w.y,6,'#f9a')}
    if(tg&&Math.abs(tg.x-w.x)<26&&Math.abs(tg.y-(w.y-14))<30)kill(tg)}

  function stepUp(dt){
    const p=P,L=p.lock,fr=G.freeze>0,sz=mul('z'),jm=mul('j'),fl=any('fly');
    let dir=ctlDir(L?0:(K.right?1:0)-(K.left?1:0),dt);
    if(any('ship')&&!L)dir=1;
    if(dir)p.f=dir;
    const acc=1500*mul('sl')*dt;
    p.vx+=cl(dir*150*mul('s')-p.vx,-acc,acc);
    p.x=cl(p.x+p.vx*dt,12,W.len-12);
    if(has('string'))p.x=cl(p.x,p.tx-90,p.tx+90);
    for(const wl of W.walls){if(wl.dead)continue;   // walls are solid, floor to ceiling: nothing but their own weakness gets past
      const hw=9*mul('w');
      if(p.x>wl.x-hw&&p.x<wl.x+wl.w+hw&&p.y>wl.top+1){
        if(wl.kind==='stone'&&any('k')&&sz>=1.5&&capNow('smash'))breakWall(wl);   // a big body (lớn, voi) just walks through it
        else{p.x=p.x<wl.x+wl.w/2?wl.x-hw:wl.x+wl.w+hw;p.vx=0}}}
    const jh=!L&&(K.jump||K.up),edge=jh&&!p.jp;p.jp=jh;if(edge)p.jb=.13;p.jb-=dt;p.coy=p.og?.12:p.coy-dt;
    const mj=any('mj')||2;
    if(jm>0&&!L&&!fl){
      if(p.jb>0&&p.coy>0){p.vy=-370*jm;p.og=false;p.coy=0;p.jb=0;p.jn=1;p.ju=1;tone(520,.12,780,.08);puff(p.x,p.y,4)}
      else if(edge&&!p.og&&p.coy<=0&&p.jn<mj){p.vy=-340*jm;p.jn++;p.ju=1;p.spin=.4;tone(700,.12,1000,.08);puff(p.x,p.y-8,6)}   // double jump
    }
    if(p.ju&&!jh&&p.vy<-170)p.vy=-170;
    if(fl&&!L)p.vy=cl(p.vy+(jh?-1500:420)*dt,-190,K.down?200:150);
    else p.vy=Math.min(p.vy+950*dt,560);
    if(has('dive')&&K.down&&!p.og&&p.vy>0&&!fl)p.vy=560;
    const ny=p.y+p.vy*dt,f=p.vy>=0?floorAt(p.x,p.y,ny):null;
    if(f!==null){if(!p.og&&p.vy>260)puff(p.x,p.y,5,'#cbb');p.y=f;p.vy=0;p.og=true;p.ju=0;p.jn=0}
    else{p.y=fl?Math.max(ny,36):ny;p.og=false;if(p.coy<=0&&p.jn===0)p.jn=1}
    if(p.y>LH+60){fall();return}
    G.cam=cl(p.x-LW*.35,0,W.len-LW);
    if(W.plats.some(q=>q.ex&&q.ex<G.t))W.plats=W.plats.filter(q=>!q.ex||q.ex>G.t);
    if(foeStep(dt,fr))return;
    const reach=k=>Math.abs(k.x-p.x)<26*mul('w')&&k.y>p.y-44*sz&&k.y<p.y+10;
    collect(W.pk,k=>k.h&&reach(k));   // hearts are still bumped into
    forkStep(reach);gateStep();
    if(Math.abs(W.flag-p.x)<28)win();
  }
  function stepWater(dt){
    const p=P,L=p.lock,fr=G.freeze>0,sp=mul('s')*mul('sw'),k=Math.min(1,dt*5);
    const dx=ctlDir(L?0:(K.right?1:0)-(K.left?1:0),dt),dy=L?0:(K.down?1:0)-((K.up||K.jump)?1:0);
    if(dx)p.f=dx;p.og=false;
    p.vx+=(dx*105*sp-p.vx)*k;p.vy+=(dy*105*sp+(dy?0:10)-p.vy)*k;
    p.x=cl(p.x+p.vx*dt,16,WAT.len+30);p.y=cl(p.y+p.vy*dt,28,LH-22);
    G.cam=cl(p.x-220,0,WAT.len-LW);
    if(p.x>=WAT.len){surface();return}
    if(foeStep(dt,fr))return;
    collect(WAT.pk,k=>Math.abs(k.x-p.x)<26&&Math.abs(k.y-p.y)<26);
  }
  function tick(dt){
    G.t+=dt;G.shake=Math.max(0,G.shake-dt);
    for(const s of parts){s.t+=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.vy+=220*dt}parts=parts.filter(s=>s.t<s.l);
    if(G.mode==='clear'){G.clearT-=dt;if(G.clearT<=0){queue({a:'clear',seq:G.seq});G.mode='wait';G.waitT=0}return}
    if(G.mode==='wait'){G.waitT+=dt;if(G.waitT>2.5&&G.lastOut&&!G.out&&G.seq>=0){G.waitT=0;G.out=G.lastOut}return}   // still waiting for the host: say it again
    if(G.mode!=='up'&&G.mode!=='water')return;
    if(G.intro>0){G.intro-=dt;return}
    if(P.saw>0){P.saw-=dt;if(P.saw<=0){if(SAW_KILLS)die();else{P.saw=0;P.hp-=2;if(P.hp<=0)die()}}return}
    P.t+=dt;P.inv=Math.max(0,P.inv-dt);P.sayT-=dt;P.cd-=dt;P.sw-=dt;P.beam-=dt;P.spin=Math.max(0,P.spin-dt);
    if(G.freeze>0)G.freeze-=dt;
    for(const k in P.fx)if((P.fx[k]-=dt)<=0){delete P.fx[k];if(k==='hurry')lock({L:5,lk:'z',e:'💫'})}
    if(P.lock){const L=P.lock;L.t+=dt;if(L.t>=L.d){P.lock=null;if(L.end==='heart'){P.hp=Math.min(3,P.hp+1);pop('💖',P.x,P.y-50,28)}}}
    if(any('clone')){P.hist.push({x:P.x,y:P.y,f:P.f,og:P.og,vx:P.vx,t:G.t});while(P.hist.length&&G.t-P.hist[0].t>1.3)P.hist.shift()}else P.hist.length=0;
    if(P.head){const h=P.head;h.t+=dt;h.vy+=900*dt;const pb=h.y+9,nb=pb+h.vy*dt;h.x+=h.vx*dt;
      const fl=h.vy>0?floorAt(h.x,pb,nb):null;
      if(fl!==null){h.y=fl-9;h.vy=-h.vy*.4;h.vx*=.55;if(Math.abs(h.vy)<60)h.vy=0}else h.y=nb-9;
      if(h.y>LH+40){h.x=P.x;h.y=GY-60;h.vy=0;h.vx=0}
      if(Math.abs(h.x-P.x)<20&&Math.abs(h.y-(P.y-24))<34){P.head=null;pop('🙂',P.x,P.y-60,28);tone(600,.15,900)}
      else if(h.t>12){die();return}}
    act();
    if(G.mode==='up')stepUp(dt);else stepWater(dt);
    if(G.mode!=='up'&&G.mode!=='water')return;
    shotsStep(dt);
    if(G.wife&&G.freeze<=0)stepWife(dt);
  }
  // ===== DOM (all inside the hub's shadow root; keys go to the focusable wrapper, never to window, so chat typing and other games are safe) =====
  const css=document.createElement('style');
  css.textContent=`:host{display:block}
  .w{display:flex;flex-direction:column;align-items:center;gap:8px;padding:4px;outline:none;user-select:none;-webkit-user-select:none;touch-action:none}
  canvas{display:block;width:min(100%,calc((100vh - 140px)*1.7778),1000px);aspect-ratio:16/9;border-radius:12px;background:#0f172a;box-shadow:0 4px 24px rgba(0,0,0,.4)}
  .bar{display:flex;justify-content:space-between;width:min(100%,1000px)}
  .g{display:flex;gap:6px}
  button{width:56px;height:52px;font-size:20px;border:0;border-radius:12px;background:rgba(255,255,255,.22);color:#fff;touch-action:none}
  button:active{background:rgba(255,255,255,.5)}`;
  const wrap=document.createElement('div');wrap.className='w';wrap.tabIndex=0;
  const cv=document.createElement('canvas');cv.width=LW;cv.height=LH;cv.setAttribute('aria-label','Từ Trái Nghĩa');
  const bar=document.createElement('div');bar.className='bar';
  bar.innerHTML='<div class="g"><button data-k="left">◀</button><button data-k="right">▶</button></div><div class="g"><button data-k="down">▼</button><button data-k="act">⚡</button><button data-k="jump">▲</button></div>';
  wrap.append(cv,bar);root.append(css,wrap);
  const ctx=cv.getContext('2d'),ab=bar.querySelector('[data-k=act]');
  let S=1,DPR=1,cw=0,lastAE='';
  function fit(){const w=cv.clientWidth||LW;if(w===cw)return;cw=w;DPR=window.devicePixelRatio||1;S=w/LW;cv.width=Math.round(LW*S*DPR);cv.height=Math.round(LH*S*DPR)}

  // ===== drawing =====
  function em(s,x,y,sz,flip){ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.font=sz+'px '+EF;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#000';ctx.fillText(s,0,0);ctx.restore()}
  function txt(s,x,y,sz,al,fill){ctx.font='bold '+sz+'px system-ui,sans-serif';ctx.textAlign=al||'center';ctx.textBaseline='middle';ctx.lineWidth=Math.max(3,sz/6);ctx.lineJoin='round';ctx.strokeStyle='rgba(0,0,0,.75)';ctx.strokeText(s,x,y);ctx.fillStyle=fill||'#fff';ctx.fillText(s,x,y)}
  function pal(){const h=G.lv===7?(G.t*45)%360:LV[G.lv][1],g=SETS[G.set].g;
    return{h,top:`hsl(${h},75%,70%)`,bot:`hsl(${h},75%,88%)`,gt:`hsl(${h},${g[0]}%,${g[1]}%)`,gt2:`hsl(${h},60%,${Math.min(82,g[1]+16)}%)`,gb:`hsl(${h},${g[2]}%,${g[3]}%)`,pl:`hsl(${h},35%,26%)`}}
  function bubble(s,x,y){
    ctx.font='bold 13px system-ui';const w=ctx.measureText(s).width+16,bx=cl(x-w/2,4,LW-w-4);
    ctx.fillStyle='#fff';ctx.beginPath();if(ctx.roundRect)ctx.roundRect(bx,y-26,w,22,8);else ctx.rect(bx,y-26,w,22);ctx.fill();
    ctx.beginPath();ctx.moveTo(x-5,y-5);ctx.lineTo(x+5,y-5);ctx.lineTo(x,y+2);ctx.fill();
    ctx.fillStyle='#1e293b';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(s,bx+8,y-15);
  }
  // one figure, feet at the origin. q(key) answers "does this body have <key>?" so hero, wife and clone share the same drawing.
  function fig(f,t,sw,col,q){
    ctx.lineCap='round';ctx.strokeStyle='#223';ctx.lineWidth=3;
    if(q('wing')){ctx.fillStyle='rgba(255,255,255,.9)';const w=Math.sin(t*16)*.5;for(const s of[-1,1]){ctx.beginPath();ctx.ellipse(s*11,-27+w*5,5,12,s*(.5+w),0,7);ctx.fill();ctx.stroke()}}
    if(q('f')&&!q('nf')&&!q('sn')){ctx.beginPath();ctx.moveTo(-f*6,-17);ctx.quadraticCurveTo(-f*17,-14+Math.sin(t*9)*3,-f*16,-4);ctx.lineWidth=4;ctx.strokeStyle=col;ctx.stroke();ctx.strokeStyle='#223';ctx.lineWidth=3}
    if(q('pony')){ctx.beginPath();ctx.moveTo(-f*9,-35);ctx.quadraticCurveTo(-f*24,-34,-f*20,-20);ctx.lineWidth=4;ctx.strokeStyle='#8b5a2b';ctx.stroke();ctx.strokeStyle='#223';ctx.lineWidth=3}
    ctx.beginPath();
    if(q('sn')){ctx.strokeStyle=col;ctx.lineWidth=7;ctx.moveTo(0,-10);for(let i=1;i<=6;i++)ctx.lineTo(Math.sin(i*1.2+t*7)*5,-10+i*1.7);ctx.stroke();ctx.strokeStyle='#223';ctx.lineWidth=3}
    else{ctx.moveTo(-3,-10);ctx.lineTo(-3+sw,0);ctx.moveTo(3,-10);ctx.lineTo(3-sw,0);ctx.stroke()}
    const fo=q('foot');if(fo&&!q('sn')){em(fo,-3+sw,-3,11);em(fo,3-sw,-3,11)}
    ctx.lineWidth=q('arms')?6:3;ctx.beginPath();ctx.moveTo(-6,-23);ctx.lineTo(-9-sw*.6,-14);ctx.moveTo(6,-23);ctx.lineTo(9+sw*.6,-14);ctx.stroke();
    ctx.fillStyle=col;ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,-18,7,9,0,0,7);ctx.fill();ctx.stroke();
    if(q('dress')){ctx.fillStyle='#ff8fb8';ctx.beginPath();ctx.moveTo(-10,-5);ctx.lineTo(10,-5);ctx.lineTo(0,-24);ctx.closePath();ctx.fill();ctx.stroke()}
    if(q('mud')){ctx.fillStyle='#7a4b2a';for(const a of[[-3,-14,2.5],[3,-21,2]]){ctx.beginPath();ctx.arc(a[0],a[1],a[2],0,7);ctx.fill()}}
    if(q('arms'))em('💪',f*10,-21,16);
    if(!q('nohead')){
      if(q('f'))em(q('f'),0,-31,30,!q('nf')&&f>0);
      else{
        ctx.fillStyle=col;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,-31,11,0,7);ctx.fill();ctx.stroke();
        if(q('old')){ctx.fillStyle='#eee';ctx.beginPath();ctx.arc(0,-34,10,Math.PI,0);ctx.fill()}
        if(q('ears')){em('👂',-12,-31,20);em('👂',12,-31,20)}
        const ex=q('xeye')?[f*4-1,f*4+1.5]:[f*4-3,f*4+3],big=q('eyes');
        ctx.lineWidth=1.2;for(const x of ex){ctx.fillStyle=big?'#fff':'#223';ctx.beginPath();ctx.arc(x,-33,big?3.2:1.8,0,7);ctx.fill();if(big)ctx.stroke()}
        if(big){ctx.fillStyle='#d11';for(const x of ex){ctx.beginPath();ctx.arc(x+f,-33,1.4,0,7);ctx.fill()}}
        ctx.lineWidth=1.5;ctx.beginPath();
        if(q('teeth')){const h=3+Math.abs(Math.sin(t*9))*4;ctx.fillStyle='#fff';ctx.fillRect(f*4-5,-29,10,h);ctx.strokeRect(f*4-5,-29,10,h);ctx.moveTo(f*4,-29);ctx.lineTo(f*4,-29+h);ctx.stroke()}
        else{if(q('itch'))ctx.arc(f*4,-23,4,Math.PI+.6,2*Math.PI-.6);else ctx.arc(f*4,-30,4,.2,2.9);ctx.stroke()}
        if(q('beard')){ctx.fillStyle='#6b4a2b';ctx.beginPath();ctx.moveTo(-8,-27);ctx.lineTo(8,-27);ctx.lineTo(0,-14);ctx.closePath();ctx.fill()}
        if(q('nose'))em('👃',f*9,-29,16);
      }
    }
    const a=q('acc');if(a)em(a[0],a[1],a[2],a[3]);
    const hd=q('hd');if(hd)em(hd,f*13,-24,17);
    if(q('old'))em('🦯',f*13,-14,18);
    if(q('hot'))em('💢',f*10,-45,14);
  }
  function hero(x,fy,swim){
    const p=P,f=p.f,t=p.t,sz=mul('z'),wx=mul('w'),L=p.lock,lk=L&&L.lk,q=k=>k==='nohead'?!!p.head:any(k);
    let col=any('c')||'hsl(200,60%,68%)';if(has('star'))col=`hsl(${(t*400)%360},85%,65%)`;
    const sw=swim?Math.sin(t*14)*6:(p.og?(Math.abs(p.vx)>12&&!L?Math.sin(t*(mul('s')>1.3?20:12))*6:0):5);
    if(lk==='b'){ctx.save();ctx.translate(x+Math.sin(L.t/L.d*Math.PI)*120,GY-48);ctx.scale(.4,.4);fig(1,t,Math.sin(t*10)*6,col,q);ctx.restore();return}   // walking off down the street in the background
    ctx.save();ctx.translate(x+(has('itch')?Math.sin(t*50)*1.3:0),fy+(has('itch')?Math.cos(t*43)*.9:0));
    if(!swim&&p.og&&lk!=='u'){ctx.fillStyle='rgba(0,0,0,.16)';ctx.beginPath();ctx.ellipse(0,1,12*sz*wx,4,0,0,7);ctx.fill()}
    ctx.scale(sz*wx,sz);
    if(has('where'))ctx.globalAlpha=.3;else if(p.inv>0&&!has('star')&&Math.floor(t*14)%2)ctx.globalAlpha=.35;
    if(q('old'))ctx.rotate(.18*f);
    if(lk==='z'||lk==='l'){ctx.translate(0,-17);ctx.rotate(f*1.55);ctx.translate(0,25)}
    else if(lk==='s')ctx.scale(1,.75);
    else if(lk==='u'){ctx.translate(0,-80);ctx.fillStyle='#8b5a2b';ctx.fillRect(-24,0,48,6)}
    else if(lk==='d')ctx.translate(0,-Math.abs(Math.sin(t*10))*8);
    if(swim){ctx.translate(0,-17);ctx.rotate(f*1.45);ctx.translate(0,17)}
    if(p.spin>0){ctx.translate(0,-17);ctx.rotate(f*(1-p.spin/.4)*6.283);ctx.translate(0,17)}
    if(p.saw>0){const k=1.3-p.saw;for(const s of[-1,1]){ctx.save();ctx.translate(s*k*14,k*10);ctx.rotate(s*k*.35);ctx.beginPath();ctx.rect(s<0?-40:0,-60,40,64);ctx.clip();fig(f,t,0,col,q);ctx.restore()}}   // sawed in half
    else if(lk==='f'){ctx.rotate(Math.sin(t*14)*.5);em(L.e,0,-14,34)}
    else if(has('ship'))em('🚢',0,-16,40);
    else fig(f,t,sw,col,q);
    if(lk==='o')em(L.e,0,-22,40);
    if(lk==='p'){ctx.strokeStyle='#444';ctx.lineWidth=3;ctx.beginPath();for(let i=-2;i<=2;i++){ctx.moveTo(i*7,-46);ctx.lineTo(i*7,3)}ctx.moveTo(-16,-44);ctx.lineTo(16,-44);ctx.moveTo(-16,0);ctx.lineTo(16,0);ctx.stroke()}
    if(lk==='z')em('💤',f*14,-48-(t*20%14),16);
    if(lk==='s'||lk==='l')em(L.e,f*20,-10,24);
    if(lk==='d'){em('🎵',-16,-44-(t*30%12),14);em('🎶',16,-44-(t*26%12),14)}
    if(has('itch'))for(let i=0;i<3;i++){const a=t*3+i*2.1;em('🐜',Math.cos(a)*11,-19+Math.sin(a)*9,9)}
    if(has('star'))for(let i=0;i<2;i++){const a=t*4+i*3.14;em('⭐',Math.cos(a)*20,-20+Math.sin(a)*14,12)}
    if(any('aura'))for(let i=0;i<3;i++)em('💨',Math.cos(t*2+i*2)*16,-14-i*10+Math.sin(t*3+i)*3,12);
    if(mul('sl')<1&&p.og&&Math.abs(p.vx)>30){ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=1.5;for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-f*(8+i*5),-2-i*3);ctx.lineTo(-f*(14+i*5),-2-i*3);ctx.stroke()}}
    ctx.restore();
  }
  function mini(x,fy,f,og,vx,col,alpha,dress,swim){   // wife / clone
    ctx.save();ctx.translate(x,fy);ctx.globalAlpha=alpha;
    if(swim){ctx.translate(0,-17);ctx.rotate(f*1.45);ctx.translate(0,17)}
    fig(f,P.t,swim?Math.sin(P.t*14)*6:(og?(Math.abs(vx)>12?Math.sin(P.t*12)*6:0):5),col,k=>k==='dress'||k==='pony'?dress:0);ctx.restore()}
  function crew(){
    const cam=G.cam,up=G.sc==='up',c=clonePos();
    if(c)mini(c.x-cam,up?c.y:c.y+17*mul('z'),-c.f,c.og,c.vx,'hsl(270,60%,70%)',.55,false,!up);
    if(G.wife){const w=G.wife;mini(w.x-cam,up?w.y:w.y+17,w.f,w.og,w.vx,'hsl(330,70%,78%)',1,true,!up)}
  }
  function city(pl,ly){
    const cam=G.cam,fx=ly?.55:.3,cell=ly?118:92,i0=Math.floor(cam*fx/cell)-1,n=Math.ceil(LW/cell)+3;
    for(let i=i0;i<i0+n;i++){
      const r=k=>hh(i,k+ly*9),w=44+r(1)*48,h=(ly?70:90)+r(2)*(ly?65:90),x=i*cell+r(3)*16-cam*fx,hue=G.lv===7?(i*47+G.t*25)%360:pl.h;
      ctx.fillStyle=`hsl(${hue},${ly?32:24}%,${ly?38:62}%)`;ctx.fillRect(x,GY-h,w,h);
      ctx.fillStyle=`hsl(${hue},${ly?36:28}%,${ly?28:52}%)`;const st=Math.floor(r(4)*4);
      if(st===0){ctx.beginPath();ctx.moveTo(x-3,GY-h);ctx.lineTo(x+w/2,GY-h-16);ctx.lineTo(x+w+3,GY-h);ctx.fill()}
      else if(st===1)ctx.fillRect(x-2,GY-h-5,w+4,5);
      else if(st===2){ctx.fillRect(x+w*.3,GY-h-12,w*.4,12);ctx.fillRect(x+w*.45,GY-h-22,2,10)}
      const cols=Math.max(1,Math.floor((w-10)/14)),rows=Math.floor((h-22)/20);
      for(let a=0;a<cols;a++)for(let b=0;b<rows;b++){ctx.fillStyle=hh(i*31+a,b+ly*5)>.55?'rgba(255,238,170,.9)':'rgba(255,255,255,.16)';ctx.fillRect(x+6+a*14,GY-h+10+b*20,8,11)}
      if(ly&&r(5)>.72){ctx.fillStyle='#c0392b';ctx.fillRect(x+3,GY-34,w-6,13);ctx.font='bold 9px system-ui';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(SIGNS[Math.floor(r(6)*5)],x+w/2,GY-27)}
    }
  }
  // ----- the four settings. Each is a few parallax layers tinted by the level's colour. -----
  function bgCity(pl){
    const cam=G.cam;
    for(let L=0;L<2;L++){ctx.fillStyle=`hsla(${pl.h},45%,${L?50:62}%,.4)`;ctx.beginPath();ctx.moveTo(0,LH);
      for(let x=0;x<=LW;x+=16){const wx=x+cam*(.12+L*.1);ctx.lineTo(x,GY-60-L*26-(Math.sin(wx/(70+L*60))*22+Math.sin(wx/33)*6))}
      ctx.lineTo(LW,LH);ctx.fill()}
    city(pl,0);city(pl,1);
    for(let i=Math.floor(cam*.8/170)-1;i<cam*.8/170+6;i++)if(hh(i,77)>.45)em(['🌴','🌳','🎋'][Math.floor(hh(i,78)*3)],i*170+hh(i,79)*60-cam*.8,GY-16,40);
  }
  function bgCountry(pl){   // karst peaks, flooded paddies, farmhouses, buffalo, bamboo
    const cam=G.cam,h=pl.h;
    for(let i=Math.floor(cam*.1/120)-1;i<cam*.1/120+7;i++){const x=i*120-cam*.1+hh(i,1)*40,hg=70+hh(i,2)*80,w=70+hh(i,3)*50;
      ctx.fillStyle=`hsla(${h},28%,${60-hh(i,4)*10}%,.6)`;ctx.beginPath();ctx.moveTo(x-w/2,GY-30);ctx.quadraticCurveTo(x-w*.3,GY-30-hg,x,GY-30-hg);ctx.quadraticCurveTo(x+w*.3,GY-30-hg,x+w/2,GY-30);ctx.fill()}
    ctx.fillStyle=`hsla(${h},45%,52%,.5)`;ctx.beginPath();ctx.moveTo(0,GY);for(let x=0;x<=LW;x+=16){const wx=x+cam*.25;ctx.lineTo(x,GY-34-Math.sin(wx/80)*12-Math.sin(wx/31)*4)}ctx.lineTo(LW,GY);ctx.fill();
    ctx.fillStyle=`hsl(${h},52%,60%)`;ctx.fillRect(0,GY-28,LW,28);
    for(let k=0;k<5;k++){ctx.fillStyle=`hsla(${h},60%,${72-k*4}%,.75)`;ctx.fillRect(0,GY-26+k*5.5,LW,2)}
    for(let x=-((cam*.9)%22);x<LW;x+=22){ctx.fillStyle=`hsla(${h},55%,40%,.5)`;ctx.fillRect(x,GY-28,1.5,28)}
    const cell=230,i0=Math.floor(cam*.55/cell)-1;
    for(let i=i0;i<i0+Math.ceil(LW/cell)+3;i++){const x=i*cell+hh(i,5)*80-cam*.55,k=hh(i,6);
      if(k<.5){ctx.fillStyle=`hsl(${h},25%,50%)`;ctx.fillRect(x,GY-40,50,28);ctx.fillStyle=`hsl(${h},40%,34%)`;ctx.beginPath();ctx.moveTo(x-6,GY-40);ctx.lineTo(x+25,GY-62);ctx.lineTo(x+56,GY-40);ctx.fill();ctx.fillStyle='rgba(20,10,0,.5)';ctx.fillRect(x+20,GY-30,12,18)}
      else if(k<.75)em('🐃',x+20,GY-16,30);else em('🎋',x+10,GY-26,44);
      if(hh(i,7)>.5)em('🌾',x+90,GY-12,26)}
    for(let i=Math.floor(cam*.8/150)-1;i<cam*.8/150+6;i++)if(hh(i,77)>.4)em(['🌴','🌳','🍌'][Math.floor(hh(i,78)*3)],i*150+hh(i,79)*50-cam*.8,GY-16,40);
  }
  function bgSea(pl){   // sun, a wide sea with waves and sails, islands, lighthouses, beach palms
    const cam=G.cam,h=pl.h,t=G.t;
    ctx.fillStyle='rgba(255,244,190,.9)';ctx.beginPath();ctx.arc(520,62,26,0,7);ctx.fill();
    const g=ctx.createLinearGradient(0,GY-96,0,GY);g.addColorStop(0,`hsl(${h},65%,62%)`);g.addColorStop(1,`hsl(${h},70%,38%)`);ctx.fillStyle=g;ctx.fillRect(0,GY-96,LW,96);
    for(let i=Math.floor(cam*.08/300)-1;i<cam*.08/300+4;i++){const x=i*300+hh(i,1)*100-cam*.08;ctx.fillStyle=`hsla(${h},30%,42%,.65)`;ctx.beginPath();ctx.ellipse(x,GY-96,60+hh(i,2)*40,14+hh(i,3)*14,0,Math.PI,0);ctx.fill()}
    ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1.5;
    for(let k=0;k<5;k++){ctx.beginPath();for(let x=0;x<=LW;x+=8){const y=GY-88+k*16+Math.sin((x+cam*.4)/14+t*2+k)*2;if(x)ctx.lineTo(x,y);else ctx.moveTo(x,y)}ctx.stroke()}
    for(let i=0;i<4;i++)em('⛵',((i*260+t*10-cam*.2)%(LW+160)+LW+160)%(LW+160)-80,GY-70+(i%2)*28,26);
    for(let i=Math.floor(cam*.5/900)-1;i<cam*.5/900+3;i++){const x=i*900+300-cam*.5;   // lighthouses
      ctx.fillStyle='#f4f1ea';ctx.beginPath();ctx.moveTo(x-11,GY-6);ctx.lineTo(x-7,GY-96);ctx.lineTo(x+7,GY-96);ctx.lineTo(x+11,GY-6);ctx.fill();
      ctx.fillStyle='#d6453d';for(let k=0;k<3;k++)ctx.fillRect(x-10+k*.6,GY-30-k*26,20-k*1.2,9);
      ctx.fillStyle=`rgba(255,235,120,${.55+.35*Math.sin(t*3)})`;ctx.beginPath();ctx.arc(x,GY-102,7,0,7);ctx.fill()}
    for(let i=Math.floor(cam*.8/140)-1;i<cam*.8/140+6;i++)if(hh(i,77)>.35)em(['🌴','⛱️','🌴','🐚'][Math.floor(hh(i,78)*4)],i*140+hh(i,79)*50-cam*.8,GY-14,38);
  }
  function bgMount(pl){   // three ranges of snow-capped peaks, terraced rice steps, pines and huts
    const cam=G.cam,h=pl.h;
    for(let L=0;L<3;L++){const f=.08+L*.12,cell=150+L*20,base=GY-20-L*10,i0=Math.floor(cam*f/cell)-1;
      for(let i=i0;i<i0+Math.ceil(LW/cell)+3;i++){const x=i*cell+hh(i,L+1)*30-cam*f,hg=90+hh(i,L+4)*70-L*14,w=cell*1.15;
        ctx.fillStyle=`hsl(${h},${22+L*10}%,${76-L*12}%)`;ctx.beginPath();ctx.moveTo(x-w/2,base);ctx.lineTo(x,base-hg);ctx.lineTo(x+w/2,base);ctx.fill();
        if(L<2){ctx.fillStyle='rgba(255,255,255,.88)';ctx.beginPath();ctx.moveTo(x-w*.12,base-hg*.78);ctx.lineTo(x,base-hg);ctx.lineTo(x+w*.12,base-hg*.78);ctx.lineTo(x+w*.04,base-hg*.72);ctx.lineTo(x-w*.03,base-hg*.8);ctx.fill()}}}
    for(let k=0;k<4;k++){ctx.fillStyle=`hsl(${h},${48-k*4}%,${50+k*5}%)`;ctx.beginPath();ctx.moveTo(0,GY);
      for(let x=0;x<=LW;x+=14){const wx=x+cam*(.3+k*.08);ctx.lineTo(x,GY-14-k*11-Math.sin(wx/60+k)*5)}
      ctx.lineTo(LW,GY);ctx.fill();ctx.strokeStyle=`hsla(${h},30%,30%,.25)`;ctx.stroke()}
    for(let i=Math.floor(cam*.7/150)-1;i<cam*.7/150+6;i++){const k=hh(i,77);if(k>.3)em(k>.85?'🏯':k>.7?'🛖':'🌲',i*150+hh(i,79)*50-cam*.7,GY-14,k>.85?44:36)}
  }
  function drawSky(pl){
    const g=ctx.createLinearGradient(0,0,0,LH),cam=G.cam;
    if(G.lv===7)for(let i=0;i<8;i++)g.addColorStop(i/7,`hsl(${(i*45+G.t*30)%360},85%,72%)`);else{g.addColorStop(0,pl.top);g.addColorStop(1,pl.bot)}
    ctx.fillStyle=g;ctx.fillRect(0,0,LW,LH);
    for(let i=0;i<4;i++)em(G.lv===7?'🌈':'☁️',((i*230-cam*.2+G.t*6)%920+920)%920-140,40+(i%2)*40,i%2?36:48);
    [bgCity,bgCountry,bgSea,bgMount][SETS[G.set].bg](pl);
  }
  function groundTex(pl,cam){
    const k=SETS[G.set].bg;
    for(const s of W.segs){const a=Math.max(s.x0,cam-10),b=Math.min(s.x1,cam+LW+10);
      for(let x=Math.ceil(a/16)*16;x<b;x+=16){const v=hh(x,3);
        if(v>.5){ctx.fillStyle=k===2?'rgba(255,255,255,.4)':pl.gt2;ctx.fillRect(x-cam,GY-3,2,5)}
        if(k===2&&v<.1)em('🐚',x-cam+4,GY+9,10);
        if(k===3&&v>.86){ctx.fillStyle='rgba(0,0,0,.22)';ctx.beginPath();ctx.arc(x-cam,GY+20,5,0,7);ctx.fill()}
        ctx.fillStyle='rgba(0,0,0,.14)';ctx.fillRect(x-cam+v*10,GY+16+hh(x,4)*48,3,2)}}
  }
  const pickup=(k,cam)=>{const x=k.x-cam;if(x<-40||x>LW+40)return;
    if(k.h){em('❤️',x,k.y+Math.sin(G.t*4+k.x)*3,22);return}
    const y=k.y+Math.sin(G.t*3+k.x)*3,up=G.sc==='up';
    if(k.pick&&up){   // a word you choose: a little stand, a dark plate behind the letters
      if(k.y>=GY-30){ctx.fillStyle='#8f8b80';ctx.fillRect(x-17,GY-12,34,12);ctx.fillStyle='#b3aea1';ctx.fillRect(x-17,GY-12,34,4)}
      ctx.font='bold 17px system-ui,sans-serif';const w=ctx.measureText(WD[k.i][1]).width+14;
      ctx.fillStyle='rgba(18,19,26,.55)';ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x-w/2,y-13,w,26,8);else ctx.rect(x-w/2,y-13,w,26);ctx.fill()}
    ctx.save();ctx.shadowColor='rgba(255,236,120,.95)';ctx.shadowBlur=10;txt(WD[k.i][1],x,y,17);ctx.restore();   // words glow gold…
    if(k.pick&&up&&HINT[G.set].tag)em(WD[k.i][3],x,k.y>=GY-30?GY-5:y+23,14);   // the picture, engraved under the word
    if(G.near===k&&up)txt('▼',x,y-26+Math.sin(G.t*8)*3,17,'center','#ffd23f')};
  function drawGate(g,cam){const x=g.x0-cam;if(x<-90||x>LW+60)return;
    const h=HINT[G.set].sign;
    if(g.kind==='chasm'){ctx.save();ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=2;ctx.setLineDash([6,8]);ctx.beginPath();ctx.moveTo(x,GY-4);ctx.lineTo(g.x1-cam,GY-4);ctx.stroke();ctx.restore()}   // the span that is missing
    ctx.fillStyle='#6b4a2b';ctx.fillRect(x-34,GY-52,4,52);
    ctx.fillStyle='#f4ead0';ctx.strokeStyle='#6b4a2b';ctx.lineWidth=3;ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x-64,GY-98,60,48,8);else ctx.rect(x-64,GY-98,60,48);ctx.fill();ctx.stroke();
    if(h)em(WD[g.key][3],x-34,GY-74,28);else txt('❓',x-34,GY-74,28);   // the key word's picture: you still have to know which of the two words it is
    if(g.taken&&!g.done&&g.armed)txt('↺',g.px-cam,GY-62+Math.sin(G.t*6)*3,22,'center','#ffd23f')}   // walk back to choose again
  function drawWall(wl,cam){if(wl.dead)return;const x=wl.x-cam;if(x<-60||x>LW+40)return;const t=0,hh=GY-t;
    if(wl.kind==='wood'){ctx.fillStyle='#7a4a22';ctx.fillRect(x,t,wl.w,hh);
      for(let u=0;u<wl.w;u+=11){ctx.fillStyle=u%22?'#a8763e':'#946236';ctx.fillRect(x+u,t,9,hh)}
      ctx.fillStyle='#4a2f16';for(let yy=t+26;yy<GY;yy+=64)ctx.fillRect(x-3,yy,wl.w+6,6);
      ctx.fillStyle='#5b8a3a';for(let yy=t+10;yy<GY;yy+=48)ctx.fillRect(x+((yy/48|0)%2?4:wl.w-9),yy,5,26)}   // planks, iron bands, dry vines
    else{ctx.fillStyle='#74777e';ctx.fillRect(x,t,wl.w,hh);
      for(let yy=t,r=0;yy<GY;yy+=22,r++)for(let u=(r%2)*9-9;u<wl.w;u+=18){ctx.fillStyle=(u+r)%3?'#9a9da5':'#8b8e96';ctx.fillRect(Math.max(x,x+u),yy+1,Math.min(16,x+wl.w-Math.max(x,x+u)),Math.max(0,Math.min(20,GY-yy-1)))}
      ctx.strokeStyle='#33363d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+wl.w*.2,GY-150);ctx.lineTo(x+wl.w*.6,GY-118);ctx.lineTo(x+wl.w*.35,GY-92);ctx.lineTo(x+wl.w*.8,GY-60);ctx.stroke()}}   // bricks and a crack
  function drawFoe(e,x){   // …enemies glow red, so they never blend into the background
    const pu=.5+.5*Math.sin(G.t*5+e.x*.1);
    ctx.save();ctx.fillStyle=`rgba(255,40,40,${.18+.12*pu})`;ctx.beginPath();ctx.arc(x,e.y,e.s*.72,0,7);ctx.fill();
    ctx.shadowColor='rgba(255,50,50,.95)';ctx.shadowBlur=12+6*pu;em(e.e,x,e.y,e.s,e.vx>0);
    ctx.shadowBlur=3;ctx.shadowColor='#fff';em(e.e,x,e.y,e.s,e.vx>0);ctx.restore();
    if(e.stun>0)em('💫',x,e.y-14,12)}
  function drawUp(){
    const pl=pal(),cam=G.cam;drawSky(pl);
    ctx.fillStyle='rgba(5,15,50,.9)';ctx.fillRect(0,GY,LW,LH-GY);   // a hole: dark water below
    ctx.strokeStyle='rgba(255,255,255,.25)';for(let i=0;i<9;i++){const bx=((i*83-cam*.9)%LW+LW)%LW,by=LH-((G.t*18+i*41)%(LH-GY));ctx.beginPath();ctx.arc(bx,by,3,0,7);ctx.stroke()}
    for(const s of W.segs){const a=s.x0-cam,b=s.x1-cam;if(b<-10||a>LW+10)continue;ctx.fillStyle=pl.gt;ctx.fillRect(a,GY,b-a,10);ctx.fillStyle=pl.gb;ctx.fillRect(a,GY+10,b-a,LH-GY)}
    groundTex(pl,cam);
    for(const q of W.plats){const a=q.x-cam;if(a<-Math.max(150,q.w)||a>LW+10)continue;
      if(q.deck){ctx.fillStyle='#a8763e';ctx.fillRect(a,q.y,q.w,9);ctx.fillStyle='#7a5430';for(let u=a+6;u<a+q.w-4;u+=14)ctx.fillRect(u,q.y,2,9);ctx.fillStyle='#6b4a2b';for(let u=a+2;u<a+q.w;u+=70)ctx.fillRect(u,q.y-14,3,14);ctx.fillRect(a,q.y-14,q.w,2);continue}
      if(q.br){ctx.fillStyle='#a8763e';ctx.fillRect(a,q.y,q.w,8);ctx.fillStyle='#6b4a2b';ctx.fillRect(a,q.y-12,3,12);ctx.fillRect(a+q.w-3,q.y-12,3,12)}
      else{ctx.fillStyle=pl.pl;ctx.fillRect(a,q.y,q.w,12);ctx.fillStyle=pl.gt;ctx.fillRect(a,q.y,q.w,5)}}
    em('🏁',W.flag-cam,GY-22,44);
    for(const wl of W.walls)drawWall(wl,cam);
    for(const g of W.gates)drawGate(g,cam);
    for(const k of W.pk)if(!k.got)pickup(k,cam);
    for(const e of W.en){if(e.dead)continue;const x=e.x-cam;if(x<-40||x>LW+40)continue;drawFoe(e,x)}
    crew();hero(P.x-cam,P.y,false);
  }
  function drawWater(){
    const pl=pal(),cam=G.cam,g=ctx.createLinearGradient(0,0,0,LH),D=SETS[G.set].deco;
    g.addColorStop(0,`hsl(${pl.h},60%,48%)`);g.addColorStop(1,`hsl(${pl.h},65%,14%)`);ctx.fillStyle=g;ctx.fillRect(0,0,LW,LH);
    ctx.fillStyle='rgba(255,255,255,.12)';ctx.fillRect(0,0,LW,22);
    for(let i=0;i<3;i++){const x0=((i*230+G.t*8-cam*.15)%(LW+200)+LW+200)%(LW+200)-100;ctx.fillStyle='rgba(255,255,255,.05)';ctx.beginPath();ctx.moveTo(x0,0);ctx.lineTo(x0+60,0);ctx.lineTo(x0+10,LH);ctx.lineTo(x0-90,LH);ctx.fill()}
    ctx.globalAlpha=.3;for(let i=0;i<4;i++)em('🐠',((i*190+G.t*14-cam*.3)%(LW+120)+LW+120)%(LW+120)-60,90+i*55,22,true);
    for(let i=Math.floor(cam*.4/150)-1;i<cam*.4/150+6;i++)em(D[0],i*150-cam*.4,LH-30,44);ctx.globalAlpha=1;
    for(let i=0;i<26;i++){const bx=((i*97-cam*.5)%LW+LW)%LW,by=LH-((G.t*22+i*47)%LH);ctx.strokeStyle='rgba(255,255,255,.3)';ctx.beginPath();ctx.arc(bx,by,2+i%3,0,7);ctx.stroke()}
    ctx.fillStyle='rgba(235,215,160,.35)';ctx.fillRect(0,LH-12,LW,12);
    for(let i=Math.floor(cam/110);i<cam/110+7;i++)em(D[i%3],i*110-cam,LH-14,28);
    const ex=WAT.len-cam,lg=ctx.createLinearGradient(ex-70,0,ex,0);lg.addColorStop(0,'rgba(255,255,255,0)');lg.addColorStop(1,'rgba(255,255,255,.55)');ctx.fillStyle=lg;ctx.fillRect(ex-70,0,90,LH);
    for(const k of WAT.pk)if(!k.got)pickup(k,cam);
    for(const e of WAT.en){if(e.dead)continue;const x=e.x-cam;if(x<-40||x>LW+40)continue;drawFoe(e,x)}
    crew();hero(P.x-cam,P.y+17*mul('z'),true);
  }
  function drawFx(){
    const cam=G.cam,up=G.sc==='up',sz=mul('z'),hy=up?P.y-20*sz:P.y,L=P.lock;
    for(const s of shots)em(s.e,s.x-cam,s.y,18);
    for(const s of parts){ctx.globalAlpha=1-s.t/s.l;ctx.fillStyle=s.c;ctx.beginPath();ctx.arc(s.x-cam,s.y,2.5,0,7);ctx.fill()}ctx.globalAlpha=1;
    if(P.beam>0){ctx.strokeStyle='rgba(255,50,50,.9)';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(P.x-cam+P.f*10,hy-10);ctx.lineTo(P.x-cam+P.f*330,hy-10);ctx.stroke()}
    if(P.sw>0){const A=ATK[any('at')];if(A&&A.m)em(P.swe,P.x-cam+P.f*A.m*.6,hy,26)}
    if(any('tent')){ctx.strokeStyle='#c04fa0';ctx.lineWidth=3;for(let i=0;i<8;i++){const a=G.t*3+i*.785;ctx.beginPath();ctx.moveTo(P.x-cam,hy);ctx.lineTo(P.x-cam+Math.cos(a)*40*sz,hy+Math.sin(a)*40*sz);ctx.stroke()}}
    if(P.head){const h=P.head;ctx.fillStyle='hsl(200,60%,68%)';ctx.strokeStyle='#223';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(h.x-cam,h.y,10,0,7);ctx.fill();ctx.stroke();
      ctx.fillStyle='#223';ctx.beginPath();ctx.arc(h.x-cam-3,h.y-2,1.8,0,7);ctx.arc(h.x-cam+3,h.y-2,1.8,0,7);ctx.fill();em('⬇️',h.x-cam,h.y-24+Math.sin(G.t*8)*3,14)}
    for(let i=pops.length-1;i>=0;i--){const q=pops[i],a=G.t-q.t;if(a>1.5){pops.splice(i,1);continue}ctx.globalAlpha=1-a*a/2.25;em(q.s,q.x-cam,q.y-a*16,q.sz);ctx.globalAlpha=1}
    if(L&&L.lk==='t'){const x=-300+L.t/L.d*(LW+520);for(let i=0;i<4;i++)em(i?'🚃':'🚂',x-i*52,GY-18,46,true)}
    if(L&&L.lk==='n')txt(COUNT[Math.min(8,Math.floor(L.t/.6))],P.x-cam,up?P.y-70:P.y-50,34);
  }
  function drawDark(){   // tối: the whole screen goes dark, you can only see eyes
    if(!any('dark'))return;
    ctx.fillStyle='rgba(0,0,0,.96)';ctx.fillRect(0,0,LW,LH);
    const eye=(x,y,r)=>{ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x-r,y,r,0,7);ctx.arc(x+r,y,r,0,7);ctx.fill();ctx.fillStyle='#000';ctx.beginPath();ctx.arc(x-r+1,y,r*.5,0,7);ctx.arc(x+r+1,y,r*.5,0,7);ctx.fill()};
    for(const e of foes())if(!e.dead)eye(e.x-G.cam,e.y-2,2.5);
    eye(P.x-G.cam+P.f*3,G.sc==='up'?P.y-33*mul('z'):P.y-3,3.5);
  }
  function drawHud(){
    for(let i=0;i<3;i++)em(i<P.hp?'❤️':'🖤',20+i*26,20,20);
    em('🧒',20,46,16);txt('×'+G.lives,34,46,14,'left');
    txt(SETS[G.set].n+'  '+(G.lv+1)+' / '+LEVELS,LW/2,11,12);
    let y=20;for(const k in P.fx){txt(WD[IDX[k]][1]+' '+Math.ceil(P.fx[k]),LW-10,y,15,'right');y+=19}
    if(P.sayT>0&&G.intro<=0)bubble(P.say,P.x-G.cam,(G.sc==='up'?P.y-52*mul('z'):P.y-30)-4);
  }
  const pairLines=(fn)=>G.lp[G.lv].map(p=>[WD[p*2],WD[p*2+1]].filter(Boolean).map(fn).join('   ·   '));
  function drawIntro(){
    const a=G.intro>.5?1:G.intro/.5,hn=HINT[G.set].intro;
    ctx.globalAlpha=a;ctx.fillStyle='rgba(0,0,0,.34)';ctx.fillRect(0,0,LW,LH);
    txt(LV[G.lv][0],LW/2,LH/2-58,G.lv===7?60:76);
    txt(SETS[G.set].n+' · '+(G.lv+1)+' / '+LEVELS,LW/2,LH/2-10,18);
    if(hn)pairLines(x=>x[1]+(hn===2?'  '+x[3]:'')).forEach((s,i)=>txt(s,LW/2,LH/2+26+i*26,19));   // this level's two pairs (set 1: with pictures, set 2: words only, sets 3-4: nothing)
    if(G.retry===2)txt('hết mạng — về đầu bộ',LW/2,LH-40,20);
    else if(G.retry===1)txt('thử lại',LW/2,LH-40,20);
    else if(G.set===0&&G.lv<2)txt('◀ ▶ đi   ▲ nhảy (hai lần!)   ⚡ / X hành động   ▼ chọn từ · bơi xuống',LW/2,LH-30,13);
    if(G.retry!==2&&W&&W.gates.length&&HINT[G.set].sign)txt({chasm:'↔  có vực — chọn đúng từ để qua',wood:'🚧  rào gỗ chắn đường — chọn đúng từ',stone:'🧱  tường đá chắn đường — chọn đúng từ'}[W.gates[0].kind],LW/2,LH-62,14);
    ctx.globalAlpha=1}
  function drawClear(){   // recap card: what the level's words meant
    ctx.fillStyle='rgba(0,0,0,.34)';ctx.fillRect(0,0,LW,LH);
    txt('xong!',LW/2,84,64);
    pairLines(x=>x[1]+' '+x[3]).forEach((s,i)=>txt(s,LW/2,148+i*30,22));
    txt('+1 🧒',LW/2,236,18)}
  const EXAMPLES=['lớn 💪   ·   lợn 🐷','ngựa 🐴   ·   ngứa 🐜','mua 🛒   ·   múa 💃','cười 😂   ·   cưới 💍','vợ 👰   ·   vỡ 💔'];
  function drawTitle(){
    const end=G.mode==='end',sv=[G.set,G.lv,G.cam];
    G.set=Math.floor(G.t/4)%SETS.length;G.lv=end?7:Math.floor(G.t/4)%LEVELS;G.cam=G.t*50;   // the backdrop tours every setting and colour
    const pl=pal();drawSky(pl);ctx.fillStyle=pl.gt;ctx.fillRect(0,GY,LW,10);ctx.fillStyle=pl.gb;ctx.fillRect(0,GY+10,LW,LH-GY);
    G.set=sv[0];G.lv=sv[1];G.cam=sv[2];
    ctx.fillStyle='rgba(0,0,0,.3)';ctx.fillRect(0,0,LW,LH);
    if(end)for(let i=0;i<34;i++)em(['🎉','🌈','⭐','🎊'][i%4],(i*61+Math.sin(G.t+i)*20)%LW,((G.t*60+i*53)%(LH+40))-20,26);
    txt('Từ Trái Nghĩa',LW/2,end?70:96,end?44:62);
    if(end){txt('hết',LW/2,150,64);txt('qua hết '+SETS.length+' bộ',LW/2,206,18)}
    else txt(EXAMPLES[Math.floor(G.t/3)%EXAMPLES.length],LW/2,160,19);
    const prompt=G.mode==='watch'?'👁 đang xem — chỉ người ngồi bàn mới chơi được':end?'chạm hoặc nhấn phím bất kỳ để chơi lại':'chạm hoặc nhấn phím bất kỳ để chơi';
    ctx.globalAlpha=.65+.35*Math.sin(G.t*4);txt(prompt,LW/2,LH-60,18);ctx.globalAlpha=1;
    if(!end&&G.mode!=='watch')txt('◀ ▶ đi   ▲ nhảy (hai lần!)   ⚡ / X hành động   ▼ chọn từ',LW/2,LH-30,13);
  }
  function draw(){
    ctx.setTransform(S*DPR,0,0,S*DPR,0,0);
    if(G.shake>0)ctx.translate((Math.random()-.5)*G.shake*14,(Math.random()-.5)*G.shake*14);
    if(!P||!W||G.mode==='title'||G.mode==='end'||G.mode==='watch'||(G.mode==='wait'&&G.seq<0)){drawTitle();return}
    if(G.sc==='water'&&WAT)drawWater();else drawUp();
    drawFx();drawDark();drawHud();
    if(G.mode==='clear')drawClear();
    else if(G.intro>0&&(G.mode==='up'||G.mode==='water'))drawIntro();
    else if(G.mode==='wait')txt('…',LW/2,LH/2,40);
  }
  // ===== input =====
  const KM={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',Space:'jump',KeyZ:'jump',KeyX:'act',KeyJ:'act',ShiftLeft:'act',ShiftRight:'act',Enter:'act'};
  const idle=()=>G.mode==='title'||G.mode==='end';
  wrap.addEventListener('keydown',e=>{if(e.code==='Escape')return;const k=KM[e.code];if(!k)return;e.preventDefault();unlock();K[k]=1;if(idle())startRun()});   // Esc is the hub's: never touched
  wrap.addEventListener('keyup',e=>{const k=KM[e.code];if(k){K[k]=0;e.preventDefault()}});
  wrap.addEventListener('blur',()=>{for(const k in K)K[k]=0});
  cv.addEventListener('pointerdown',()=>{try{wrap.focus({preventScroll:true})}catch(e){}unlock();if(idle())startRun()});
  bar.querySelectorAll('button[data-k]').forEach(b=>{const k=b.dataset.k,on=e=>{K[k]=1;e.preventDefault();unlock();if(idle())startRun()},off=e=>{K[k]=0;e.preventDefault()};
    b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointercancel',off);b.addEventListener('pointerleave',off)});
  // ===== loop: one rAF chain, guarded by `running`. Intents are flushed at the very end of a frame, after the next frame is already scheduled. =====
  let running=false,last=0;
  function flushOut(){if(G.out){const o=G.out;G.out=null;api.send(o)}}
  function frame(now){
    if(dead)return;
    now=typeof now==='number'?now:performance.now();
    const dt=Math.min(1/30,Math.max(0,(now-last)/1000));last=now;
    fit();tick(dt);draw();
    if(P&&(G.mode==='up'||G.mode==='water')){const a=any('at'),ae=a?ATK[a].e:'⚡';if(ae!==lastAE){ab.textContent=ae;lastAE=ae}}
    api.raf(frame);
    flushOut();
  }
  function ensureLoop(){if(running)return;running=true;last=performance.now();api.raf(frame)}
  function update(view){
    if(dead||!view)return;
    G.spec=!!api.isSpectator;
    ensureLoop();
    if(!view.run){if(G.spec)G.mode='watch';else if(!G.joined){G.joined=1;queue({a:'join'})}return}
    applyRun(view.run);
  }
  function destroy(){dead=true;try{if(cur){cur.pause();cur=null}}catch(e){}try{if(AC)AC.close()}catch(e){}}
  api.setTimeout(()=>{try{wrap.focus({preventScroll:true})}catch(e){}},80);
  if(api.__tt)api.__tt({G,get P(){return P},get W(){return W},get WAT(){return WAT},take,tick,draw,build,buildWater,floorAt,WD,SETS,pairsOf,IDX,PC,K,ONE,any,has,HINT,CAPS,KINDS,KEYPAIRS,GATE_LV,GAP_MAX,WALL_TOP,WALL_W,gateProblems,breakWall,forkStep,gateStep,reoffer});   // test hook, only present in the test harness
  return{update,destroy};
  }
