import fs from 'fs';
import postcss from 'postcss';

const cssPath = '/Users/nhatphamcdn/development/gnomemepad-core/web/ui/src/index.css';
const stylesDir = '/Users/nhatphamcdn/development/gnomemepad-core/web/ui/src/styles';

const css = fs.readFileSync(cssPath, 'utf8');

// Define keywords for different files
const keywords = {
  '_variables.scss': [':root', '[data-theme'],
  '_layout.scss': ['.app-shell', '.nav', '.header', '.footer', '.main', '.brand', '.sidebar'],
  '_chart.scss': ['.chart', '.price-chart', '.lightweight-chart'],
  '_market.scss': ['.market', '.card', '.trending', '.heat', '.fire'],
  '_typography.scss': ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', '.text-', '.fw-', '.fs-'],
  '_modals.scss': ['.modal', '.dialog', '.overlay', '.settings', '.tx-'],
  '_buttons.scss': ['.btn', '.button'],
  '_forms.scss': ['input', 'select', 'textarea', '.form', '.field'],
  '_activity.scss': ['.feed', '.ticker', '.activity'],
  '_token.scss': ['.token', '.avatar', '.socials', '.meta', '.badge']
};

const fileData = {};
for (const k of Object.keys(keywords)) {
  fileData[k] = postcss.root();
}
fileData['_global.scss'] = postcss.root();

const ast = postcss.parse(css);

ast.nodes.forEach(node => {
  let matched = false;
  
  if (node.type === 'rule') {
    for (const [filename, keys] of Object.entries(keywords)) {
      if (keys.some(k => node.selector.includes(k))) {
        fileData[filename].append(node.clone());
        matched = true;
        break;
      }
    }
  } else if (node.type === 'atrule' && node.name === 'media') {
    // For media queries, we just put them in global for simplicity, 
    // or try to guess based on their inner rules.
    // Let's just put it in global.
  }
  
  if (!matched) {
    fileData['_global.scss'].append(node.clone());
  }
});

if (!fs.existsSync(stylesDir)) {
  fs.mkdirSync(stylesDir, { recursive: true });
}

let mainScss = '';
for (const [filename, root] of Object.entries(fileData)) {
  if (root.nodes.length > 0) {
    fs.writeFileSync(`${stylesDir}/${filename}`, root.toString());
    mainScss += `@use "${filename.replace('_', '').replace('.scss', '')}";\n`;
  }
}

fs.writeFileSync(`${stylesDir}/main.scss`, mainScss);
console.log('Successfully split CSS into SCSS partials!');
