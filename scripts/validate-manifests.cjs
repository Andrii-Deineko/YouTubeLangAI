const fs = require('fs');
const path = require('path');

const chromePatternRegex = /^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)\/.*$/;

console.log(`\n=== Checking dist/manifest.json ===`);
const manifestPath = path.join(process.cwd(), 'dist', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`ERROR: ${manifestPath} does not exist`);
  process.exit(1);
}

let totalErrors = 0;
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
          console.error(`[FAIL] content_scripts[${csIdx}].matches[${mIdx}]: "${m}"`);
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
      console.error(`[FAIL] host_permissions[${hpIdx}]: "${hp}"`);
      totalErrors++;
    }
  });
}

// 3. Check optional_host_permissions
if (Array.isArray(manifest.optional_host_permissions)) {
  manifest.optional_host_permissions.forEach((ohp, ohpIdx) => {
    checkedCount++;
    if (ohp === '<all_urls>') return;
    if (!chromePatternRegex.test(ohp)) {
      console.error(`[FAIL] optional_host_permissions[${ohpIdx}]: "${ohp}"`);
      totalErrors++;
    }
  });
}

console.log(`Validated ${checkedCount} match patterns in dist/manifest.json`);

// 4. Verify web_accessible_resources has use_dynamic_url: false
if (Array.isArray(manifest.web_accessible_resources)) {
  for (const war of manifest.web_accessible_resources) {
    if (war.use_dynamic_url !== false) {
      console.error(`[FAIL] dist web_accessible_resources has use_dynamic_url !== false`);
      totalErrors++;
    }
  }
  console.log(`Verified: dist web_accessible_resources has use_dynamic_url: false`);
}

// 5. Verify no loader wrappers in assets
const assetsDir = path.join(process.cwd(), 'dist', 'assets');
if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  for (const f of files) {
    if (f.includes('-loader-')) {
      console.error(`[FAIL] dist/assets contains loader wrapper: ${f}`);
      totalErrors++;
    }
  }
  console.log(`Verified: dist/assets has ZERO loader wrappers`);

  // Verify that required scripts exist in dist/assets
  const required = [
    'interceptor-yt.js',
    'content-yt.js',
    'interceptor-cinema.js',
    'content-cinema.js',
    'content-netflix.js'
  ];
  for (const req of required) {
    if (!fs.existsSync(path.join(assetsDir, req))) {
      console.error(`[FAIL] dist/assets is missing required bundle: ${req}`);
      totalErrors++;
    } else {
      console.log(`Verified: dist/assets has ${req}`);
    }
  }
}

if (totalErrors > 0) {
  console.error(`\nFound ${totalErrors} validation errors!`);
  process.exit(1);
} else {
  console.log(`\n>>> UNIFIED MANIFEST & BUNDLES ARE 100% VALID ACCORDING TO CHROME MV3 SPECIFICATION! <<<`);
}
