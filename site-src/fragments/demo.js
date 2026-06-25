window.__amicusRunDemo = function () {
  // Guard: bail if the swarm SVG isn't in the DOM yet
  var swarmSvg = document.querySelector('.swarm-svg');
  if (!swarmSvg) return;

  var forks = ['.fork1', '.fork2', '.fork3'].map(function (s) {
    return document.querySelector('.swarm-svg ' + s);
  });
  var folds = ['.fold1', '.fold2', '.fold3'].map(function (s) {
    return document.querySelector('.swarm-svg ' + s);
  });
  var farrows = document.querySelectorAll('.swarm-svg .farrow');
  var darrows = document.querySelectorAll('.swarm-svg .darrow');
  var runBadges = document.querySelectorAll('.swarm-svg .run-badge');
  var resultsGlow = document.querySelector('.swarm-svg .results-glow');

  // Reset any prior animation state so the function is safe to call again
  forks.forEach(function (p) {
    if (!p) return;
    p.style.transition = 'none';
    p.style.strokeDashoffset = Math.ceil(p.getTotalLength());
  });
  folds.forEach(function (p) {
    if (!p) return;
    p.style.transition = 'none';
    p.style.strokeDashoffset = Math.ceil(p.getTotalLength());
  });
  farrows.forEach(function (a) { a.style.opacity = 0; a.style.transition = 'none'; });
  darrows.forEach(function (a) { a.style.opacity = 0; a.style.transition = 'none'; });
  runBadges.forEach(function (b) { b.style.animation = 'none'; });
  if (resultsGlow) resultsGlow.style.animation = 'none';

  // Set stroke-dasharray and initial hidden offset using actual path length
  forks.forEach(function (p, i) {
    if (!p) return;
    var l = Math.ceil(p.getTotalLength());
    p.style.strokeDasharray = l;
    p.style.strokeDashoffset = l;
    // Re-enable transition on next frame so the reset above has taken effect
    requestAnimationFrame(function () {
      p.style.transition = 'stroke-dashoffset .65s cubic-bezier(.4,0,.2,1) ' + (i * 0.13) + 's';
      p.style.strokeDashoffset = 0;
    });
  });
  folds.forEach(function (p, i) {
    if (!p) return;
    var l = Math.ceil(p.getTotalLength());
    p.style.strokeDasharray = l;
    p.style.strokeDashoffset = l;
    requestAnimationFrame(function () {
      p.style.transition = 'stroke-dashoffset .55s cubic-bezier(.4,0,.2,1) ' + (1.2 + i * 0.12) + 's';
      p.style.strokeDashoffset = 0;
    });
  });

  setTimeout(function () {
    farrows.forEach(function (a) {
      a.style.transition = 'opacity .25s ease';
      a.style.opacity = 1;
    });
  }, 580);

  setTimeout(function () {
    darrows.forEach(function (a) {
      a.style.transition = 'opacity .25s ease';
      a.style.opacity = 1;
    });
  }, 1700);

  setTimeout(function () {
    runBadges.forEach(function (b, i) {
      b.style.animation = 'pulse-run 1.6s ease-in-out ' + (i * 0.35) + 's infinite';
    });
  }, 400);

  setTimeout(function () {
    if (resultsGlow) resultsGlow.style.animation = 'pulse-results 3s ease-in-out infinite';
  }, 1800);
};
