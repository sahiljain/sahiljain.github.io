(function () {
  'use strict';

  var M = window.LaborModel;
  var form = document.getElementById('form');
  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'labor-calc-v1';
  var DAY = 86400000;

  // ---------- dates ----------
  function parseDate(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return isNaN(d) ? null : d;
  }
  function toISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function diffDays(a, b) {
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
  }
  function fmtDate(d, long) {
    return d.toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
  }
  function fmtGA(ga) { return Math.floor(ga / 7) + 'w ' + (ga % 7) + 'd'; }
  function fmtP(p) {
    if (p <= 0) return '0%';
    if (p < 0.001) return '<0.1%';
    if (p < 0.1) return (p * 100).toFixed(1) + '%';
    if (p > 0.995 && p < 1) return '>99%';
    return Math.round(p * 100) + '%';
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- form ----------
  function readForm() {
    var fd = new FormData(form);
    var o = {};
    ['dueDate', 'dating', 'cycle', 'plurality', 'asOf', 'first', 'prevType', 'prevWeeks', 'prevDays', 'age', 'bmi', 'ancestry', 'dilation', 'effacement', 'inductionDate']
      .forEach(function (k) { o[k] = (fd.get(k) || '').toString().trim(); });
    ['prevPreterm', 'show', 'sweep', 'dropped'].forEach(function (k) { o[k] = fd.get(k) === 'on'; });
    return o;
  }

  function writeForm(o) {
    Object.keys(o).forEach(function (k) {
      var els = form.elements[k];
      if (!els) return;
      if (els instanceof RadioNodeList) {
        Array.prototype.forEach.call(els, function (el) { el.checked = el.value === o[k]; });
      } else if (els.type === 'checkbox') {
        els.checked = !!o[k];
      } else {
        els.value = o[k];
      }
    });
  }

  function updateVisibility() {
    var v = readForm();
    form.querySelectorAll('[data-show]').forEach(function (el) {
      var ok = el.getAttribute('data-show').split('&').every(function (cond) {
        var kv = cond.split('=');
        return v[kv[0]] === kv[1];
      });
      el.hidden = !ok;
    });
  }

  function save() {
    try {
      var o = readForm();
      delete o.asOf; // always default to the real today on return
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try {
      var s = localStorage.getItem(STORE);
      if (s) writeForm(JSON.parse(s));
    } catch (e) { /* ignore */ }
  }

  // ---------- render ----------
  var last = null;

  function render() {
    updateVisibility();
    var inp = readForm();
    var due = parseDate(inp.dueDate);
    var asOf = parseDate(inp.asOf) || new Date();
    if (!due) {
      $('empty').hidden = false;
      $('out').hidden = true;
      last = null;
      return;
    }
    $('empty').hidden = true;
    $('out').hidden = false;

    var todayGA = M.DUE - diffDays(asOf, due);
    var msgs = [];

    if (todayGA < 140) {
      showMessage(['This calculator starts at 20 weeks. On ' + fmtDate(asOf, true) + ' you\'re ' + fmtGA(Math.max(0, todayGA)) + ' — come back closer to the big day.']);
      $('status').innerHTML = '';
      $('stats').innerHTML = '';
      $('chart').innerHTML = '';
      $('chartFoot').textContent = '';
      $('factors').innerHTML = '';
      $('rows').innerHTML = '';
      last = null;
      return;
    }

    var ind = parseDate(inp.inductionDate);
    var inductionGA = null;
    if (ind) {
      inductionGA = M.DUE - diffDays(ind, due);
      if (inductionGA <= todayGA) {
        msgs.push('The scheduled date is not after ' + fmtDate(asOf, true) + ', so it was left out.');
        inductionGA = null; ind = null;
      }
    }

    inp.todayGA = todayGA;
    var model = M.buildModel(inp);
    var f = M.forecast(model, todayGA, inductionGA);
    var s = M.summarize(f, todayGA);

    if (todayGA >= 301) msgs.push('You\'re past 43 weeks. Please be in close contact with your provider — the numbers below are well outside typical experience.');
    else if (todayGA >= 287 && !ind) msgs.push('Many providers offer or recommend induction between 41 and 42 weeks. If you have a date, add it under "Right now" to see your odds before it.');
    if (model.twins && todayGA >= 259) msgs.push('Most twin pregnancies are delivered by 37–38 weeks by plan. Check with your provider.');
    showMessage(msgs);

    var ctx = { inp: inp, due: due, asOf: asOf, todayGA: todayGA, ind: ind, model: model, f: f, s: s };
    last = ctx;

    renderStatus(ctx);
    renderStats(ctx);
    renderChart(ctx);
    renderFactors(ctx);
    renderTable(ctx);
  }

  function showMessage(list) {
    var el = $('msg');
    el.hidden = !list.length;
    el.innerHTML = list.map(function (m) { return '<p>' + esc(m) + '</p>'; }).join('');
  }

  function dateOfGA(ctx, ga) { return addDays(ctx.due, ga - M.DUE); }

  function renderStatus(ctx) {
    var toDue = M.DUE - ctx.todayGA;
    var rel = toDue > 0 ? plural(toDue, 'day') + ' before your due date'
      : toDue < 0 ? plural(-toDue, 'day') + ' past your due date'
      : 'your due date';
    $('status').innerHTML = 'On <strong>' + esc(fmtDate(ctx.asOf, true)) + '</strong> you\'re <strong>' + fmtGA(ctx.todayGA) + '</strong> — ' + rel + '. Assuming labor hasn\'t started yet:';
  }

  function stat(k, v, sub, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v' + (cls && cls.indexOf('d') > -1 ? '' : '') + '">' + v + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }
  function statDate(k, v, sub) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v date">' + v + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }

  function pctLabel(ctx, q) {
    if (q.ga == null) return { v: 'After ' + esc(fmtDate(dateOfGA(ctx, ctx.f.endGA))), sub: 'beyond ' + fmtGA(ctx.f.endGA) };
    if (q.kind === 'scheduled') return { v: esc(fmtDate(ctx.ind)), sub: 'your scheduled date' };
    return { v: esc(fmtDate(dateOfGA(ctx, q.ga))), sub: fmtGA(q.ga) };
  }

  function renderStats(ctx) {
    var s = ctx.s, f = ctx.f, html = '';
    html += stat('Today', fmtP(s.today), 'Tomorrow: ' + fmtP(s.tomorrow), 'hero-stat');
    html += stat('In the next 7 days', fmtP(s.week), 'through ' + esc(fmtDate(addDays(ctx.asOf, 6))));
    if (s.byDue != null && ctx.todayGA < M.DUE) {
      html += stat('By your due date', fmtP(s.byDue), 'by end of ' + esc(fmtDate(ctx.due)));
    }
    if (ctx.ind) {
      html += stat('On its own before ' + fmtDate(ctx.ind), fmtP(1 - f.remaining), fmtP(f.remaining) + ' chance you\'ll need the scheduled date');
    } else if (s.pastWeeks42 != null) {
      html += stat('Still waiting at 42 weeks', fmtP(s.pastWeeks42), 'if no induction');
    }
    var p50 = pctLabel(ctx, s.p50);
    html += statDate('Even odds by', p50.v, p50.sub);
    var p10 = pctLabel(ctx, s.p10), p90 = pctLabel(ctx, s.p90);
    html += statDate('80% likely between', p10.v + ' – ' + p90.v, 'middle 80% of outcomes');
    $('stats').innerHTML = html;
  }

  function renderFactors(ctx) {
    $('factors').innerHTML = ctx.model.notes.map(function (n) {
      var tag = 'base', cls = '';
      if (n.shift != null) {
        tag = (n.shift > 0 ? '+' : '−') + Math.abs(n.shift) + ' d';
        cls = n.shift > 0 ? 'later' : 'sooner';
      } else if (n.mult != null) {
        tag = '×' + (Math.round(n.mult * 100) / 100);
        cls = n.mult >= 1 ? 'sooner' : 'later';
      }
      return '<li><span class="tag ' + cls + '">' + esc(tag) + '</span><span>' + esc(n.text) + '</span></li>';
    }).join('');
    var shift = ctx.model.mu - (ctx.model.twins ? 254 : (ctx.inp.first !== 'no' ? 283 : 281));
    if (Math.abs(shift) >= 0.5) {
      $('factors').insertAdjacentHTML('beforeend', '<li><span class="tag">=</span><span>Typical start moved to about <strong>' + fmtGA(Math.round(ctx.model.mu)) + '</strong> (' + esc(fmtDate(dateOfGA(ctx, Math.round(ctx.model.mu)))) + ').</span></li>');
    }
  }

  function renderTable(ctx) {
    var f = ctx.f, rows = '';
    var maxP = f.days.reduce(function (m, d) { return Math.max(m, d.p); }, 0) || 1;
    f.days.forEach(function (d) {
      var date = dateOfGA(ctx, d.ga);
      var cls = [];
      if (d.offset === 0) cls.push('is-today');
      if (d.ga === M.DUE) cls.push('is-due');
      var label = esc(fmtDate(date, true)) + (d.offset === 0 ? ' · today' : '') + (d.ga === M.DUE ? ' · due' : '');
      rows += '<tr class="' + cls.join(' ') + '"><td>' + label + '</td><td>' + fmtGA(d.ga) + '</td>' +
        '<td><span class="bar-inline" style="width:' + Math.max(1, Math.round(36 * d.p / maxP)) + 'px"></span>' + fmtP(d.p) + '</td>' +
        '<td>' + fmtP(d.hazard) + '</td><td>' + fmtP(d.cum) + '</td></tr>';
    });
    if (f.remaining > 0.0005) {
      if (f.remainingKind === 'scheduled') {
        rows += '<tr class="is-sched"><td>' + esc(fmtDate(ctx.ind, true)) + ' · scheduled</td><td>' + fmtGA(f.inductionGA) + '</td><td>' + fmtP(f.remaining) + '</td><td>—</td><td>100%</td></tr>';
      } else {
        rows += '<tr><td>After ' + esc(fmtDate(dateOfGA(ctx, f.endGA), true)) + '</td><td>' + fmtGA(f.endGA + 1) + '+</td><td>' + fmtP(f.remaining) + '</td><td>—</td><td>100%</td></tr>';
      }
    }
    $('rows').innerHTML = rows;
  }

  // ---------- chart ----------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceMax(v) {
    var steps = [0.01, 0.02, 0.025, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
    for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i];
    return 1;
  }

  function renderChart(ctx) {
    var box = $('chart');
    box.innerHTML = '';
    var days = ctx.f.days;
    if (!days.length) return;
    var sched = ctx.f.remainingKind === 'scheduled' && ctx.f.remaining > 0;
    var n = days.length + (sched ? 1 : 0);

    var W = Math.max(280, box.clientWidth || 600);
    var H = W < 520 ? 240 : 300;
    var m = { l: 40, r: 40, t: 22, b: 44 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var bw = iw / n;
    var maxP = niceMax(days.reduce(function (a, d) { return Math.max(a, d.p); }, 0) * 1.08);

    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Daily chance of labor and cumulative chance over time' }, box);
    var g = el('g', { transform: 'translate(' + m.l + ',' + m.t + ')' }, svg);
    var axis = el('g', { class: 'axis' }, g);

    // y grid + labels (left: daily, right: cumulative)
    for (var i = 0; i <= 4; i++) {
      var y = ih - ih * i / 4;
      el('line', { class: 'grid', x1: 0, x2: iw, y1: y, y2: y }, g);
      var lt = el('text', { x: -8, y: y + 4, 'text-anchor': 'end' }, axis);
      lt.textContent = fmtTick(maxP * i / 4);
      var rt = el('text', { x: iw + 8, y: y + 4, 'text-anchor': 'start' }, axis);
      rt.textContent = (25 * i) + '%';
    }

    // bars
    var bars = [];
    var gap = bw > 6 ? Math.min(2, bw * 0.2) : 0.5;
    days.forEach(function (d, i) {
      var h = ih * d.p / maxP;
      bars.push(el('rect', { class: 'bar', x: i * bw + gap / 2, y: ih - h, width: Math.max(0.5, bw - gap), height: Math.max(0, h), rx: Math.min(2, bw / 4) }, g));
    });

    // due marker
    var dueIdx = M.DUE - ctx.todayGA;
    if (dueIdx >= 0 && dueIdx < days.length) {
      var dx = (dueIdx + 0.5) * bw;
      el('line', { class: 'due', x1: dx, x2: dx, y1: -6, y2: ih }, g);
      var dl = el('text', { class: 'due-label', x: dx, y: -10, 'text-anchor': 'middle' }, g);
      dl.textContent = 'Due';
    }
    if (sched) {
      var sx = (days.length + 0.5) * bw;
      el('line', { class: 'due', x1: sx, x2: sx, y1: -6, y2: ih }, g);
      var st = el('text', { class: 'due-label', x: sx, y: -10, 'text-anchor': 'end' }, g);
      st.textContent = 'Scheduled';
    }

    // cumulative line
    var pts = ['0,' + ih];
    days.forEach(function (d, i) { pts.push(((i + 1) * bw).toFixed(1) + ',' + (ih - ih * d.cum).toFixed(1)); });
    if (sched) pts.push((n * bw).toFixed(1) + ',0');
    el('polyline', { class: 'cum', points: pts.join(' ') }, g);

    // x labels at week boundaries
    var weekPx = bw * 7;
    var every = Math.max(1, Math.ceil(64 / weekPx));
    days.forEach(function (d, i) {
      if (d.ga % 7 !== 0 || (Math.floor(d.ga / 7) % every) !== 0) return;
      var x = i * bw;
      el('line', { class: 'grid', x1: x, x2: x, y1: ih, y2: ih + 5 }, g);
      var t1 = el('text', { x: x, y: ih + 18, 'text-anchor': 'middle' }, axis);
      t1.textContent = Math.floor(d.ga / 7) + 'w';
      var t2 = el('text', { x: x, y: ih + 32, 'text-anchor': 'middle' }, axis);
      t2.textContent = fmtDate(dateOfGA(ctx, d.ga));
    });

    // hover
    var hover = el('line', { class: 'hover', x1: 0, x2: 0, y1: 0, y2: ih, visibility: 'hidden' }, g);
    var overlay = el('rect', { x: 0, y: -m.t, width: iw, height: H, fill: 'transparent' }, g);
    var tip = $('tip');
    var active = -1;
    function move(ev) {
      var r = svg.getBoundingClientRect();
      var i = Math.floor((ev.clientX - r.left - m.l) / bw);
      if (i < 0 || i >= n) { leave(); return; }
      bars.forEach(function (b, j) { b.classList.toggle('dim', j !== i); });
      active = i;
      var x = (i + 0.5) * bw;
      hover.setAttribute('x1', x); hover.setAttribute('x2', x); hover.setAttribute('visibility', 'visible');
      var html;
      if (i < days.length) {
        var d = days[i];
        html = '<b>' + esc(fmtDate(dateOfGA(ctx, d.ga), true)) + '</b> · ' + fmtGA(d.ga) + '<br>That day: <b>' + fmtP(d.p) + '</b><br>If you get there: ' + fmtP(d.hazard) + '<br>By end of day: ' + fmtP(d.cum);
      } else {
        html = '<b>' + esc(fmtDate(ctx.ind, true)) + '</b> · scheduled<br>Needed: <b>' + fmtP(ctx.f.remaining) + '</b>';
      }
      tip.innerHTML = html;
      tip.hidden = false;
      var tx = Math.min(window.innerWidth - 90, Math.max(90, r.left + m.l + x));
      tip.style.left = tx + 'px';
      tip.style.top = (r.top + m.t) + 'px';
    }
    function leave() {
      bars.forEach(function (b) { b.classList.remove('dim'); });
      hover.setAttribute('visibility', 'hidden');
      tip.hidden = true;
      active = -1;
    }
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerdown', move);
    overlay.addEventListener('pointerleave', leave);

    var best = ctx.s.mostLikely;
    $('chartFoot').textContent = best
      ? 'Most likely single day: ' + fmtDate(dateOfGA(ctx, best.ga), true) + ' (' + fmtGA(best.ga) + ') at ' + fmtP(best.p) + '. Even the likeliest day is a long shot — labor is spread over weeks.'
      : '';
  }

  function fmtTick(p) {
    var v = p * 100;
    return (v < 10 && v % 1 ? v.toFixed(1) : Math.round(v)) + '%';
  }

  // ---------- wiring ----------
  function init() {
    load();
    if (!form.elements.asOf.value) form.elements.asOf.value = toISO(new Date());
    form.addEventListener('input', function () { save(); render(); });
    form.addEventListener('change', function () { save(); render(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    $('reset').addEventListener('click', function () {
      form.reset();
      try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
      form.elements.asOf.value = toISO(new Date());
      render();
    });
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (last) renderChart(last); }, 120);
    });
    window.addEventListener('scroll', function () { $('tip').hidden = true; }, { passive: true });
    render();
  }

  init();
})();
