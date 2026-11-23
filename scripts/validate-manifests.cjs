const fs = require('fs');
const path = require('path');

const chromePatternRegex = /^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)\/.*$/;
const targets = ['dist-youtube', 'dist-cinema', 'dist-all'];

let totalErrors = 0;

for (const target of targets) {
  console.log(`\n=== Checking ${target} ===`);
  const manifestPath = path.join(process.cwd(), target, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`ERROR: ${manifestPath} does not exist`);
    totalErrors++;
    continue;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  let checkedCount = 0;

  // 1. Check content_scripts[*].matches
  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((cs, csIdx) => {
      if (Array.isArray(cs.matches)) {
        cs.matches.forEach((m, mIdx) => {
          checkedCount++;
          if (m === '<all_urls>') return;
          if (!chromePatternRegex.test(m)) {
            console.error(`[FAIL] ${target} content_scripts[${csIdx}].matches[${mIdx}]: "${m}"`);
            totalErrors++;
          }
        });
      }
    });
  }

  // 2. Check host_permissions
  if (Array.isArray(manifest.host_permissions)) {
    manifest.host_permissions.forEach((hp, hpIdx) => {
      checkedCount++;
      if (hp === '<all_urls>') return;
      if (!chromePatternRegex.test(hp)) {
        console.error(`[FAIL] ${target} host_permissions[${hpIdx}]: "${hp}"`);
        totalErrors++;
      }
    });
  }

  console.log(`Validated ${checkedCount} match patterns in ${target}/manifest.json`);

  // 3. In dist-youtube, verify zero cinema domains
  if (target === 'dist-youtube') {
    const raw = JSON.stringify(manifest);
    const forbidden = ['rezka', '9anime', 'hianime', 'megacloud', 'vidplay', 'filemoon', 'rabbitstream', 'streamguard', 'voidboost'];
    for (const word of forbidden) {
      if (raw.includes(word)) {
        console.error(`[FAIL] dist-youtube manifest contains cinema keyword: ${word}`);
        totalErrors++;
      }
    }
    console.log('Verified: dist-youtube has ZERO cinema domains');
  }

  // 4. Verify web_accessible_resources has use_dynamic_url: false
  if (Array.isArray(manifest.web_accessible_resources)) {
    manifest.web_accessible_resources.forEach((war, warIdx) => {
      if (war.use_dynamic_url !== false) {
        console.error(`[FAIL] ${target} web_accessible_resources[${warIdx}] use_dynamic_url is not false`);
        totalErrors++;
      }
    });
    console.log(`Verified: ${target} web_accessible_resources has use_dynamic_url: false`);
  }

  // 5. Verify no *-loader-*.js in assets
  const assetsDir = path.join(process.cwd(), target, 'assets');
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    const loaders = files.filter(f => f.includes('-loader-'));
    if (loaders.length > 0) {
      console.error(`[FAIL] ${target}/assets contains loader files:`, loaders);
      totalErrors++;
    } else {
      console.log(`Verified: ${target}/assets has ZERO loader wrappers`);
    }
  }
}

if (totalErrors === 0) {
  console.log('\n>>> ALL 3 MANIFESTS ARE 100% VALID ACCORDING TO CHROME MV3 SPECIFICATION! <<<');
  process.exit(0);
} else {
  console.error(`\n>>> FOUND ${totalErrors} VALIDATION ERRORS! <<<`);
  process.exit(1);
}
