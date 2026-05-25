const fs = require('fs');
const path = require('path');

const files = ['index.html', 'index.css', 'app.js', 'manifest.json', 'service-worker.js'];

if (!fs.existsSync('www')) {
    fs.mkdirSync('www');
}

files.forEach(file => {
    fs.copyFileSync(file, path.join('www', file));
});
console.log('Web assets copied successfully to www/.');
