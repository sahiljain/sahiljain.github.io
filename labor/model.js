/*
 * Labor onset model.
 *
 * Gestational age (GA) is counted in days from the first day of the last
 * menstrual period, so the due date is GA day 280 (40w0d).
 *
 * The unconditional time of spontaneous labor onset is modelled as a mixture
 * of two normals: a main term component and a small early (preterm) tail.
 * Personal factors shift the term component's centre or change its spread.
 * Things that are happening right now (cervical exam, show, a sweep) are
 * applied as multipliers on the daily hazard. Everything is then conditioned
 * on "not in labor yet" as of the chosen date.
 */
(function (root) {
  'use strict';

  var DUE = 280;
  var SHOW_UNTIL = 294; // 42w0d

  function erf(x) {
    // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  var DATING = {
    ivf:    { sd: 6.5, label: 'IVF / embryo transfer date' },
    us1:    { sd: 7.5, label: 'first-trimester ultrasound' },
    us2:    { sd: 8.5, label: 'later ultrasound' },
    lmp:    { sd: 9.5, label: 'last period only' },
    unsure: { sd: 9.0, label: 'unsure' }
  };

  var BMI_SHIFT = { under: -1, normal: 0, over: 1, obese: 2, obese2: 3 };
  var ANCESTRY_SHIFT = { black: -3, sasian: -3, easian: -1.5 };
  var DILATION = { '0': 0.75, '1': 1.0, '2': 1.35, '3': 1.7, '4': 2.3 };
  var EFFACEMENT = { low: 0.85, mid: 1.0, high: 1.2, full: 1.45 };

  function ga(weeks, days) { return weeks * 7 + days; }

  /** Turn the answers into model parameters plus a human-readable list of what changed. */
  function buildModel(inp) {
    var notes = [];
    var twins = inp.plurality === '2';
    var first = inp.first !== 'no';
    var dating = DATING[inp.dating] || DATING.unsure;

    var mu, sd, wPre, muPre, sdPre;
    if (twins) {
      mu = ga(36, 2); sd = 12; wPre = 0.2; muPre = ga(32, 0); sdPre = 18;
      notes.push({ text: 'Twins: labor usually starts around 36 weeks, and most twins are delivered by 37–38 weeks by plan.', shift: null });
    } else {
      mu = first ? ga(40, 3) : ga(40, 1);
      sd = dating.sd;
      wPre = 0.05; muPre = ga(34, 2); sdPre = 18;
      notes.push({
        text: first
          ? 'First baby: spontaneous labor typically starts a few days after the due date (median about 40w3d).'
          : 'Previous birth: labor typically starts close to the due date (median about 40w1d).',
        shift: null
      });
      notes.push({ text: 'Dated by ' + dating.label + ': typical spread of ±' + dating.sd + ' days around the centre.', shift: null });
    }

    var shift = 0;
    function add(days, text) {
      if (!days) return;
      shift += days;
      notes.push({ text: text, shift: days });
    }

    if (inp.dating === 'lmp') {
      var cyc = Number(inp.cycle);
      if (cyc >= 21 && cyc <= 45 && cyc !== 28) {
        add(cyc - 28, cyc + '-day cycles: ovulation (and so labor) tends to come ' + Math.abs(cyc - 28) + ' day' + (Math.abs(cyc - 28) === 1 ? '' : 's') + (cyc > 28 ? ' later' : ' earlier') + ' than a 28-day due date assumes.');
      }
    }

    var prevPreterm = !!inp.prevPreterm;
    if (!first && inp.prevType === 'spont') {
      var w = Number(inp.prevWeeks), d = Number(inp.prevDays || 0);
      if (inp.prevWeeks !== '' && w >= 22 && w <= 44 && d >= 0 && d <= 6) {
        var prev = ga(w, d);
        if (prev < ga(37, 0)) prevPreterm = true;
        // Gestation lengths in consecutive pregnancies are moderately correlated.
        var s = Math.max(-8, Math.min(8, 0.35 * (prev - ga(40, 1))));
        s = Math.round(s * 2) / 2;
        if (s) add(s, 'Last labor began at ' + w + 'w' + d + 'd: pregnancies tend to repeat their timing, partly.');
      }
    }
    if (!first && prevPreterm) {
      wPre = twins ? 0.3 : 0.15;
      notes.push({ text: 'A previous birth before 37 weeks raises the chance of an early start.', shift: null });
    }

    var age = Number(inp.age);
    if (inp.age !== '' && age > 0) {
      if (age < 20) add(-1, 'Age under 20: slightly shorter pregnancies on average.');
      else if (age >= 40) add(1.5, 'Age 40+: slightly longer pregnancies on average.');
      else if (age >= 35) add(1, 'Age 35–39: slightly longer pregnancies on average.');
    }

    if (BMI_SHIFT[inp.bmi]) {
      add(BMI_SHIFT[inp.bmi], inp.bmi === 'under'
        ? 'BMI under 18.5: slightly shorter pregnancies on average.'
        : 'Higher pre-pregnancy BMI: labor tends to start later and post-term pregnancy is more common.');
    }

    if (ANCESTRY_SHIFT[inp.ancestry]) {
      add(ANCESTRY_SHIFT[inp.ancestry], 'Ancestry: in large studies, average gestation is a few days shorter in this group.');
    }

    mu += shift;

    // Hazard multipliers for what is happening now.
    var cervix = 1, signs = 1, sweep = 0;
    var todayGA = inp.todayGA;
    var cervixOk = todayGA >= ga(36, 0);
    if (inp.dilation && DILATION[inp.dilation] != null) {
      var f = DILATION[inp.dilation];
      if (!first) f = Math.pow(f, 0.6); // a second-time cervix is often open early
      cervix *= f;
    }
    if (inp.effacement && EFFACEMENT[inp.effacement] != null) cervix *= EFFACEMENT[inp.effacement];
    if (cervix !== 1) {
      if (cervixOk) {
        notes.push({ text: 'Cervical exam: daily chance of labor ×' + cervix.toFixed(2) + ' over the next week or two.', mult: cervix });
      } else {
        notes.push({ text: 'Cervical exam ignored before 36 weeks — talk to your provider about any early cervical change.', shift: null });
        cervix = 1;
      }
    }
    if (inp.show) { signs *= 1.3; notes.push({ text: 'Mucus plug / bloody show: daily chance ×1.3 for the next week or so.', mult: 1.3 }); }
    if (inp.dropped) { signs *= 1.1; notes.push({ text: 'Baby has dropped: daily chance ×1.1 (weak signal).', mult: 1.1 }); }
    if (inp.sweep) { sweep = 1; notes.push({ text: 'Membrane sweep in the last 48 hours: daily chance ×1.4 for about two days.', mult: 1.4 }); }

    return {
      mu: mu, sd: sd, wPre: wPre, muPre: muPre, sdPre: sdPre,
      cervix: cervix, signs: signs, sweep: sweep, notes: notes, twins: twins
    };
  }

  function cdf(m, x) {
    return (1 - m.wPre) * Phi((x - m.mu) / m.sd) + m.wPre * Phi((x - m.muPre) / m.sdPre);
  }

  /** Multiplier on the hazard `t` days after the as-of date. */
  function multiplier(m, t) {
    // Present-tense signals are fully informative for a week, then fade over two more.
    var fade = t < 7 ? 1 : Math.max(0, 1 - (t - 7) / 14);
    var k = 1 + (m.cervix * m.signs - 1) * fade;
    if (m.sweep) k *= t <= 1 ? 1.4 : t === 2 ? 1.15 : 1;
    return k;
  }

  /**
   * Daily forecast from todayGA onward, given no labor yet.
   * inductionGA (optional): scheduled induction or C-section; labor that has not
   * started on its own by then is counted as "scheduled".
   */
  function forecast(m, todayGA, inductionGA) {
    var end = Math.min(308, Math.max(SHOW_UNTIL, todayGA + 14));
    var hasInduction = inductionGA != null && inductionGA > todayGA;
    if (hasInduction) end = Math.min(end, inductionGA - 1);
    var days = [];
    var surv = 1, cum = 0;
    for (var d = todayGA; d <= end; d++) {
      var S = 1 - cdf(m, d);
      var h = S > 1e-12 ? (cdf(m, d + 1) - cdf(m, d)) / S : 1;
      h = Math.min(1, Math.max(0, h));
      var k = multiplier(m, d - todayGA);
      var hk = 1 - Math.pow(1 - h, k);
      var p = surv * hk;
      cum += p;
      days.push({ ga: d, offset: d - todayGA, p: p, hazard: hk, cum: cum });
      surv -= p;
    }
    return {
      days: days,
      remaining: Math.max(0, surv),
      remainingKind: hasInduction ? 'scheduled' : 'later',
      endGA: end,
      inductionGA: hasInduction ? inductionGA : null
    };
  }

  /** Headline numbers from a forecast. */
  function summarize(f, todayGA) {
    var days = f.days;
    function sumUntil(lastGA) {
      var s = 0;
      for (var i = 0; i < days.length && days[i].ga <= lastGA; i++) s += days[i].p;
      return s;
    }
    function pct(q) {
      for (var i = 0; i < days.length; i++) if (days[i].cum >= q) return { ga: days[i].ga };
      return { ga: f.inductionGA != null ? f.inductionGA : null, kind: f.remainingKind };
    }
    var best = null;
    for (var i = 0; i < days.length; i++) if (!best || days[i].p > best.p) best = days[i];
    return {
      today: days.length ? days[0].p : 0,
      tomorrow: days.length > 1 ? days[1].p : 0,
      week: sumUntil(todayGA + 6),
      byDue: todayGA <= DUE ? sumUntil(DUE) : null,
      pastWeeks41: todayGA < 287 ? 1 - sumUntil(286) : null,
      pastWeeks42: todayGA < 294 ? 1 - sumUntil(293) : null,
      p10: pct(0.1), p50: pct(0.5), p90: pct(0.9),
      mostLikely: best
    };
  }

  var api = { buildModel: buildModel, forecast: forecast, summarize: summarize, cdf: cdf, DUE: DUE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaborModel = api;
})(this);
