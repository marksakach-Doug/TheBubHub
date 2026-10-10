// BubHub Record — modular shared history.
// Loaded via plain <script> so file:// double-click works.
// Usage in hub:
//   const Rec = window.BubRecord.create({ getName, rosterList, gameTitle, isHost:()=>isHost, sendAll });
// Games never touch this file: they just post {t:'gu',game,k:'result',p}
// over the bridge. Generic usage ("played X") is recorded on open/close
// so even a brand-new .html game with no result logic leaves a line.
window.BubRecord = (function(){
  var BUB_API = 'https://script.google.com/macros/s/AKfycbwhy40Gk_QPoVz-jEwe-I72_rqbudw_QeLxZcGz7e2BMH3kIYS0AWkBiRulJl-CfU5jyA/exec';
  var REC_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function recTodayISO(){
    var d = new Date(), p2 = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate());
  }
  function recFmtDate(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return (parseInt(m[3],10)) + ' ' + (REC_MONTHS[parseInt(m[2],10)-1] || '?') + ' ' + m[1];
  }
  function recJoinNames(names){
    var n = (names || []).filter(Boolean);
    if (!n.length) return 'someone';
    if (n.length === 1) return n[0];
    if (n.length === 2) return n[0] + ' and ' + n[1];
    return n.slice(0,-1).join(', ') + ' and ' + n[n.length-1];
  }
  function create(deps){
    deps = deps || {};
    var getName = deps.getName || function(){ return 'Player'; };
    var rosterList = deps.rosterList || function(){ return []; };
    var gameTitle = deps.gameTitle || function(g){ return g; };
    var isHostFn = deps.isHost || function(){ return true; };
    var sendAll = deps.sendAll || function(){};
    var R = {
      entries: [],
      expanded: false,
      seenInst: {},
      lastKeys: {},
      names: {},
      openSessions: {}, // game -> { t0, hadResult }
      gold: { touched: {}, reported: false },
      norm: function(e){
        return {
          date: String((e && e.date) || '').slice(0,10),
          game: String((e && e.game) || ''),
          text: String((e && e.text) || '').trim().replace(/\s+/g,' ')
        };
      },
      keyOf: function(e){ var n = this.norm(e); return n.date + '|' + n.game + '|' + n.text; },
      remember: function(id,name){ if (id && name) this.names[id] = String(name); },
      nameOf: function(id){
        try { this.remember('__me', getName()); } catch(e){}
        var self = this;
        try { rosterList().forEach(function(m){ self.remember(m.id, m.name); }); } catch(e){}
        return this.names[id] || this.names['__me'] || 'Someone';
      },
      idsToNames: function(ids){
        var out = [], self = this;
        (ids || []).forEach(function(id){ var n = self.nameOf(id); if (out.indexOf(n) < 0) out.push(n); });
        return out;
      },
      touch: function(id,name){ this.remember(id,name); if (id) this.gold.touched[id] = true; },
      goldReset: function(){ this.gold = { touched: {}, reported: false }; },
      flushGoldberg: function(){
        // Goldberg is its own engine and never posts a `result`, so the hub
        // tracks who touched it instead. A solo-origin table has no hub host,
        // so requiring isHostFn() here would silently drop every solo game —
        // gate on "someone actually played" rather than on hub host.
        var ids = Object.keys(this.gold.touched);
        if (!ids.length) return;
        if (this.gold.reported) return;
        this.gold.reported = true;
        this.record('goldberg', null, { players: ids });
      },
      sentence: function(game, p){
        p = p || {};
        var title = gameTitle(game);
        var names = this.idsToNames(p.players);
        if (!names.length) {
          try {
            var rl = rosterList().map(function(m){ return m.name; }).filter(Boolean);
            if (rl.length) names = rl;
          } catch(e){}
        }
        if (!names.length) names = [getName()];
        if (game === 'lotr'){
          var w = p.win ? this.nameOf(p.win) : names[0];
          var rest = names.filter(function(n){ return n !== w; });
          return (w || 'Someone') + (rest.length ? ' beat ' + recJoinNames(rest) : ' played') + ' at ' + title;
        }
        if (game === 'chess'){
          // players are [whiteId, blackId?]; `bot` says black wasn't a person.
          // `won` is which colour won ('w'/'b'/'draw') so we never have to
          // guess an id, and the bot never needs a fake roster entry.
          var white = names[0] || 'Someone';
          var black = p.bot ? 'the bot' : (names[1] || 'an opponent');
          if (p.won === 'w') return white + ' beat ' + black + ' at ' + title;
          if (p.won === 'b') return black + ' beat ' + white + ' at ' + title;
          return white + ' drew with ' + black + ' at ' + title;
        }
        if (game === 'warp'){
          if (p.win) return recJoinNames(names) + ' beat the Borg ' + p.ps + '–' + p.bs + ' at ' + title;
          return recJoinNames(names) + ' lost to the Borg ' + p.bs + '–' + p.ps + ' at ' + title;
        }
        if (game === 'blastoff'){
          // `win` is the winning pilot's id, `score` the red cards they took.
          var w = p.win ? this.nameOf(p.win) : names[0];
          var n = (p.score === undefined || p.score === null) ? null : p.score;
          return w + ' won Blast Off' + (n !== null ? ' with ' + n + ' red card' + (n === 1 ? '' : 's') : '');
        }
        if (game === 'goldberg') return recJoinNames(names) + ' played ' + title;
        if (game === 'grammar') return recJoinNames(names) + ' lost at ' + title;
        if (game === 'wordbridge' || game === 'word-bridge'){
          // Round-based: the line records how far the table got.
          if (p.rounds) return recJoinNames(names) + ' played ' + p.rounds + ' rounds at ' + title;
          return recJoinNames(names) + ' played ' + title;
        }
        if (game === 'daltadka' || game === 'dal-tadka'){
          if (p.dish && p.score !== undefined && p.score !== null)
            return getName() + ' cooked ' + p.dish + ' scoring ' + p.score + ' at ' + title;
          return getName() + ' played ' + title;
        }
        if (game === 'waltz') return getName() + ' scored ' + (p.score || 0) + ' at ' + title;
        if (game === 'DrawDrive' || game === 'drawdrive')
          return p.text || (recJoinNames(names) + ' raced at Draw and Drive');
        if (game === 'eggs' || game === 'eggdrop' || game === 'EggDrop')
          return p.text || (recJoinNames(names) + ' splatted around at eggs');
        if (p && p.text) return p.text;
        return recJoinNames(names) + ' played ' + title;
      },
      fromGame: function(game, p){
        // Solo games record locally; multiplayer games record on host only.
        // Unknown/new games: always record generically so usage leaves a line.
        var solo = false;
        try {
          var g = (deps.games && deps.games()) || window.BUB_GAMES || [];
          var f = null;
          for (var i=0;i<g.length;i++) if (g[i].id === game) f = g[i];
          solo = !!(f && f.solo);
        } catch(e){}
        if (!solo && !isHostFn()) return;
        this.record(game, p && p.inst, p);
      },
      // ---- generic usage: at least a line that the game was even used ----
      noteOpened: function(game){
        if (!this.openSessions[game]) this.openSessions[game] = { t0: Date.now(), hadResult: false };
      },
      noteResult: function(game){ if (this.openSessions[game]) this.openSessions[game].hadResult = true; },
      flushUsage: function(game){
        var s = this.openSessions[game];
        delete this.openSessions[game];
        if (!s || s.hadResult) return;
        // Only record usage if the game was actually open >2s (avoid hover-opens).
        if (Date.now() - s.t0 < 2000) return;
        var solo = false;
        try {
          var g = (deps.games && deps.games()) || window.BUB_GAMES || [];
          for (var i=0;i<g.length;i++) if (g[i].id === game && g[i].solo) solo = true;
        } catch(e){}
        if (!solo && !isHostFn()) return; // multiplayer usage recorded by host
        var ids = [];
        try { ids = rosterList().map(function(m){ return m.id; }); } catch(e){}
        this.record(game, null, { players: ids, text: this.sentence(game, { players: ids }) });
      },
      record: function(game, inst, p){
        if (inst !== undefined && inst !== null){
          if (this.seenInst[game] === inst) return;
          this.seenInst[game] = inst;
        }
        if (this.openSessions[game]) this.openSessions[game].hadResult = true;
        var entry = this.norm({ date: recTodayISO(), game: game, text: this.sentence(game, p || {}) });
        var key = this.keyOf(entry), now = Date.now();
        if (this.lastKeys[key] && now - this.lastKeys[key] < 30000) return;
        this.lastKeys[key] = now;
        this.addLocal(entry);
        if (isHostFn()) { try { sendAll({ type: 'game', game: game, k: 'result', p: { entry: entry } }); } catch(e){} }
        this.write(entry);
      },
      addLocal: function(entry){
        if (!entry || !entry.text) return;
        var e = this.norm(entry), key = this.keyOf(e), self = this;
        if (this.entries.some(function(x){ return self.keyOf(x) === key; })) return;
        this.entries.unshift(e);
        this.render();
      },
      write: function(entry){
        var self = this;
        this.status('Saving…');
        try {
          var q = 'kind=bub&game=' + encodeURIComponent(entry.game) + '&text=' + encodeURIComponent(entry.text) + '&date=' + encodeURIComponent(entry.date);
          fetch(BUB_API + '?' + q, { cache: 'no-store', keepalive: true }).then(function(r){ return r.json(); }).then(function(j){
            if (j && j.entries) self.ingest(j.entries);
            self.status('');
          }).catch(function(){ self.status('Could not save — check connection; the line above is kept for now.'); });
        } catch(e){ this.status('Could not save — check connection; the line above is kept for now.'); }
      },
      load: function(){
        var self = this;
        this.status('Loading…');
        try {
          fetch(BUB_API, { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(j){
            self.ingest((j && j.entries) || []);
            self.status('');
          }).catch(function(){ self.status('Record unavailable offline.'); });
        } catch(e){ this.status('Record unavailable offline.'); }
        this.render();
      },
      ingest: function(all){
        var have = {}, self = this;
        this.entries.forEach(function(e){ have[self.keyOf(e)] = 1; });
        (all || []).filter(function(r){ return String((r && r.kind) || '') === 'bub' && r.text; }).forEach(function(r){
          var e = self.norm(r), key = self.keyOf(e);
          if (!have[key]){ have[key] = 1; self.entries.push(e); }
        });
        this.entries.sort(function(a,b){ return (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)); });
        this.render();
      },
      status: function(msg){
        ['record-status-lobby','record-status-room'].forEach(function(id){
          var el = document.getElementById(id);
          if (el) el.textContent = msg || '';
        });
      },
      render: function(){
        var self = this;
        [['record-list-lobby','record-more-lobby'],['record-list-room','record-more-room']].forEach(function(pair){
          var ul = document.getElementById(pair[0]);
          if (!ul) return;
          ul.innerHTML = '';
          if (!self.entries.length){
            var li = document.createElement('li');
            li.className = 'text-slate-500 text-xs italic';
            li.textContent = 'No games recorded yet — play something!';
            ul.appendChild(li);
          }
          (self.expanded ? self.entries : self.entries.slice(0,5)).forEach(function(e){
            var li2 = document.createElement('li');
            li2.className = 'text-slate-200 text-xs leading-relaxed';
            var b = document.createElement('span');
            b.className = 'text-slate-500 font-mono mr-1';
            b.textContent = recFmtDate(e.date);
            li2.appendChild(b);
            li2.appendChild(document.createTextNode(e.text));
            ul.appendChild(li2);
          });
          var more = document.getElementById(pair[1]);
          if (more){
            more.classList.toggle('hidden', self.entries.length <= 5);
            more.textContent = self.expanded ? 'Show less' : ('Show all (' + self.entries.length + ')');
          }
        });
      }
    };
    return R;
  }
  return { create: create, todayISO: recTodayISO, fmtDate: recFmtDate };
})();
