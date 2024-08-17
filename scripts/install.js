var cp = require('child_process');
cp.exec('./scripts/install_puppeteer_deps.sh', function(err, stdout, stderr) {
  // handle err, stdout, stderr
});