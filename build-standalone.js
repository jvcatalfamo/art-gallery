// Build standalone.html with embedded data
const fs = require('fs');

const html = fs.readFileSync('./index.html', 'utf8');
const css = fs.readFileSync('./styles.css', 'utf8');
const js = fs.readFileSync('./app.js', 'utf8');
const paintings = JSON.parse(fs.readFileSync('./data/paintings-sample.json', 'utf8'));

// Modify JS to use embedded data instead of fetch
const modifiedJs = js
  .replace(
    /const DATA_FILE = .*?;/,
    '// Data is embedded below'
  )
  .replace(
    /async function loadPaintings\(\)[\s\S]*?^}/m,
    `async function loadPaintings() {
  paintings = PAINTINGS_DATA;
  paintingsMap = {};
  for (const p of paintings) {
    paintingsMap[p.contentId] = p;
  }
  console.log(\`Loaded \${paintings.length} paintings (embedded)\`);
}`
  );

// Build the standalone HTML
const standalone = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Art Gallery</title>
  <style>
${css}
  </style>
</head>
<body>
${html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script.*?<\/script>/g, '')}
  <script>
// Embedded paintings data
const PAINTINGS_DATA = ${JSON.stringify(paintings)};

${modifiedJs}
  </script>
</body>
</html>`;

fs.writeFileSync('./standalone.html', standalone);
console.log(`Created standalone.html (${(standalone.length / 1024).toFixed(1)} KB)`);
console.log(`Embedded ${paintings.length} paintings`);
